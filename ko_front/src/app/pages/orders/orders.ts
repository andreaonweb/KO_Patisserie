import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { OrderService } from '../../core/services/order.service';
import { pollWhileVisible } from '../../core/utils/poll';
import type { Order } from '../../core/models/order.model';

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [CurrencyPipe, DatePipe, RouterLink],
  templateUrl: './orders.html',
  styleUrl: './orders.scss',
})
export class OrdersComponent {
  private orderService = inject(OrderService);

  loadError = signal('');
  orders = signal<Order[]>([]);

  constructor() {
    // Así el cliente ve los cambios de estado que hace el admin sin recargar la página.
    pollWhileVisible(
      () => this.orderService.getMine(),
      e => this.loadError.set(e.message ?? 'Error al cargar tus pedidos')
    )
      .pipe(takeUntilDestroyed())
      .subscribe(rows => {
        this.loadError.set('');
        this.orders.set(rows);
      });
  }
}
