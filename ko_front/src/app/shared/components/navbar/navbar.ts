import { Component, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { CurrencyPipe } from '@angular/common';
import { AuthService } from '../../../core/services/auth.service';
import { CartService } from '../../../core/services/cart.service';
import { ProductIconComponent } from '../product-icon/product-icon';
import { LucideAngularModule, House, UtensilsCrossed, Heart, ShoppingBag, Settings, ClipboardList } from 'lucide-angular';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, CurrencyPipe, LucideAngularModule, ProductIconComponent],
  templateUrl: './navbar.html',
  styleUrl: './navbar.scss',
})
export class NavbarComponent {
  auth = inject(AuthService);
  cart = inject(CartService);

  itemsLabel = computed(() => {
    const n = this.cart.itemCount();
    return `${n} ${n === 1 ? 'artículo' : 'artículos'}`;
  });

  cartOpen = signal(false);
  cartItems = this.cart.getItems();

  private cartButton = viewChild<ElementRef<HTMLButtonElement>>('cartBtn');
  private closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeBtn');
  private cartPanel = viewChild<ElementRef<HTMLElement>>('cartPanel');
  private cartWasOpen = false;

  readonly House = House;
  readonly UtensilsCrossed = UtensilsCrossed;
  readonly Heart = Heart;
  readonly ShoppingBag = ShoppingBag;
  readonly Settings = Settings;
  readonly ClipboardList = ClipboardList;

  constructor() {
    // El foco entra en el carrito al abrirlo y vuelve al botón que lo abrió al cerrarlo (WCAG 2.4.3).
    effect(() => {
      const open = this.cartOpen();
      untracked(() => {
        if (open) setTimeout(() => this.closeButton()?.nativeElement.focus());
        else if (this.cartWasOpen) this.cartButton()?.nativeElement.focus();
        this.cartWasOpen = open;
      });
    });
  }

  toggleCart(): void {
    this.cartOpen.update(v => !v);
  }

  closeCart(): void {
    this.cartOpen.set(false);
  }

  /** Mantiene el tabulador dentro del carrito mientras está abierto. */
  trapFocus(event: Event): void {
    const panel = this.cartPanel()?.nativeElement;
    if (!panel) return;
    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const shift = (event as KeyboardEvent).shiftKey;
    if (shift && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!shift && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}