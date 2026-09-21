import { DatePipe } from '@angular/common';
import { Component, DestroyRef, ElementRef, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { ChatService } from '../../../core/services/chat.service';

@Component({
  selector: 'app-admin-chat',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './admin-chat.html',
  styleUrl: './admin-chat.scss',
})
export class AdminChatComponent {
  chat = inject(ChatService);
  draft = signal('');
  private list = viewChild<ElementRef<HTMLElement>>('list');

  constructor() {
    // Al salir de la pestaña se cierra la conversación: lo que llegue después cuenta como no leído.
    inject(DestroyRef).onDestroy(() => this.chat.closeThread());
    // Tras una recarga (p. ej. reconexión) el hilo abierto puede volver a tener no leídos: se marcan de nuevo.
    effect(() => {
      const id = this.chat.activeCustomerId();
      if (id === null) return;
      const unread = this.chat.threads().find(t => t.customerId === id)?.unreadCount ?? 0;
      if (unread > 0) untracked(() => this.chat.markReadFor(id));
    });
    effect(() => {
      this.chat.activeMessages();
      const el = this.list()?.nativeElement;
      if (el) setTimeout(() => (el.scrollTop = el.scrollHeight));
    });
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
    const customerId = this.chat.activeCustomerId();
    const body = this.draft().trim();
    if (customerId === null || !body || !this.chat.canSend()) return;
    if (this.chat.sendTo(customerId, body)) this.draft.set('');
  }
}
