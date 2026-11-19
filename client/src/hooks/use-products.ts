import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Category, Product } from '@/lib/types';
import { searchText } from '@shared/search';

export function useProducts() {
  return useQuery({ queryKey: ['products'], queryFn: () => api<Product[]>('/products'), staleTime: 60_000 });
}

/** Pre-normalised search text per product, so typing stays instant on big catalogues. */
export function useSearchIndex(products: Product[] | undefined) {
  return useMemo(() => new Map((products ?? []).map((p) => [p, searchText(p)])), [products]);
}

export function useCategories() {
  return useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/categories'), staleTime: 60_000 });
}
