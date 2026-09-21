import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthService } from './auth.service';
import { RealtimeService, WEBSOCKET_FACTORY } from './realtime.service';
import { setToken, clearToken } from './token-storage';
import type { AppUser } from '../models/user.model';
import type { ServerEvent } from '../models/realtime.model';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
  open(): void {
    this.onopen?.();
  }
  receive(event: unknown): void {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
  drop(code = 1006): void {
    this.onclose?.({ code });
  }
}

const USER: AppUser = { id: 1, email: 'a@b.c', role: 'customer' };

function setup() {
  FakeWebSocket.instances = [];
  setToken('tok');
  const user = signal<AppUser | undefined>(undefined);
  const auth = { currentUser: user, logout: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: auth },
      { provide: WEBSOCKET_FACTORY, useValue: (url: string) => new FakeWebSocket(url) as unknown as WebSocket },
    ],
  });
  const service = TestBed.inject(RealtimeService);
  const login = () => {
    user.set(USER);
    TestBed.tick();
  };
  return { service, user, auth, login };
}

const last = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

describe('RealtimeService', () => {
  afterEach(() => {
    vi.useRealTimers();
    clearToken();
  });

  it('does not connect while nobody is logged in', () => {
    setup();
    TestBed.tick();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('connects on login, sends the token as the first frame and becomes open on ready', () => {
    const { service, login } = setup();
    login();
    expect(last().url).toBe('ws://localhost:8000/ws');
    expect(service.status()).toBe('connecting');

    last().open();
    expect(JSON.parse(last().sent[0])).toEqual({ type: 'auth', token: 'tok' });

    last().receive({ type: 'ready', user: { id: 1, role: 'customer' } });
    expect(service.status()).toBe('open');
  });

  it('forwards server events', () => {
    const { service, login } = setup();
    const seen: ServerEvent[] = [];
    service.events$.subscribe(e => seen.push(e));
    login();
    last().open();
    last().receive({ type: 'ready', user: { id: 1, role: 'customer' } });
    last().receive({ type: 'error', code: 'x', detail: 'y' });
    expect(seen.map(e => e.type)).toEqual(['ready', 'error']);
  });

  it('closes the socket on logout', () => {
    const { service, user, login } = setup();
    login();
    const socket = last();
    user.set(undefined);
    TestBed.tick();
    expect(socket.closed).toBe(true);
    expect(service.status()).toBe('closed');
  });

  it('reconnects with exponential backoff and resets it once ready', () => {
    vi.useFakeTimers();
    const { login } = setup();
    login();
    last().drop();
    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    last().drop();
    vi.advanceTimersByTime(1999);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(3);

    last().open();
    last().receive({ type: 'ready', user: { id: 1, role: 'customer' } });
    last().drop();
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(4);
  });

  it('caps the backoff at 30 seconds', () => {
    vi.useFakeTimers();
    const { login } = setup();
    login();
    for (let i = 0; i < 8; i++) {
      last().drop();
      vi.advanceTimersByTime(30_000);
    }
    const before = FakeWebSocket.instances.length;
    last().drop();
    vi.advanceTimersByTime(30_000);
    expect(FakeWebSocket.instances).toHaveLength(before + 1);
  });

  it('does not retry after 4401 and logs the user out', () => {
    vi.useFakeTimers();
    const { auth, login } = setup();
    login();
    last().drop(4401);
    vi.advanceTimersByTime(120_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(auth.logout).toHaveBeenCalled();
  });

  it('emits reconnected$ on the second ready, not the first', () => {
    vi.useFakeTimers();
    const { service, login } = setup();
    const reconnected = vi.fn();
    service.reconnected$.subscribe(reconnected);
    login();
    last().open();
    last().receive({ type: 'ready', user: { id: 1, role: 'customer' } });
    expect(reconnected).not.toHaveBeenCalled();

    last().drop();
    vi.advanceTimersByTime(1000);
    last().open();
    last().receive({ type: 'ready', user: { id: 1, role: 'customer' } });
    expect(reconnected).toHaveBeenCalledTimes(1);
  });

  it('ignores frames from a stale socket after logout', () => {
    const { service, user, login } = setup();
    const seen: ServerEvent[] = [];
    const reconnected = vi.fn();
    service.events$.subscribe(e => seen.push(e));
    service.reconnected$.subscribe(reconnected);
    login();
    const old = last();
    user.set(undefined);
    TestBed.tick();

    old.open();
    old.receive({ type: 'ready', user: { id: 1, role: 'customer' } });
    expect(service.status()).toBe('closed');
    expect(seen).toHaveLength(0);

    login();
    last().open();
    last().receive({ type: 'ready', user: { id: 1, role: 'customer' } });
    expect(reconnected).not.toHaveBeenCalled();
  });

  it('send() only writes when the connection is open', () => {
    const { service, login } = setup();
    login();
    expect(service.send({ type: 'chat.send', body: 'hola' })).toBe(false);
    last().open();
    last().receive({ type: 'ready', user: { id: 1, role: 'customer' } });
    expect(service.send({ type: 'chat.send', body: 'hola' })).toBe(true);
    expect(JSON.parse(last().sent[1])).toEqual({ type: 'chat.send', body: 'hola' });
  });
});
