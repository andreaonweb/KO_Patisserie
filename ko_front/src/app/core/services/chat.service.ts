import { HttpClient } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { ChatMessage, ChatMessageApi, ChatRole } from '../models/chat.model';
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

function upsert(list: ChatMessage[], message: ChatMessage): ChatMessage[] {
  return list.some(m => m.id === message.id) ? list.map(m => (m.id === message.id ? message : m)) : [...list, message];
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

  constructor() {
    effect(() => {
      const role = this.auth.currentUser()?.role;
      untracked(() => {
        this.customerMessages.set([]);
        this.loadError.set('');
        void this.load(role);
      });
    });
    this.realtime.events$.subscribe(event => this.onEvent(event));
    this.realtime.reconnected$.subscribe(() => void this.load(this.auth.currentUser()?.role));
  }

  async loadCustomerThread(): Promise<void> {
    const rows = await firstValueFrom(this.http.get<ChatMessageApi[]>(`${API}/messages`, { params: { limit: PAGE_SIZE } }));
    this.customerMessages.set(rows.map(messageFromApi));
  }

  /** Devuelve false si no se pudo enviar (conexión caída): el mensaje no se encola. */
  send(body: string): boolean {
    return this.realtime.send({ type: 'chat.send', body });
  }

  markRead(): void {
    if (this.customerUnread() > 0) this.realtime.send({ type: 'chat.read' });
  }

  private async load(role: AppUser['role'] | undefined): Promise<void> {
    try {
      if (role === 'customer') await this.loadCustomerThread();
      this.loadError.set('');
    } catch {
      this.loadError.set('No se pudo cargar el chat. Se reintentará al reconectar.');
    }
  }

  private onEvent(event: ServerEvent): void {
    const user = this.auth.currentUser();
    if (!user || user.role !== 'customer') return;
    if (event.type === 'chat.message') {
      const message = messageFromApi(event.message);
      if (message.customerId === user.id) this.customerMessages.update(list => upsert(list, message));
    } else if (event.type === 'chat.read' && event.customer_id === user.id) {
      this.customerMessages.update(list => withRead(list, event.reader_role));
    }
  }
}
