import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ClipboardCheck, Package, ReceiptText, Settings, ShoppingCart } from 'lucide-react';
import { PosPage } from '@/pages/pos/pos-page';
import { BillsPage } from '@/pages/bills/bills-page';
import type { TranslationKey } from '@/i18n/en';
import type { Permission } from '@shared/permissions';
import { ProductsPage } from '@/pages/products/products-page';
import { StockCountPage } from '@/pages/products/stock-count-page';
import { SettingsPage } from '@/pages/settings/settings-page';

export interface NavItem {
  to: string;
  icon: LucideIcon;
  label: TranslationKey;
  /** Hidden (and blocked) for users without this permission. */
  perm?: Permission;
  element: ReactNode;
}

/** Menu order = importance for daily work. Cashiers only see items they may use. */
export const navItems: NavItem[] = [
  { to: '/pos', icon: ShoppingCart, label: 'nav.pos', perm: 'sale', element: <PosPage /> },
  { to: '/bills', icon: ReceiptText, label: 'nav.bills', perm: 'sale', element: <BillsPage /> },
  { to: '/products', icon: Package, label: 'nav.products', perm: 'stock.view', element: <ProductsPage /> },
  { to: '/stock-count', icon: ClipboardCheck, label: 'nav.stockCount', perm: 'stock.adjust', element: <StockCountPage /> },
  { to: '/settings', icon: Settings, label: 'nav.settings', perm: 'settings', element: <SettingsPage /> },
];
