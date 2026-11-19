import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, type Permission, type Role } from '@shared/permissions';

export interface Me {
  userId: number;
  name: string;
  role: Role;
  deviceId: number | null;
  discountLimitPct: number;
  returnLimit: number;
  expenseLimit: number;
  device: { id: number; name: string; billPrefix: string } | null;
}

export function useMe() {
  const session = useSession();
  return useQuery({ queryKey: ['me', session?.token], queryFn: () => api<Me>('/auth/me'), enabled: Boolean(session) });
}

/** Permission check for hiding UI. The server checks again on every request. */
export function useCan() {
  const session = useSession();
  return (permission: Permission) => (session ? can(session.user.role, permission) : false);
}

export interface PublicSettings {
  shop_name_en: string;
  shop_name_ur: string;
  shop_address: string;
  shop_phone: string;
  tax_pct: string;
  receipt_footer_en: string;
  receipt_footer_ur: string;
  receipt_width: '58' | '80' | 'a4';
  default_language: 'en' | 'ur';
}

export function usePublicSettings() {
  return useQuery({ queryKey: ['settings', 'public'], queryFn: () => api<PublicSettings>('/settings/public'), staleTime: 60_000 });
}
