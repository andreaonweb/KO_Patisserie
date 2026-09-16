import { Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { CurrencyPipe } from '@angular/common';
import { AuthService } from '../../../core/services/auth.service';
import { CartService } from '../../../core/services/cart.service';
import { LucideAngularModule, House, UtensilsCrossed, Heart, ShoppingBag, Settings, ClipboardList } from 'lucide-angular';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, CurrencyPipe, LucideAngularModule],
  templateUrl: './navbar.html',
  styleUrl: './navbar.scss',
})
export class NavbarComponent {
  auth = inject(AuthService);
  cart = inject(CartService);

  cartOpen = signal(false);
  cartItems = this.cart.getItems();

  readonly House = House;
  readonly UtensilsCrossed = UtensilsCrossed;
  readonly Heart = Heart;
  readonly ShoppingBag = ShoppingBag;
  readonly Settings = Settings;
  readonly ClipboardList = ClipboardList;

  toggleCart(): void {
    this.cartOpen.update(v => !v);
  }
}