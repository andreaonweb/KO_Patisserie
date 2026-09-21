import { Injectable, InjectionToken, effect, inject, signal, untracked } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { ConnectionStatus, ServerEvent } from '../models/realtime.model';
import { AuthService } from './auth.service';
import { getToken } from './token-storage';

export type SocketFactory = (url: string) => WebSocket;

export const WEBSOCKET_FACTORY = new InjectionToken<SocketFactory>('WEBSOCKET_FACTORY', {
  providedIn: 'root',
  factory: () => (url: string) => new WebSocket(url),
});

const CLOSE_UNAUTHORIZED = 4401;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;

const wsUrl = (): string => `${environment.apiUrl.replace(/^http/, 'ws')}/ws`;

/** Única pieza que toca el WebSocket: autentica, reconecta y reparte los eventos tipados. */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private auth = inject(AuthService);
  private createSocket = inject(WEBSOCKET_FACTORY);

  readonly status = signal<ConnectionStatus>('closed');

  private readonly eventsSubject = new Subject<ServerEvent>();
  private readonly reconnectedSubject = new Subject<void>();
  readonly events$: Observable<ServerEvent> = this.eventsSubject.asObservable();
  /** Se emite al volver a estar listo tras una caída: los consumidores recargan lo que pudieron perder. */
  readonly reconnected$: Observable<void> = this.reconnectedSubject.asObservable();

  private socket: WebSocket | null = null;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private hasBeenReady = false;

  constructor() {
    effect(() => {
      const loggedIn = !!this.auth.currentUser();
      untracked(() => (loggedIn ? this.connect() : this.disconnect()));
    });
  }

  /** Devuelve false (y no envía nada) si la conexión no está lista. */
  send(frame: object): boolean {
    if (this.status() !== 'open' || !this.socket) return false;
    this.socket.send(JSON.stringify(frame));
    return true;
  }

  private connect(): void {
    if (this.socket) return;
    const token = getToken();
    if (!token) return;

    this.clearRetry();
    this.status.set('connecting');
    const socket = this.createSocket(wsUrl());
    this.socket = socket;
    socket.onopen = () => socket.send(JSON.stringify({ type: 'auth', token }));
    socket.onmessage = message => this.handleMessage(message.data as string);
    socket.onclose = event => this.handleClose(socket, event.code);
  }

  private disconnect(): void {
    this.clearRetry();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.close();
    }
    this.status.set('closed');
    this.attempt = 0;
    this.hasBeenReady = false;
  }

  private handleMessage(data: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { type?: unknown }).type !== 'string') return;
    const event = parsed as ServerEvent;
    if (event.type === 'ready') {
      this.attempt = 0;
      this.status.set('open');
      if (this.hasBeenReady) this.reconnectedSubject.next();
      this.hasBeenReady = true;
    }
    this.eventsSubject.next(event);
  }

  private handleClose(socket: WebSocket, code: number): void {
    if (this.socket !== socket) return;
    this.socket = null;
    this.status.set('closed');
    if (code === CLOSE_UNAUTHORIZED) {
      void this.auth.logout();
      return;
    }
    if (this.auth.currentUser()) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    const delay = Math.min(BASE_DELAY_MS * 2 ** this.attempt, MAX_DELAY_MS);
    this.attempt++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}
