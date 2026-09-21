import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BusService } from '../../core/services/bus.service';
import { LucideAngularModule, Leaf, HandHeart, Package } from 'lucide-angular';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink, LucideAngularModule],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class HomeComponent {
  busService = inject(BusService);
  readonly Leaf = Leaf;
  readonly HandHeart = HandHeart;
  readonly Package = Package;

  scrollToStops(): void {
    document.getElementById('como-llegar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
