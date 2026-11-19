export type Role = 'admin' | 'cashier';

/** Everything a cashier may do. Admin may do everything. */
export const cashierPermissions = [
  'sale',
  'challan',
  'payment.receive',
  'return',
  'expense',
  'customer.write',
  'stock.view',
  'shift.own',
] as const;

export const adminOnlyPermissions = [
  'sale.cancel',
  'product.write',
  'purchase',
  'party.manage',
  'stock.adjust',
  'cost.view',
  'report.all',
  'user.manage',
  'settings',
  'backup',
  'activity.view',
  'shift.all',
  'payment.out',
] as const;

export type Permission = (typeof cashierPermissions)[number] | (typeof adminOnlyPermissions)[number];

export function can(role: Role, permission: Permission): boolean {
  return role === 'admin' || (cashierPermissions as readonly string[]).includes(permission);
}
