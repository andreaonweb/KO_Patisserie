import { Injectable, signal, computed } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class CounterService {
    private count = signal<number>(0);

    resultado = computed(() => this.count());
    total = computed(() => this.count() * 3.5);

    aumentar(): void { this.count.update(n => n + 1); }
    disminuir(): void { this.count.update(n => n - 1); }
    resetear(): void { this.count.set(0); }
}