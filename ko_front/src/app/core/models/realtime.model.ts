import type { ChatMessageApi, ChatRole } from './chat.model';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

export interface ReadyEvent {
  type: 'ready';
  user: { id: number; role: 'admin' | 'customer' };
}

export interface ErrorEvent {
  type: 'error';
  code: string;
  detail: string;
}

export interface ChatMessageEvent {
  type: 'chat.message';
  message: ChatMessageApi;
}

export interface ChatReadEvent {
  type: 'chat.read';
  customer_id: number;
  reader_role: ChatRole;
}

/** Eventos que envía el servidor. Se amplía en las ramas de chat y pedidos. */
export type ServerEvent = ReadyEvent | ErrorEvent | ChatMessageEvent | ChatReadEvent;
