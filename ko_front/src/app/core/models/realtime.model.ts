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

/** Eventos que envía el servidor. Se amplía en las ramas de chat y pedidos. */
export type ServerEvent = ReadyEvent | ErrorEvent;
