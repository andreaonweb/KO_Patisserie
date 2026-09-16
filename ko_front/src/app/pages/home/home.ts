import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BusService } from '../../core/services/bus.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class HomeComponent {
  busService = inject(BusService);
}