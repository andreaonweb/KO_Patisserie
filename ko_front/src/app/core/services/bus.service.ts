import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BusStop, BusArrival } from '../models/bus-stop.model';
import { environment } from '../../../environments/environment';

const APP_ID  = environment.tmb.appId;
const APP_KEY = environment.tmb.appKey;
const BASE = 'https://api.tmb.cat/v1/itransit/bus/parades';

@Injectable({ providedIn: 'root' })
export class BusService {
  private http = inject(HttpClient);

  stops = signal<BusStop[]>([]);
  loading = signal(false);
  error = signal<string | null>(null);


  private readonly NEARBY_STOPS: Omit<BusStop, 'arrivals' | 'loadingArrivals'>[] = [
    { id: '2318', name: 'Pg. de Gràcia - Consell de Cent', address: 'Pg. de Gràcia, 76', distanceMeters: 85, lat: 41.3924, lon: 2.1635 },
    { id: '1042', name: 'Consell de Cent - Enric Granados', address: 'Consell de Cent, 290', distanceMeters: 130, lat: 41.3919, lon: 2.1578 },
    { id: '877', name: 'Aragó - Pg. de Gràcia', address: 'Carrer d\'Aragó, 248', distanceMeters: 210, lat: 41.3908, lon: 2.1639 },
    { id: '1155', name: 'Muntaner - Consell de Cent', address: 'Carrer de Muntaner, 213', distanceMeters: 270, lat: 41.3922, lon: 2.1561 },
  ];


  loadNearbyStops(): void {
    this.loading.set(true);
    this.error.set(null);

    this.stops.set(
      this.NEARBY_STOPS.map(s => ({ ...s, arrivals: [], loadingArrivals: true }))
    );
    this.loading.set(false);


    this.NEARBY_STOPS.forEach(stop => this.loadArrivalsForStop(stop.id));
  }


  private loadArrivalsForStop(codiParada: string): void {
    const url = `${BASE}/${codiParada}?app_id=${APP_ID}&app_key=${APP_KEY}`;

    this.http.get<any>(url).subscribe({
      next: (res) => {
        const arrivals: BusArrival[] = res.parades[0]?.linies_trajectes
          .flatMap((lt: any) =>
            lt.propers_busos.slice(0, 2).map((bus: any) => ({   // máximo 2 próximos
              lineName: lt.nom_linia,
              destination: lt.desti_trajecte,
              minutesAway: this.toMinutes(bus.temps_arribada),
              operator: lt.transit_namespace as 'bus' | 'amb',
            }))
          )
          .filter((a: BusArrival) => a.minutesAway >= 0)
          .sort((a: BusArrival, b: BusArrival) => a.minutesAway - b.minutesAway)
          ?? [];

        this.updateStop(codiParada, { arrivals, loadingArrivals: false });
      },
      error: () => {
        this.updateStop(codiParada, { arrivals: [], loadingArrivals: false });
      }
    });
  }


  private updateStop(id: string, patch: Partial<BusStop>): void {
    this.stops.update(list =>
      list.map(s => s.id === id ? { ...s, ...patch } : s)
    );
  }

  private toMinutes(timestamp: number): number {
    return Math.round((timestamp - Date.now()) / 60000);
  }
}