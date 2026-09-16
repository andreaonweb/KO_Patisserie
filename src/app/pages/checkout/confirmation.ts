import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CurrencyPipe } from '@angular/common';
import { OrderService } from '../../core/services/order.service';
import type { Order } from '../../core/models/order.model';

@Component({
  selector: 'app-confirmation',
  standalone: true,
  imports: [CurrencyPipe],
  templateUrl: './confirmation.html',
  styleUrl: './confirmation.scss',
})
export class ConfirmationComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private orderService = inject(OrderService);

  order = signal<Order | undefined>(undefined);
  loading = signal(true);
  error = signal('');

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id')!;
    try {
      this.order.set(await this.orderService.getById(id));
    } catch (e: any) {
      this.error.set('❌ ' + (e.message ?? 'Error al cargar tu pedido'));
    } finally {
      this.loading.set(false);
    }
  }
}
