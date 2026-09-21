export type ChatRole = 'admin' | 'customer';

/** Forma del servidor (snake_case). */
export interface ChatMessageApi {
  id: number;
  customer_id: number;
  sender_id: number;
  sender_role: ChatRole;
  body: string;
  created_at: string;
  read_at: string | null;
}

export interface ChatThreadApi {
  customer_id: number;
  customer_email: string;
  last_message: ChatMessageApi;
  unread_count: number;
}

export interface ChatMessage {
  id: number;
  customerId: number;
  senderId: number;
  senderRole: ChatRole;
  body: string;
  createdAt: number;
  readAt: number | null;
}

export interface ChatThread {
  customerId: number;
  customerEmail: string;
  lastMessage: ChatMessage;
  unreadCount: number;
}
