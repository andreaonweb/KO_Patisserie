import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'home', pathMatch: 'full' },
  {
    path: 'home',
    title: 'Inicio · KŌ Pâtisserie',
    loadComponent: () => import('./pages/home/home').then(m => m.HomeComponent),
  },
  {
    path: 'menu',
    title: 'Carta · KŌ Pâtisserie',
    loadComponent: () => import('./pages/menu/menu').then(m => m.MenuComponent),
    canActivate: [authGuard],
  },
  {
    path: 'admin',
    title: 'Administración · KŌ Pâtisserie',
    loadComponent: () => import('./pages/admin/admin').then(m => m.AdminComponent),
    canActivate: [authGuard],
  },
  {
    path: 'about',
    title: 'Nosotros · KŌ Pâtisserie',
    loadComponent: () => import('./pages/about/about').then(m => m.AboutComponent),
  },
  {
    path: 'auth',
    title: 'Entrar · KŌ Pâtisserie',
    loadComponent: () => import('./pages/auth/auth').then(m => m.AuthComponent),
  },
  {
    path: 'checkout',
    title: 'Confirmar pedido · KŌ Pâtisserie',
    loadComponent: () => import('./pages/checkout/checkout').then(m => m.CheckoutComponent),
    canActivate: [authGuard],
  },
  {
    path: 'checkout/confirmacion/:id',
    title: 'Pedido confirmado · KŌ Pâtisserie',
    loadComponent: () => import('./pages/checkout/confirmation').then(m => m.ConfirmationComponent),
    canActivate: [authGuard],
  },
  {
    path: 'pedidos',
    title: 'Mis pedidos · KŌ Pâtisserie',
    loadComponent: () => import('./pages/orders/orders').then(m => m.OrdersComponent),
    canActivate: [authGuard],
  },
  { path: '**', redirectTo: 'home' },
];