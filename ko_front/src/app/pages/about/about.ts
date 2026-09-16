import { Component } from '@angular/core';

@Component({
  selector: 'app-about',
  standalone: true,
  templateUrl: './about.html',
  styleUrl: './about.scss',
})
export class AboutComponent {
  values = [
    { emoji: '🌿', title: 'Natural', desc: 'Sin colorantes ni conservantes artificiales.' },
    { emoji: '🤍', title: 'Artesanal', desc: 'Cada pieza moldeada a mano cada mañana.' },
    { emoji: '♻️', title: 'Sostenible', desc: 'Packaging reciclable y proveedores locales.' },
  ];
}