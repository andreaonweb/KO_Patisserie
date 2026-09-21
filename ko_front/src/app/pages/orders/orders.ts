import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { OrderService, orderFromApi } from '../../core/services/order.service';
import { RealtimeService } from '../../core/services/realtime.service';
import { LiveOrderList } from '../../core/utils/orders';

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [CurrencyPipe, DatePipe, RouterLink],
  templateUrl: './orders.html',
  styleUrl: './orders.scss',
})
export class OrdersComponent {
  private orderService = inject(OrderService);
  private realtime = inject(RealtimeService);

  loadError = signal('');
  private feed = new LiveOrderList();
  orders = this.feed.orders;

  constructor() {
    void this.load();
    // Recarga al reconectar por si se perdió algún evento.
    this.realtime.reconnected$.pipe(takeUntilDestroyed()).subscribe(() => void this.load());
    // Los cambios de estado que hace el admin llegan al instante.
    this.realtime.events$.pipe(takeUntilDestroyed()).subscribe(event => {
      if (event.type === 'order.updated' || event.type === 'order.created') {
        this.feed.apply(orderFromApi(event.order));
      }
    });
  }

  private async load(): Promise<void> {
    try {
      await this.feed.load(() => firstValueFrom(this.orderService.getMine()));
      this.loadError.set('');
    } catch (e) {
      // Se conservan los últimos pedidos mostrados.
      this.loadError.set((e as { message?: string }).message ?? 'Error al cargar tus pedidos');
    }
  }
}
