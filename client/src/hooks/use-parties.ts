import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Customer, Plumber } from '@/lib/types';

export function useCustomers() {
  return useQuery({ queryKey: ['customers'], queryFn: () => api<Customer[]>('/customers'), staleTime: 30_000 });
}

export function usePlumbers() {
  return useQuery({ queryKey: ['plumbers'], queryFn: () => api<Plumber[]>('/plumbers'), staleTime: 60_000 });
}
