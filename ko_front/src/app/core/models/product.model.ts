export interface Product {
  id: string;
  name: string;
  price: number;
  description: string;
  emoji: string;
  category: 'mochi' | 'donut' | 'cake' | 'drink';
  isNew?: boolean;
}