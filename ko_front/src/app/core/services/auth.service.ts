import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AppUser } from '../models/user.model';
import { clearToken, getToken, setToken } from './token-storage';

interface TokenResponse {
  access_token: string;
  token_type: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  currentUser = signal<AppUser | undefined>(undefined);
  isLoggedIn = computed(() => !!this.currentUser());

  constructor() {
    if (getToken()) {
      this.loadCurrentUser().catch(() => clearToken());
    }
  }

  async login(email: string, password: string): Promise<void> {
    const response = await firstValueFrom(
      this.http.post<TokenResponse>(`${environment.apiUrl}/auth/login`, { email, password })
    );
    setToken(response.access_token);
    await this.loadCurrentUser();
    this.router.navigate(['/home']);
  }

  async register(email: string, password: string): Promise<void> {
    const response = await firstValueFrom(
      this.http.post<TokenResponse>(`${environment.apiUrl}/auth/register`, { email, password })
    );
    setToken(response.access_token);
    await this.loadCurrentUser();
    this.router.navigate(['/home']);
  }

  async logout(): Promise<void> {
    clearToken();
    this.currentUser.set(undefined);
    this.router.navigate(['/auth']);
  }

  private async loadCurrentUser(): Promise<void> {
    const user = await firstValueFrom(this.http.get<AppUser>(`${environment.apiUrl}/auth/me`));
    this.currentUser.set(user);
  }
}
