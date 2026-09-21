import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { RealtimeService } from './realtime.service';
import { ChatService } from './chat.service';
import type { AppUser } from '../models/user.model';
import type { ChatMessageApi } from '../models/chat.model';
import type { ServerEvent } from '../models/realtime.model';

class FakeRealtime {
  status = signal<'open' | 'connecting' | 'closed'>('open');
  events = new Subject<ServerEvent>();
  reconnected = new Subject<void>();
  events$ = this.events.asObservable();
  reconnected$ = this.reconnected.asObservable();
  send = vi.fn().mockReturnValue(true);
}

const api = (over: Partial<ChatMessageApi> = {}): ChatMessageApi => ({
  id: 1,
  customer_id: 5,
  sender_id: 5,
  sender_role: 'customer',
  body: 'hola',
  created_at: '2026-09-21T10:00:00',
  read_at: null,
  ...over,
});

const messagesUrl = `${environment.apiUrl}/chat/messages`;

function setup(role: AppUser['role'] | null = 'customer') {
  const user = signal<AppUser | undefined>(role ? { id: 5, email: 'c@x.com', role } : undefined);
  const realtime = new FakeRealtime();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: { currentUser: user } },
      { provide: RealtimeService, useValue: realtime },
    ],
  });
  const http = TestBed.inject(HttpTestingController);
  const service = TestBed.inject(ChatService);
  TestBed.tick();
  return { service, http, realtime, user };
}

async function loaded(rows: ChatMessageApi[]) {
  const ctx = setup();
  ctx.http.expectOne(r => r.url === messagesUrl).flush(rows);
  await vi.waitFor(() => expect(ctx.service.customerMessages()).toHaveLength(rows.length));
  return ctx;
}

describe('ChatService (customer)', () => {
  it('loads the customer thread on login', async () => {
    const { service } = await loaded([api({ id: 1 }), api({ id: 2, sender_id: 1, sender_role: 'admin', body: 'hola!' })]);
    expect(service.customerMessages().map(m => m.body)).toEqual(['hola', 'hola!']);
    expect(service.customerMessages()[1].senderRole).toBe('admin');
  });

  it('does not load anything without a user', () => {
    const { http } = setup(null);
    http.expectNone(r => r.url === messagesUrl);
  });

  it('appends live messages for its own thread and ignores duplicates', async () => {
    const { service, realtime } = await loaded([api({ id: 1 })]);
    const event: ServerEvent = { type: 'chat.message', message: api({ id: 2, sender_role: 'admin', sender_id: 1 }) };
    realtime.events.next(event);
    realtime.events.next(event);
    expect(service.customerMessages().map(m => m.id)).toEqual([1, 2]);
  });

  it('ignores messages of another thread', async () => {
    const { service, realtime } = await loaded([api({ id: 1 })]);
    realtime.events.next({ type: 'chat.message', message: api({ id: 9, customer_id: 77 }) });
    expect(service.customerMessages()).toHaveLength(1);
  });

  it('counts unread admin messages until the customer reads them', async () => {
    const { service, realtime } = await loaded([api({ id: 1 }), api({ id: 2, sender_id: 1, sender_role: 'admin' })]);
    expect(service.customerUnread()).toBe(1);
    realtime.events.next({ type: 'chat.read', customer_id: 5, reader_role: 'customer' });
    expect(service.customerUnread()).toBe(0);
  });

  it('markRead() only sends when there is something unread', async () => {
    const { service, realtime } = await loaded([api({ id: 1 })]);
    service.markRead();
    expect(realtime.send).not.toHaveBeenCalled();

    realtime.events.next({ type: 'chat.message', message: api({ id: 2, sender_id: 1, sender_role: 'admin' }) });
    service.markRead();
    expect(realtime.send).toHaveBeenCalledWith({ type: 'chat.read' });
  });

  it('send() forwards to the socket and reports failure when it is not open', async () => {
    const { service, realtime } = await loaded([]);
    expect(service.send('hola')).toBe(true);
    expect(realtime.send).toHaveBeenCalledWith({ type: 'chat.send', body: 'hola' });

    realtime.send.mockReturnValue(false);
    expect(service.send('otra')).toBe(false);
  });

  it('canSend follows the connection status', async () => {
    const { service, realtime } = await loaded([]);
    expect(service.canSend()).toBe(true);
    realtime.status.set('closed');
    expect(service.canSend()).toBe(false);
  });

  it('reloads the thread after a reconnection', async () => {
    const { service, http, realtime } = await loaded([api({ id: 1 })]);
    realtime.reconnected.next();
    http.expectOne(r => r.url === messagesUrl).flush([api({ id: 1 }), api({ id: 2 })]);
    await vi.waitFor(() => expect(service.customerMessages()).toHaveLength(2));
  });

  it('keeps what it had and reports an error when loading fails', async () => {
    const { service, http, realtime } = await loaded([api({ id: 1 })]);
    realtime.reconnected.next();
    http.expectOne(r => r.url === messagesUrl).flush('boom', { status: 500, statusText: 'Server Error' });
    await vi.waitFor(() => expect(service.loadError()).not.toBe(''));
    expect(service.customerMessages()).toHaveLength(1);
  });

  it('clears the thread on logout', async () => {
    const { service, user } = await loaded([api({ id: 1 })]);
    user.set(undefined);
    TestBed.tick();
    expect(service.customerMessages()).toEqual([]);
  });
});
