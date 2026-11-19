import { sqliteTable, integer, text, real, index } from 'drizzle-orm/sqlite-core';
// products.code and sales.bill_no are UNIQUE, which gives them their indexes.

const id = () => integer('id').primaryKey({ autoIncrement: true });
const createdAt = () => integer('created_at').notNull().$defaultFn(() => Date.now());

export const users = sqliteTable('users', {
  id: id(),
  name: text('name').notNull(),
  role: text('role', { enum: ['admin', 'cashier'] }).notNull(),
  pinHash: text('pin_hash').notNull(),
  discountLimitPct: real('discount_limit_pct').notNull().default(0),
  returnLimit: integer('return_limit').notNull().default(0),
  expenseLimit: integer('expense_limit').notNull().default(0),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
});

export const devices = sqliteTable('devices', {
  id: id(),
  name: text('name').notNull(),
  billPrefix: text('bill_prefix').notNull().unique(),
  lastSeen: integer('last_seen'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
});

export const categories = sqliteTable('categories', {
  id: id(),
  nameEn: text('name_en').notNull(),
  nameUr: text('name_ur').notNull().default(''),
});

export const products = sqliteTable(
  'products',
  {
    id: id(),
    code: text('code').notNull().unique(),
    barcode: text('barcode'),
    nameEn: text('name_en').notNull(),
    nameUr: text('name_ur').notNull().default(''),
    aliases: text('aliases').notNull().default(''),
    categoryId: integer('category_id').references(() => categories.id),
    brand: text('brand').notNull().default(''),
    size: text('size').notNull().default(''),
    color: text('color').notNull().default(''),
    unit: text('unit').notNull().default('piece'),
    packUnit: text('pack_unit'),
    packQty: real('pack_qty').notNull().default(1),
    costPrice: integer('cost_price').notNull().default(0),
    retailPrice: integer('retail_price').notNull().default(0),
    plumberPrice: integer('plumber_price').notNull().default(0),
    wholesalePrice: integer('wholesale_price').notNull().default(0),
    minStock: real('min_stock').notNull().default(0),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    updatedAt: integer('updated_at').notNull().$defaultFn(() => Date.now()),
  },
  (t) => [index('idx_products_barcode').on(t.barcode), index('idx_products_name_en').on(t.nameEn)],
);

export const productStock = sqliteTable('product_stock', {
  productId: integer('product_id')
    .primaryKey()
    .references(() => products.id),
  qty: real('qty').notNull().default(0),
});

export const stockMovementTypes = [
  'sale',
  'purchase',
  'sale_return',
  'purchase_return',
  'damage',
  'adjust',
  'challan_out',
  'challan_return',
  'opening',
] as const;

export const stockMovements = sqliteTable(
  'stock_movements',
  {
    id: id(),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id),
    qty: real('qty').notNull(),
    type: text('type', { enum: stockMovementTypes }).notNull(),
    refId: integer('ref_id'),
    userId: integer('user_id').references(() => users.id),
    deviceId: integer('device_id').references(() => devices.id),
    createdAt: createdAt(),
  },
  (t) => [index('idx_stock_movements_product').on(t.productId)],
);

export const priceTiers = ['retail', 'plumber', 'wholesale'] as const;

export const customers = sqliteTable('customers', {
  id: id(),
  name: text('name').notNull(),
  phone: text('phone').notNull().default(''),
  address: text('address').notNull().default(''),
  creditLimit: integer('credit_limit').notNull().default(0),
  priceTier: text('price_tier', { enum: priceTiers }).notNull().default('retail'),
  openingBalance: integer('opening_balance').notNull().default(0),
  createdAt: createdAt(),
});

export const suppliers = sqliteTable('suppliers', {
  id: id(),
  name: text('name').notNull(),
  company: text('company').notNull().default(''),
  phone: text('phone').notNull().default(''),
  openingBalance: integer('opening_balance').notNull().default(0),
});

export const plumbers = sqliteTable('plumbers', {
  id: id(),
  name: text('name').notNull(),
  phone: text('phone').notNull().default(''),
  commissionPct: real('commission_pct').notNull().default(0),
});

export const paymentMethods = ['cash', 'card', 'jazzcash', 'easypaisa', 'bank', 'credit'] as const;
export const saleStatuses = ['done', 'cancelled', 'quotation', 'held'] as const;

export const sales = sqliteTable(
  'sales',
  {
    id: id(),
    billNo: text('bill_no').notNull().unique(),
    deviceId: integer('device_id').references(() => devices.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    customerId: integer('customer_id').references(() => customers.id),
    plumberId: integer('plumber_id').references(() => plumbers.id),
    priceTier: text('price_tier', { enum: priceTiers }).notNull().default('retail'),
    subtotal: integer('subtotal').notNull(),
    discount: integer('discount').notNull().default(0),
    tax: integer('tax').notNull().default(0),
    total: integer('total').notNull(),
    paid: integer('paid').notNull().default(0),
    due: integer('due').notNull().default(0),
    /** Part of the total settled by a challan advance or an exchange return (not new money). */
    creditApplied: integer('credit_applied').notNull().default(0),
    exchangeReturnId: integer('exchange_return_id'),
    paymentMethod: text('payment_method', { enum: paymentMethods }).notNull().default('cash'),
    commission: integer('commission').notNull().default(0),
    status: text('status', { enum: saleStatuses }).notNull().default('done'),
    cancelReason: text('cancel_reason'),
    createdAt: createdAt(),
  },
  (t) => [index('idx_sales_created_at').on(t.createdAt), index('idx_sales_customer').on(t.customerId)],
);

export const saleItems = sqliteTable(
  'sale_items',
  {
    id: id(),
    saleId: integer('sale_id')
      .notNull()
      .references(() => sales.id),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id),
    qty: real('qty').notNull(),
    unit: text('unit').notNull(),
    packQty: real('pack_qty').notNull().default(1),
    rate: integer('rate').notNull(),
    cost: integer('cost').notNull(),
    discount: integer('discount').notNull().default(0),
    total: integer('total').notNull(),
  },
  (t) => [index('idx_sale_items_sale').on(t.saleId)],
);

export const refundTypes = ['cash', 'khata', 'exchange'] as const;

export const returns = sqliteTable('returns', {
  id: id(),
  saleId: integer('sale_id').references(() => sales.id),
  customerId: integer('customer_id').references(() => customers.id),
  total: integer('total').notNull(),
  refundType: text('refund_type', { enum: refundTypes }).notNull(),
  reason: text('reason').notNull().default(''),
  restockCharge: integer('restock_charge').notNull().default(0),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  createdAt: createdAt(),
});

export const returnItems = sqliteTable('return_items', {
  id: id(),
  returnId: integer('return_id')
    .notNull()
    .references(() => returns.id),
  productId: integer('product_id')
    .notNull()
    .references(() => products.id),
  qty: real('qty').notNull(),
  rate: integer('rate').notNull(),
  condition: text('condition', { enum: ['good', 'damaged'] }).notNull(),
});

export const challans = sqliteTable('challans', {
  id: id(),
  challanNo: text('challan_no').notNull().unique(),
  customerId: integer('customer_id')
    .notNull()
    .references(() => customers.id),
  siteName: text('site_name').notNull().default(''),
  advance: integer('advance').notNull().default(0),
  status: text('status', { enum: ['open', 'closed'] }).notNull().default('open'),
  finalSaleId: integer('final_sale_id').references(() => sales.id),
  createdAt: createdAt(),
});

export const challanItems = sqliteTable('challan_items', {
  id: id(),
  challanId: integer('challan_id')
    .notNull()
    .references(() => challans.id),
  productId: integer('product_id')
    .notNull()
    .references(() => products.id),
  qtyOut: real('qty_out').notNull().default(0),
  qtyReturned: real('qty_returned').notNull().default(0),
  rate: integer('rate').notNull(),
});

export const purchases = sqliteTable('purchases', {
  id: id(),
  supplierId: integer('supplier_id')
    .notNull()
    .references(() => suppliers.id),
  invoiceNo: text('invoice_no').notNull().default(''),
  total: integer('total').notNull(),
  paid: integer('paid').notNull().default(0),
  due: integer('due').notNull().default(0),
  paymentMethod: text('payment_method', { enum: paymentMethods }).notNull().default('cash'),
  isReturn: integer('is_return', { mode: 'boolean' }).notNull().default(false),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  createdAt: createdAt(),
});

export const purchaseItems = sqliteTable('purchase_items', {
  id: id(),
  purchaseId: integer('purchase_id')
    .notNull()
    .references(() => purchases.id),
  productId: integer('product_id')
    .notNull()
    .references(() => products.id),
  qty: real('qty').notNull(),
  freeQty: real('free_qty').notNull().default(0),
  cost: integer('cost').notNull(),
});

export const partyTypes = ['customer', 'supplier', 'plumber'] as const;

export const payments = sqliteTable(
  'payments',
  {
    id: id(),
    partyType: text('party_type', { enum: partyTypes }).notNull(),
    partyId: integer('party_id').notNull(),
    amount: integer('amount').notNull(),
    method: text('method', { enum: paymentMethods }).notNull().default('cash'),
    direction: text('direction', { enum: ['in', 'out'] }).notNull(),
    note: text('note').notNull().default(''),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('idx_payments_party').on(t.partyId)],
);

export const expenses = sqliteTable('expenses', {
  id: id(),
  category: text('category').notNull(),
  amount: integer('amount').notNull(),
  method: text('method', { enum: paymentMethods }).notNull().default('cash'),
  note: text('note').notNull().default(''),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  createdAt: createdAt(),
});

export const shifts = sqliteTable('shifts', {
  id: id(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  deviceId: integer('device_id').references(() => devices.id),
  openingCash: integer('opening_cash').notNull().default(0),
  closingCash: integer('closing_cash'),
  expectedCash: integer('expected_cash'),
  difference: integer('difference'),
  openedAt: integer('opened_at').notNull().$defaultFn(() => Date.now()),
  closedAt: integer('closed_at'),
});

export const approvals = sqliteTable('approvals', {
  id: id(),
  action: text('action').notNull(),
  requestedBy: integer('requested_by')
    .notNull()
    .references(() => users.id),
  approvedBy: integer('approved_by')
    .notNull()
    .references(() => users.id),
  details: text('details').notNull().default(''),
  createdAt: createdAt(),
});

export const activityLog = sqliteTable(
  'activity_log',
  {
    id: id(),
    userId: integer('user_id').references(() => users.id),
    deviceId: integer('device_id').references(() => devices.id),
    action: text('action').notNull(),
    details: text('details').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [index('idx_activity_created').on(t.createdAt)],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
