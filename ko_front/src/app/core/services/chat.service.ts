import { HttpClient } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { ChatMessage, ChatMessageApi, ChatRole, ChatThread, ChatThreadApi } from '../models/chat.model';
import type { ServerEvent } from '../models/realtime.model';
import type { AppUser } from '../models/user.model';
import { AuthService } from './auth.service';
import { RealtimeService } from './realtime.service';

const API = `${environment.apiUrl}/chat`;
const PAGE_SIZE = 50;

export function messageFromApi(m: ChatMessageApi): ChatMessage {
  return {
    id: m.id,
    customerId: m.customer_id,
    senderId: m.sender_id,
    senderRole: m.sender_role,
    body: m.body,
    createdAt: Date.parse(m.created_at),
    readAt: m.read_at ? Date.parse(m.read_at) : null,
  };
}

export function threadFromApi(t: ChatThreadApi): ChatThread {
  return {
    customerId: t.customer_id,
    customerEmail: t.customer_email,
    lastMessage: messageFromApi(t.last_message),
    unreadCount: t.unread_count,
  };
}

/** Une la lista cargada con la actual: por cliente gana la copia con el último mensaje más nuevo (empate: servidor). */
function mergeThreads(current: ChatThread[], loaded: ChatThread[]): ChatThread[] {
  if (current.length === 0) return loaded;
  const byCustomer = new Map(current.map(t => [t.customerId, t]));
  for (const t of loaded) {
    const live = byCustomer.get(t.customerId);
    byCustomer.set(t.customerId, live && live.lastMessage.id > t.lastMessage.id ? live : t);
  }
  return [...byCustomer.values()].sort((a, b) => b.lastMessage.id - a.lastMessage.id);
}

function upsert(list: ChatMessage[], message: ChatMessage): ChatMessage[] {
  return list.some(m => m.id === message.id) ? list.map(m => (m.id === message.id ? message : m)) : [...list, message];
}

/** Une lo cargado con lo actual: gana la copia del servidor, se conservan los mensajes en vivo y se ordena por id. */
export function mergeMessages(current: ChatMessage[], loaded: ChatMessage[]): ChatMessage[] {
  return loaded.reduce(upsert, current).slice().sort((a, b) => a.id - b.id);
}

/** Marca como leídos los mensajes que lee `readerRole` (los del otro lado). */
function withRead(list: ChatMessage[], readerRole: ChatRole): ChatMessage[] {
  const target: ChatRole = readerRole === 'admin' ? 'customer' : 'admin';
  const now = Date.now();
  return list.map(m => (m.senderRole === target && m.readAt === null ? { ...m, readAt: now } : m));
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private realtime = inject(RealtimeService);

  readonly canSend = computed(() => this.realtime.status() === 'open');
  readonly loadError = signal('');

  readonly customerMessages = signal<ChatMessage[]>([]);
  readonly customerUnread = computed(
    () => this.customerMessages().filter(m => m.senderRole === 'admin' && m.readAt === null).length
  );

  // Admin: lista de hilos y conversación abierta
  readonly threads = signal<ChatThread[]>([]);
  readonly activeCustomerId = signal<number | null>(null);
  readonly activeMessages = signal<ChatMessage[]>([]);
  readonly adminUnreadTotal = computed(() => this.threads().reduce((sum, t) => sum + t.unreadCount, 0));

  constructor() {
    effect(() => {
      const role = this.auth.currentUser()?.role;
      untracked(() => {
        this.reset();
        void this.load(role);
      });
    });
    this.realtime.events$.subscribe(event => this.onEvent(event));
    this.realtime.reconnected$.subscribe(() => void this.load(this.auth.currentUser()?.role));
  }

  async loadCustomerThread(): Promise<void> {
    const userId = this.auth.currentUser()?.id;
    const rows = await firstValueFrom(this.http.get<ChatMessageApi[]>(`${API}/messages`, { params: { limit: PAGE_SIZE } }));
    if (this.auth.currentUser()?.id !== userId) return;
    this.customerMessages.update(list => mergeMessages(list, rows.map(messageFromApi)));
  }

  /** Devuelve false si no se pudo enviar (conexión caída): el mensaje no se encola. */
  send(body: string): boolean {
    return this.realtime.send({ type: 'chat.send', body });
  }

  markRead(): void {
    if (this.customerUnread() > 0) this.realtime.send({ type: 'chat.read' });
  }

  // ---- admin ----

  async loadThreads(): Promise<void> {
    const userId = this.auth.currentUser()?.id;
    const rows = await firstValueFrom(this.http.get<ChatThreadApi[]>(`${API}/threads`));
    if (this.auth.currentUser()?.id !== userId) return;
    this.threads.update(list => mergeThreads(list, rows.map(threadFromApi)));
  }

  async openThread(customerId: number): Promise<void> {
    this.activeCustomerId.set(customerId);
    this.activeMessages.set([]);
    await this.loadActive(customerId);
    if ((this.threads().find(t => t.customerId === customerId)?.unreadCount ?? 0) > 0) this.markReadFor(customerId);
  }

  closeThread(): void {
    this.activeCustomerId.set(null);
    this.activeMessages.set([]);
  }

  sendTo(customerId: number, body: string): boolean {
    return this.realtime.send({ type: 'chat.send', body, customer_id: customerId });
  }

  markReadFor(customerId: number): void {
    this.realtime.send({ type: 'chat.read', customer_id: customerId });
  }

  // ---- interno ----

  private reset(): void {
    this.customerMessages.set([]);
    this.threads.set([]);
    this.activeCustomerId.set(null);
    this.activeMessages.set([]);
    this.loadError.set('');
  }

  private async loadActive(customerId: number): Promise<void> {
    const userId = this.auth.currentUser()?.id;
    const rows = await firstValueFrom(
      this.http.get<ChatMessageApi[]>(`${API}/threads/${customerId}/messages`, { params: { limit: PAGE_SIZE } })
    );
    if (this.auth.currentUser()?.id !== userId || this.activeCustomerId() !== customerId) return;
    this.activeMessages.update(list => mergeMessages(list, rows.map(messageFromApi)));
  }

  private async load(role: AppUser['role'] | undefined): Promise<void> {
    try {
      if (role === 'customer') {
        await this.loadCustomerThread();
      } else if (role === 'admin') {
        await this.loadThreads();
        const active = this.activeCustomerId();
        if (active !== null) await this.loadActive(active);
      }
      this.loadError.set('');
    } catch {
      this.loadError.set('No se pudo cargar el chat. Se reintentará al reconectar.');
    }
  }

  private onEvent(event: ServerEvent): void {
    const user = this.auth.currentUser();
    if (!user) return;
    if (event.type === 'chat.message') this.onMessage(user, messageFromApi(event.message));
    else if (event.type === 'chat.read') this.onRead(user, event.customer_id, event.reader_role);
  }

  private onMessage(user: AppUser, message: ChatMessage): void {
    if (user.role === 'customer') {
      if (message.customerId === user.id) this.customerMessages.update(list => upsert(list, message));
      return;
    }

    const isActive = this.activeCustomerId() === message.customerId;
    if (isActive) this.activeMessages.update(list => upsert(list, message));

    if (!this.threads().some(t => t.customerId === message.customerId)) {
      void this.loadThreads();
      return;
    }
    this.threads.update(list => {
      const thread = list.find(t => t.customerId === message.customerId)!;
      if (thread.lastMessage.id >= message.id) return list;
      const unread = thread.unreadCount + (message.senderRole === 'customer' && !isActive ? 1 : 0);
      return [{ ...thread, lastMessage: message, unreadCount: unread }, ...list.filter(t => t !== thread)];
    });
    if (isActive && message.senderRole === 'customer') this.markReadFor(message.customerId);
  }

  private onRead(user: AppUser, customerId: number, readerRole: ChatRole): void {
    if (user.role === 'customer') {
      if (customerId === user.id) this.customerMessages.update(list => withRead(list, readerRole));
      return;
    }
    if (readerRole === 'admin') {
      this.threads.update(list => list.map(t => (t.customerId === customerId ? { ...t, unreadCount: 0 } : t)));
    }
    if (this.activeCustomerId() === customerId) this.activeMessages.update(list => withRead(list, readerRole));
  }
}
