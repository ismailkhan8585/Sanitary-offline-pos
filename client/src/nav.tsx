import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { BookUser, ClipboardCheck, Package, ReceiptText, Settings, ShoppingCart, Truck } from 'lucide-react';
import { PurchasesPage } from '@/pages/purchases/purchases-page';
import { PurchaseEditorPage } from '@/pages/purchases/purchase-editor-page';
import { KhataPage } from '@/pages/khata/khata-page';
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
  { to: '/khata', icon: BookUser, label: 'nav.khata', perm: 'payment.receive', element: <KhataPage /> },
  { to: '/products', icon: Package, label: 'nav.products', perm: 'stock.view', element: <ProductsPage /> },
  { to: '/purchases', icon: Truck, label: 'nav.purchases', perm: 'purchase', element: <PurchasesPage /> },
  { to: '/stock-count', icon: ClipboardCheck, label: 'nav.stockCount', perm: 'stock.adjust', element: <StockCountPage /> },
  { to: '/settings', icon: Settings, label: 'nav.settings', perm: 'settings', element: <SettingsPage /> },
];

/** Pages opened from other pages (not in the menu). */
export const extraRoutes: { path: string; perm: Permission; element: ReactNode }[] = [
  { path: '/purchases/new', perm: 'purchase', element: <PurchaseEditorPage /> },
];
