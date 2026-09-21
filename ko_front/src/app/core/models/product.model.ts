export interface Product {
  id: number;
  name: string;
  price: number;
  description: string;
  emoji: string;
  imageUrl?: string | null;
  category: 'mochi' | 'donut' | 'cake' | 'drink';
  isNew?: boolean;
}
