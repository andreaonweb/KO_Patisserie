import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NavbarComponent } from './shared/components/navbar/navbar';
import { FooterComponent } from './shared/components/footer/footer';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, NavbarComponent, FooterComponent],
  template: `
    <app-navbar />
    <main id="contenido">
      <router-outlet />
    </main>
    <app-footer />
  `,
  styles: [`
    main { display: block; min-height: 70vh; }
  `]
})
export class App { }
