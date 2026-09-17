export interface AppUser {
  id: number;
  email: string;
  role: 'admin' | 'customer';
}
