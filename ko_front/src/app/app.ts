import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { RealtimeService } from './core/services/realtime.service';
import { NavbarComponent } from './shared/components/navbar/navbar';
import { FooterComponent } from './shared/components/footer/footer';
import { ChatWidgetComponent } from './shared/components/chat-widget/chat-widget';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, NavbarComponent, FooterComponent, ChatWidgetComponent],
  template: `
    <app-navbar />
    <main id="contenido">
      <router-outlet />
    </main>
    <app-footer />
    <app-chat-widget />
  `,
  styles: [`
    main { display: block; min-height: 70vh; }
  `]
})
export class App {
  // Instanciarlo aquí abre el websocket en cuanto hay sesión.
  private realtime = inject(RealtimeService);
}
