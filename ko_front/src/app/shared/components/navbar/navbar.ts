import { Component, ElementRef, HostListener, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { CurrencyPipe } from '@angular/common';
import { AuthService } from '../../../core/services/auth.service';
import { CartService } from '../../../core/services/cart.service';
import { ProductIconComponent } from '../product-icon/product-icon';
import {
  LucideAngularModule,
  House,
  UtensilsCrossed,
  Heart,
  ShoppingBag,
  Settings,
  ClipboardList,
  Menu,
  X,
} from 'lucide-angular';

/** A partir de este ancho (px) las pestañas pasan al menú lateral; debe coincidir con el SCSS. */
const MOBILE_MAX_WIDTH = 900;

const FOCUSABLE = 'button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Mantiene el tabulador dentro de un panel modal. */
function trapTab(event: Event, panel: HTMLElement | undefined): void {
  if (!panel) return;
  const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
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

  /** Enlaces de navegación: los mismos en la barra de escritorio y en el menú móvil. */
  links = computed(() => {
    const role = this.auth.currentUser()?.role;
    return [
      { path: '/home', label: 'Inicio' },
      { path: '/menu', label: 'Menú' },
      { path: '/about', label: 'Nosotros' },
      ...(role === 'customer' ? [{ path: '/pedidos', label: 'Mis pedidos' }] : []),
      ...(role === 'admin' ? [{ path: '/admin', label: 'Admin' }] : []),
    ];
  });

  itemsLabel = computed(() => {
    const n = this.cart.itemCount();
    return `${n} ${n === 1 ? 'artículo' : 'artículos'}`;
  });

  cartOpen = signal(false);
  menuOpen = signal(false);
  cartItems = this.cart.getItems();

  private cartButton = viewChild<ElementRef<HTMLButtonElement>>('cartBtn');
  private closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeBtn');
  private cartPanel = viewChild<ElementRef<HTMLElement>>('cartPanel');
  private cartWasOpen = false;

  private menuButton = viewChild<ElementRef<HTMLButtonElement>>('menuBtn');
  private menuCloseButton = viewChild<ElementRef<HTMLButtonElement>>('menuCloseBtn');
  private menuPanel = viewChild<ElementRef<HTMLElement>>('menuPanel');
  private menuWasOpen = false;

  readonly House = House;
  readonly UtensilsCrossed = UtensilsCrossed;
  readonly Heart = Heart;
  readonly ShoppingBag = ShoppingBag;
  readonly Settings = Settings;
  readonly ClipboardList = ClipboardList;
  readonly MenuIcon = Menu;
  readonly X = X;

  constructor() {
    // El foco entra en el panel al abrirlo y vuelve al botón que lo abrió al cerrarlo (WCAG 2.4.3).
    effect(() => {
      const open = this.cartOpen();
      untracked(() => {
        if (open) setTimeout(() => this.closeButton()?.nativeElement.focus());
        else if (this.cartWasOpen) this.cartButton()?.nativeElement.focus();
        this.cartWasOpen = open;
      });
    });
    effect(() => {
      const open = this.menuOpen();
      untracked(() => {
        if (open) setTimeout(() => this.menuCloseButton()?.nativeElement.focus());
        else if (this.menuWasOpen) this.menuButton()?.nativeElement.focus();
        this.menuWasOpen = open;
      });
    });
  }

  toggleCart(): void {
    this.cartOpen.update(v => !v);
  }

  closeCart(): void {
    this.cartOpen.set(false);
  }

  toggleMenu(): void {
    this.menuOpen.update(v => !v);
  }

  closeMenu(): void {
    this.menuOpen.set(false);
  }

  trapFocus(event: Event): void {
    trapTab(event, this.cartPanel()?.nativeElement);
  }

  trapMenuFocus(event: Event): void {
    trapTab(event, this.menuPanel()?.nativeElement);
  }

  /** Si la ventana se ensancha con el menú abierto, ya no hace falta: las pestañas vuelven a la barra. */
  @HostListener('window:resize')
  onResize(): void {
    if (this.menuOpen() && window.innerWidth > MOBILE_MAX_WIDTH) this.closeMenu();
  }
}
