import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';
import { clearToken, getToken } from './token-storage';

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    clearToken();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    service = TestBed.inject(AuthService);
  });

  afterEach(() => {
    httpMock.verify();
    clearToken();
  });

  it('is not logged in with no stored token', () => {
    expect(service.isLoggedIn()).toBe(false);
  });

  it('login() stores the token, loads the current user, and navigates home', async () => {
    const navigateSpy = vi.spyOn(router, 'navigate');
    const loginPromise = service.login('ana@test.com', 'secret123');

    const loginReq = httpMock.expectOne(`${environment.apiUrl}/auth/login`);
    expect(loginReq.request.body).toEqual({ email: 'ana@test.com', password: 'secret123' });
    loginReq.flush({ access_token: 'abc123', token_type: 'bearer' });
    await Promise.resolve();

    const meReq = httpMock.expectOne(`${environment.apiUrl}/auth/me`);
    meReq.flush({ id: 1, email: 'ana@test.com', role: 'customer' });

    await loginPromise;

    expect(getToken()).toBe('abc123');
    expect(service.currentUser()).toEqual({ id: 1, email: 'ana@test.com', role: 'customer' });
    expect(service.isLoggedIn()).toBe(true);
    expect(navigateSpy).toHaveBeenCalledWith(['/home']);
  });

  it('register() stores the token, loads the current user, and navigates home', async () => {
    const registerPromise = service.register('ana@test.com', 'secret123');

    const registerReq = httpMock.expectOne(`${environment.apiUrl}/auth/register`);
    expect(registerReq.request.body).toEqual({ email: 'ana@test.com', password: 'secret123' });
    registerReq.flush({ access_token: 'abc123', token_type: 'bearer' });
    await Promise.resolve();

    const meReq = httpMock.expectOne(`${environment.apiUrl}/auth/me`);
    meReq.flush({ id: 1, email: 'ana@test.com', role: 'customer' });

    await registerPromise;

    expect(service.isLoggedIn()).toBe(true);
  });

  it('logout() clears the token and current user, and navigates to /auth', async () => {
    const navigateSpy = vi.spyOn(router, 'navigate');

    await service.logout();

    expect(getToken()).toBeNull();
    expect(service.currentUser()).toBeUndefined();
    expect(navigateSpy).toHaveBeenCalledWith(['/auth']);
  });
});
