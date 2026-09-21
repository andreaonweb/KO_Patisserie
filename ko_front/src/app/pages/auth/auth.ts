import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';

const DEMO_ACCOUNTS = {
  admin: { email: 'admin@email.com', password: 'admin123' },
  customer: { email: 'cliente@email.com', password: 'cliente123' },
} as const;

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

  async demoLogin(role: 'admin' | 'customer'): Promise<void> {
    this.isLogin.set(true);
    const demo = DEMO_ACCOUNTS[role];
    this.email = demo.email;
    this.password = demo.password;
    await this.submit();
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
      this.error.set((e.message ?? 'Error desconocido'));
    } finally {
      this.loading.set(false);
    }
  }
}