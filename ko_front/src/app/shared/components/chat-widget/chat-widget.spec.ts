import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthService } from '../../../core/services/auth.service';
import { ChatService } from '../../../core/services/chat.service';
import { ChatWidgetComponent } from './chat-widget';
import type { AppUser } from '../../../core/models/user.model';
import type { ChatMessage } from '../../../core/models/chat.model';

class FakeChat {
  customerMessages = signal<ChatMessage[]>([]);
  customerUnread = signal(0);
  canSend = signal(true);
  loadError = signal('');
  send = vi.fn().mockReturnValue(true);
  markRead = vi.fn();
}

const message = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 1,
  customerId: 5,
  senderId: 5,
  senderRole: 'customer',
  body: 'hola',
  createdAt: Date.parse('2026-09-21T10:00:00'),
  readAt: null,
  ...over,
});

describe('ChatWidgetComponent', () => {
  let fixture: ComponentFixture<ChatWidgetComponent>;
  let user: ReturnType<typeof signal<AppUser | undefined>>;
  let chat: FakeChat;
  const el = (selector: string) => fixture.nativeElement.querySelector(selector) as HTMLElement | null;

  beforeEach(async () => {
    user = signal<AppUser | undefined>({ id: 5, email: 'c@x.com', role: 'customer' });
    chat = new FakeChat();
    await TestBed.configureTestingModule({
      imports: [ChatWidgetComponent],
      providers: [
        { provide: AuthService, useValue: { currentUser: user } },
        { provide: ChatService, useValue: chat },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ChatWidgetComponent);
    fixture.detectChanges();
  });

  const open = () => {
    el('.chat__fab')!.click();
    fixture.detectChanges();
  };

  it('shows the help button to customers', () => {
    expect(el('.chat__fab')?.textContent).toContain('¿Necesitas ayuda?');
  });

  it('is hidden for admins and for logged-out users', () => {
    user.set({ id: 1, email: 'a@x.com', role: 'admin' });
    fixture.detectChanges();
    expect(el('.chat__fab')).toBeNull();
    user.set(undefined);
    fixture.detectChanges();
    expect(el('.chat')).toBeNull();
  });

  it('opens the panel, and closes it with the close button and with Escape', () => {
    open();
    expect(el('.chat__panel')).not.toBeNull();
    el('.chat__close')!.click();
    fixture.detectChanges();
    expect(el('.chat__panel')).toBeNull();

    open();
    el('.chat__panel')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(el('.chat__panel')).toBeNull();
  });

  it('shows an unread badge only while the panel is closed', () => {
    chat.customerUnread.set(2);
    fixture.detectChanges();
    expect(el('.chat__badge')?.textContent?.trim()).toBe('2');
    open();
    expect(el('.chat__fab .chat__badge')).toBeNull();
  });

  it('marks messages as read when the panel is open and there is something unread', () => {
    chat.customerUnread.set(1);
    fixture.detectChanges();
    expect(chat.markRead).not.toHaveBeenCalled();
    open();
    expect(chat.markRead).toHaveBeenCalled();
  });

  it('renders messages as text, distinguishing who wrote them', () => {
    chat.customerMessages.set([
      message({ id: 1, body: '<b>hola</b>' }),
      message({ id: 2, senderRole: 'admin', senderId: 1, body: 'buenas' }),
    ]);
    open();
    const items = fixture.nativeElement.querySelectorAll('.chat__msg');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('<b>hola</b>');
    expect(items[0].querySelector('b')).toBeNull();
    expect(items[0].classList).toContain('chat__msg--mine');
    expect(items[1].classList).not.toContain('chat__msg--mine');
  });

  it('sends the trimmed draft and clears it', () => {
    open();
    const textarea = el('.chat__input') as HTMLTextAreaElement;
    textarea.value = '  ¿Tenéis tartas?  ';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (el('.chat__form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    expect(chat.send).toHaveBeenCalledWith('¿Tenéis tartas?');
    fixture.detectChanges();
    expect((el('.chat__input') as HTMLTextAreaElement).value).toBe('');
  });

  it('keeps the draft when the message could not be sent', () => {
    chat.send.mockReturnValue(false);
    open();
    const textarea = el('.chat__input') as HTMLTextAreaElement;
    textarea.value = 'hola';
    textarea.dispatchEvent(new Event('input'));
    (el('.chat__form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(textarea.value).toBe('hola');
  });

  it('does not send empty drafts', () => {
    open();
    (el('.chat__form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    expect(chat.send).not.toHaveBeenCalled();
  });

  it('disables sending and shows a notice while the connection is down', () => {
    chat.canSend.set(false);
    open();
    expect(el('.chat__offline')?.textContent).toContain('Reconectando');
    expect((el('.chat__send') as HTMLButtonElement).disabled).toBe(true);
  });

  describe('accessibility', () => {
    const tick = () => new Promise(resolve => setTimeout(resolve));

    it('focuses the message box when the panel opens and returns focus to the button on close', async () => {
      open();
      await tick();
      expect(document.activeElement).toBe(el('.chat__input'));

      el('.chat__close')!.click();
      fixture.detectChanges();
      await tick();
      expect(document.activeElement).toBe(el('.chat__fab'));
    });

    it('keeps the visible label in the button name (no aria-label that hides it)', () => {
      const fab = el('.chat__fab')!;
      expect(fab.getAttribute('aria-label')).toBeNull();
      expect(fab.textContent).toContain('¿Necesitas ayuda?');
    });
  });
});
