import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './auth.html',
  styleUrl: './auth.scss',
})
export class AuthComponent {
  auth = inject(AuthService);

  isLogin = signal(true);
  email = '';
  password = '';
  error = signal('');
  loading = signal(false);

  toggleMode(): void {
    this.isLogin.update(v => !v);
    this.error.set('');
  }

  fillDemoAccount(): void {
    this.isLogin.set(true);
    this.email = 'admin@email.com';
    this.password = 'admin123';
  }

  async submit(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      if (this.isLogin()) {
        await this.auth.login(this.email, this.password);
      } else {
        await this.auth.register(this.email, this.password);
      }
    } catch (e: any) {
      this.error.set('❌ ' + (e.message ?? 'Error desconocido'));
    } finally {
      this.loading.set(false);
    }
  }
}