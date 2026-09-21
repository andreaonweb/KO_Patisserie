import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ChatService } from '../../../core/services/chat.service';
import { AdminChatComponent } from './admin-chat';
import type { ChatMessage, ChatThread } from '../../../core/models/chat.model';

class FakeChat {
  threads = signal<ChatThread[]>([]);
  activeCustomerId = signal<number | null>(null);
  activeMessages = signal<ChatMessage[]>([]);
  canSend = signal(true);
  loadError = signal('');
  openThread = vi.fn().mockResolvedValue(undefined);
  closeThread = vi.fn();
  sendTo = vi.fn().mockReturnValue(true);
  markReadFor = vi.fn();
}

const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 1,
  customerId: 7,
  senderId: 7,
  senderRole: 'customer',
  body: 'hola',
  createdAt: Date.parse('2026-09-21T10:00:00'),
  readAt: null,
  ...over,
});

const thread = (customerId: number, unread: number, body = 'hola'): ChatThread => ({
  customerId,
  customerEmail: `c${customerId}@x.com`,
  unreadCount: unread,
  lastMessage: msg({ id: customerId, customerId, body }),
});

describe('AdminChatComponent', () => {
  let fixture: ComponentFixture<AdminChatComponent>;
  let chat: FakeChat;
  const all = (selector: string) => Array.from(fixture.nativeElement.querySelectorAll(selector)) as HTMLElement[];
  const one = (selector: string) => fixture.nativeElement.querySelector(selector) as HTMLElement | null;

  beforeEach(async () => {
    chat = new FakeChat();
    await TestBed.configureTestingModule({
      imports: [AdminChatComponent],
      providers: [{ provide: ChatService, useValue: chat }],
    }).compileComponents();
    fixture = TestBed.createComponent(AdminChatComponent);
    fixture.detectChanges();
  });

  it('explains there are no conversations yet', () => {
    expect(one('.achat__list')?.textContent).toContain('Todavía no hay conversaciones');
  });

  it('lists the customers with their last message and unread badge', () => {
    chat.threads.set([thread(7, 2, 'necesito ayuda'), thread(8, 0)]);
    fixture.detectChanges();

    const rows = all('.achat__thread');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('c7@x.com');
    expect(rows[0].textContent).toContain('necesito ayuda');
    expect(rows[0].querySelector('.achat__badge')?.textContent?.trim()).toBe('2');
    expect(rows[1].querySelector('.achat__badge')).toBeNull();
  });

  it('opens a conversation when a thread is chosen', () => {
    chat.threads.set([thread(7, 1)]);
    fixture.detectChanges();
    all('.achat__thread')[0].click();
    expect(chat.openThread).toHaveBeenCalledWith(7);
  });

  it('asks to pick a conversation until one is open', () => {
    expect(one('.achat__conversation')?.textContent).toContain('Elige una conversación');
    chat.activeCustomerId.set(7);
    fixture.detectChanges();
    expect(one('.achat__form')).not.toBeNull();
  });

  it('renders the open conversation as text', () => {
    chat.threads.set([thread(7, 0)]);
    chat.activeCustomerId.set(7);
    chat.activeMessages.set([msg({ id: 1, body: '<i>hola</i>' }), msg({ id: 2, senderRole: 'admin', senderId: 1, body: 'buenas' })]);
    fixture.detectChanges();

    const items = all('.achat__msg');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('<i>hola</i>');
    expect(items[0].querySelector('i')).toBeNull();
    expect(items[1].classList).toContain('achat__msg--mine');
  });

  it('replies to the open customer and clears the draft', () => {
    chat.activeCustomerId.set(7);
    fixture.detectChanges();
    const textarea = one('.achat__input') as HTMLTextAreaElement;
    textarea.value = '  Claro que sí  ';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges(); // como en el navegador, la vista se refresca tras el evento de entrada
    (one('.achat__form') as HTMLFormElement).dispatchEvent(new Event('submit'));

    expect(chat.sendTo).toHaveBeenCalledWith(7, 'Claro que sí');
    fixture.detectChanges();
    expect((one('.achat__input') as HTMLTextAreaElement).value).toBe('');
  });

  it('does not send empty replies or while the connection is down', () => {
    chat.activeCustomerId.set(7);
    fixture.detectChanges();
    (one('.achat__form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    expect(chat.sendTo).not.toHaveBeenCalled();

    chat.canSend.set(false);
    const textarea = one('.achat__input') as HTMLTextAreaElement;
    textarea.value = 'hola';
    textarea.dispatchEvent(new Event('input'));
    (one('.achat__form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(chat.sendTo).not.toHaveBeenCalled();
    expect(one('.achat__offline')?.textContent).toContain('Reconectando');
  });

  it('marks the open thread read when it has unread messages', () => {
    chat.threads.set([thread(7, 2)]);
    chat.activeCustomerId.set(7);
    fixture.detectChanges();
    expect(chat.markReadFor).toHaveBeenCalledWith(7);
  });

  it('does not mark the open thread read when nothing is unread', () => {
    chat.threads.set([thread(7, 0)]);
    chat.activeCustomerId.set(7);
    fixture.detectChanges();
    expect(chat.markReadFor).not.toHaveBeenCalled();
  });

  it('marks the open thread read when it becomes unread later (after a reconnect reload)', () => {
    chat.threads.set([thread(7, 0)]);
    chat.activeCustomerId.set(7);
    fixture.detectChanges();
    expect(chat.markReadFor).not.toHaveBeenCalled();

    chat.threads.set([thread(7, 3)]);
    fixture.detectChanges();
    expect(chat.markReadFor).toHaveBeenCalledWith(7);
  });

  it('closes the open conversation when the tab is left', () => {
    fixture.destroy();
    expect(chat.closeThread).toHaveBeenCalled();
  });
});
