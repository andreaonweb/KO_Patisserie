import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { authInterceptor } from './auth.interceptor';
import { environment } from '../../../environments/environment';
import { clearToken, setToken } from '../services/token-storage';

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    clearToken();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    httpMock.verify();
    clearToken();
  });

  it('attaches the Authorization header to API requests when a token is stored', () => {
    setToken('abc123');
    http.get(`${environment.apiUrl}/products`).subscribe();
    const req = httpMock.expectOne(`${environment.apiUrl}/products`);
    expect(req.request.headers.get('Authorization')).toBe('Bearer abc123');
  });

  it('does not attach an Authorization header when no token is stored', () => {
    http.get(`${environment.apiUrl}/products`).subscribe();
    const req = httpMock.expectOne(`${environment.apiUrl}/products`);
    expect(req.request.headers.has('Authorization')).toBe(false);
  });

  it('does not attach an Authorization header to requests outside the API base URL', () => {
    setToken('abc123');
    http.get('https://api.tmb.cat/v1/itransit/bus/parades/123').subscribe();
    const req = httpMock.expectOne('https://api.tmb.cat/v1/itransit/bus/parades/123');
    expect(req.request.headers.has('Authorization')).toBe(false);
  });

  it('clears the stored token and navigates to /auth on a 401 response', () => {
    setToken('abc123');
    const navigateSpy = vi.spyOn(router, 'navigate');
    http.get(`${environment.apiUrl}/orders`).subscribe({ error: () => {} });
    const req = httpMock.expectOne(`${environment.apiUrl}/orders`);
    req.flush({ detail: 'Token inválido' }, { status: 401, statusText: 'Unauthorized' });
    expect(navigateSpy).toHaveBeenCalledWith(['/auth']);
    expect(getTokenForTest()).toBeNull();
  });

  function getTokenForTest(): string | null {
    return localStorage.getItem('shirayuki_token');
  }
});
