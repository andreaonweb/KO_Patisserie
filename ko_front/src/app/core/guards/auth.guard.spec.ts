import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { authGuard } from './auth.guard';
import { clearToken, setToken } from '../services/token-storage';

describe('authGuard', () => {
  let router: { navigate: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    clearToken();
    router = { navigate: vi.fn() };
    TestBed.configureTestingModule({
      providers: [{ provide: Router, useValue: router }],
    });
  });

  afterEach(() => {
    clearToken();
  });

  it('allows navigation when a token is stored, synchronously, with no dependency on AuthService resolving anything async', () => {
    setToken('abc123');
    const result = TestBed.runInInjectionContext(() => authGuard({} as any, {} as any));
    expect(result).toBe(true);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('redirects to /auth and returns false when no token is stored', () => {
    const result = TestBed.runInInjectionContext(() => authGuard({} as any, {} as any));
    expect(result).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith(['/auth']);
  });
});
