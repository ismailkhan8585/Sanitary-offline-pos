import type { LucideIcon } from 'lucide-react';
import { Settings } from 'lucide-react';
import type { TranslationKey } from '@/i18n/en';
import type { Permission } from '@shared/permissions';

export interface NavItem {
  to: string;
  icon: LucideIcon;
  label: TranslationKey;
  /** Hidden from users without this permission. */
  perm?: Permission;
}

export const navItems: NavItem[] = [{ to: '/settings', icon: Settings, label: 'nav.settings', perm: 'settings' }];
