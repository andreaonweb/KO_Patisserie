import { Component } from '@angular/core';
import { LucideAngularModule, Leaf, HandHeart, Recycle } from 'lucide-angular';

@Component({
  selector: 'app-about',
  standalone: true,
  imports: [LucideAngularModule],
  templateUrl: './about.html',
  styleUrl: './about.scss',
})
export class AboutComponent {
  values = [
    { icon: Leaf, title: 'Natural', desc: 'Sin colorantes ni conservantes artificiales.' },
    { icon: HandHeart, title: 'Artesanal', desc: 'Cada pieza moldeada a mano cada mañana.' },
    { icon: Recycle, title: 'Sostenible', desc: 'Packaging reciclable y proveedores locales.' },
  ];
}
