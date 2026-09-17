import { Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { catchError, of } from 'rxjs';
import { OrderService } from '../../core/services/order.service';
import type { Order } from '../../core/models/order.model';

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [CurrencyPipe, DatePipe],
  templateUrl: './orders.html',
  styleUrl: './orders.scss',
})
export class OrdersComponent {
  private orderService = inject(OrderService);

  loadError = signal('');

  orders = toSignal(
    this.orderService.getMine().pipe(
      catchError(e => {
        this.loadError.set('❌ ' + (e.message ?? 'Error al cargar tus pedidos'));
        return of([] as Order[]);
      })
    ),
    { initialValue: [] as Order[] }
  );
}
