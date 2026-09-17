export interface Product {
  id: number;
  name: string;
  price: number;
  description: string;
  emoji: string;
  category: 'mochi' | 'donut' | 'cake' | 'drink';
  isNew?: boolean;
}
