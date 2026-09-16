import { Component } from '@angular/core';

@Component({
  selector: 'app-footer',
  standalone: true,
  template: `
    <footer class="footer">
      <p>🌸 Sakura Pâtisserie · Hecho con amor y matcha · {{ year }}</p>
    </footer>
  `,
  styles: [`
    @use '../../../../styles/variables' as *;
    .footer {
      text-align: center;
      padding: 1.5rem;
      background: white;
      border-top: 1px solid #f0dde5;
      color: #9e8e8e;
      font-size: 0.85rem;
    }
  `]
})
export class FooterComponent {
  year = new Date().getFullYear();
}