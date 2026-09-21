import { DatePipe } from '@angular/common';
import { Component, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { LucideAngularModule, MessageCircle, Send, X } from 'lucide-angular';
import { AuthService } from '../../../core/services/auth.service';
import { ChatService } from '../../../core/services/chat.service';

@Component({
  selector: 'app-chat-widget',
  standalone: true,
  imports: [DatePipe, LucideAngularModule],
  templateUrl: './chat-widget.html',
  styleUrl: './chat-widget.scss',
})
export class ChatWidgetComponent {
  private auth = inject(AuthService);
  chat = inject(ChatService);

  readonly MessageCircle = MessageCircle;
  readonly Send = Send;
  readonly X = X;

  visible = computed(() => this.auth.currentUser()?.role === 'customer');
  open = signal(false);
  draft = signal('');
  private list = viewChild<ElementRef<HTMLElement>>('list');

  constructor() {
    // Con el panel abierto, lo que llega se da por leído.
    effect(() => {
      if (this.open() && this.chat.customerUnread() > 0) untracked(() => this.chat.markRead());
    });
    // Siempre al último mensaje.
    effect(() => {
      this.chat.customerMessages();
      const el = this.list()?.nativeElement;
      if (el) setTimeout(() => (el.scrollTop = el.scrollHeight));
    });
  }

  toggle(): void {
    this.open.update(v => !v);
  }

  close(): void {
    this.open.set(false);
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    this.submit();
  }

  onEnter(event: Event): void {
    if ((event as KeyboardEvent).shiftKey) return;
    event.preventDefault();
    this.submit();
  }

  private submit(): void {
    const body = this.draft().trim();
    if (!body || !this.chat.canSend()) return;
    if (this.chat.send(body)) this.draft.set('');
  }
}
