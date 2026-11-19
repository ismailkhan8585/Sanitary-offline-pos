# Haroon Electric & Sanitary Store — Offline POS

## What we are building
A fully OFFLINE Point of Sale for an electric + sanitary shop in Pakistan.
- Runs on 3–4 devices inside the shop over the shop router (LAN/WiFi). NO internet is used.
- One SERVER PC holds all data in SQLite. Counters (PCs, tablet) connect to it over the network.
- All counters see the same stock live.
- Languages: English and Urdu (switch in UI; Urdu is right-to-left).
- Currency: PKR (Rs).

## Architecture (must follow)
- `server/` — Node.js + Fastify + better-sqlite3 + Drizzle ORM + Socket.IO. Runs as a Windows service on the server PC.
- `client/` — React + Vite + TypeScript + Tailwind. Served by the server as static files AND wrapped by Electron.
- `desktop/` — Electron app for counter PCs: loads the client from the server address, silent thermal printing.
- Tablets/mobiles open `http://<server-ip>:3000` in Chrome (installable PWA).
- ONLY the server process opens the SQLite file. Counters NEVER open the .db file directly or over a shared folder.
- Live updates: after any change to stock/bills/khata, the server emits Socket.IO events; all clients refresh that data.

## SQLite rules
- On start: `PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;`
- Every multi-table write (sale, return, purchase, challan, payment) runs in ONE transaction.
- Money is stored as INTEGER paisa (Rs 1,250.50 = 125050). Quantities as REAL (wire in metres).
- Stock = sum of `stock_movements`. Also keep `product_stock` (current qty) updated in the SAME transaction for speed.
- Nothing is deleted: bills are cancelled (status + reason). Every important action goes to `activity_log`.
- Run `PRAGMA optimize` daily.

## Backup system (DATA IS CRITICAL — must follow)
Rule 3-2-1: 3 copies, 2 devices, 1 outside the shop. Never copy the live .db file; always `VACUUM INTO` or the SQLite backup API.
1. Hourly + at every shift close: backup to `D:/POS-Backups` (second drive/partition). Retention: 24 hourly, 30 daily, 12 monthly, yearly forever.
2. Live replica: continuous replication of pos.db to a second PC/NAS on the LAN (Litestream to a file/network path). Second PC can be promoted to server.
3. External USB hard disk: automatic daily copy at closing; dashboard warning if not connected.
4. Take-home USB: weekly reminder in the app; supports 2 rotating USBs.
5. Optional cloud: copy the ENCRYPTED backup file into a Google Drive/OneDrive folder (uploads when internet is available). POS itself stays offline.
6. Exports: daily closing report PDF; monthly Excel export of khata balances, stock and supplier balances.
- Encrypt every backup that leaves the server (AES-256, password set by Admin; owner keeps password).
- After every backup run `PRAGMA integrity_check` on the copy; log result.
- Dashboard "Backup health" card: last hourly, live replica status, last USB disk copy, last take-home USB (red if older than 7 days).
- Admin-only Restore screen: list backups (newest first, with source and date), verify, restore, log to activity_log. Take a backup of the current db before restoring.
- Disaster restore must be possible on a fresh PC in under 30 minutes: install server → Restore → same fixed IP → counters reconnect → emergency bills upload.

## Database tables
users(id, name, role[admin|cashier], pin_hash, discount_limit_pct, return_limit, expense_limit, active)
devices(id, name, bill_prefix[A|B|C|D], last_seen)
categories(id, name_en, name_ur)
products(id, code, barcode, name_en, name_ur, aliases, category_id, brand, size, color, unit, pack_unit, pack_qty, cost_price, retail_price, plumber_price, wholesale_price, min_stock, active, updated_at)
product_stock(product_id, qty)
stock_movements(id, product_id, qty(+/-), type[sale|purchase|sale_return|purchase_return|damage|adjust|challan_out|challan_return|opening], ref_id, user_id, device_id, created_at)
customers(id, name, phone, address, credit_limit, price_tier[retail|plumber|wholesale], opening_balance, created_at)
suppliers(id, name, company, phone, opening_balance)
plumbers(id, name, phone, commission_pct)
sales(id, bill_no, device_id, user_id, customer_id, plumber_id, price_tier, subtotal, discount, tax, total, paid, due, payment_method[cash|card|jazzcash|easypaisa|bank|credit], commission, status[done|cancelled|quotation|held], cancel_reason, created_at)
sale_items(id, sale_id, product_id, qty, unit, pack_qty, rate, cost, discount, total)
returns(id, sale_id, customer_id, total, refund_type[cash|khata|exchange], reason, restock_charge, user_id, created_at)
return_items(id, return_id, product_id, qty, rate, condition[good|damaged])
challans(id, challan_no, customer_id, site_name, advance, status[open|closed], final_sale_id, created_at)
challan_items(id, challan_id, product_id, qty_out, qty_returned, rate)
purchases(id, supplier_id, invoice_no, total, paid, due, payment_method, is_return, user_id, created_at)
purchase_items(id, purchase_id, product_id, qty, free_qty, cost)
payments(id, party_type[customer|supplier|plumber], party_id, amount, method, direction[in|out], note, user_id, created_at)
expenses(id, category, amount, method, note, user_id, created_at)
shifts(id, user_id, device_id, opening_cash, closing_cash, expected_cash, difference, opened_at, closed_at)
approvals(id, action, requested_by, approved_by, details, created_at)
activity_log(id, user_id, device_id, action, details, created_at)
settings(key, value)

Indexes on: products.barcode, products.code, products.name_en, sales.bill_no, sales.created_at, sales.customer_id, stock_movements.product_id, payments.party_id.

## Roles
ADMIN: everything (sales, cancel bills, prices, products, purchases, suppliers, stock adjust/damage, cost & profit, all reports, users, settings, backups, activity log).
CASHIER: sales, quotations, hold bills, site challans, receive customer payments, small returns/expenses within limits, add customer, see stock qty, own shift report.
CASHIER CANNOT: see cost/profit, edit prices/products, cancel bills, purchases, stock adjust, settings, other shifts.
ADMIN PIN APPROVAL (on the same screen) when cashier: exceeds discount limit, sells below cost, sells at zero stock, exceeds customer credit limit, exceeds return/expense limit, changes a rate. Save to `approvals`.
Permissions are checked on the SERVER for every request, not only hidden in the UI.

## Features
- POS screen: search by name/code/barcode/alias (Roman Urdu too), category quick buttons, cart, units (piece/box/coil/length with auto conversion), price tier, line + bill discount, plumber + commission, payment methods incl. udhaar, hold/recall, quotation, save & print. Shortcuts: F2 search, F9 save, Esc cancel.
- Bill numbers per counter: A-00001, B-00001 (from devices.bill_prefix).
- Receipt: 80mm thermal (also 58mm and A4), shop name EN + UR, bill no, date, cashier, items, totals, udhaar balance, footer.
- Returns: against one bill; across all of a customer's bills; condition good/damaged; refund cash/khata/exchange; reduces plumber commission.
- Site challans: goods out to a site, more challans, returns, then ONE final bill for used goods minus advance.
- Products: CRUD, Excel import/export, low stock list, damage entry, stock count, price update by brand %.
- Khata: customer/supplier/plumber ledgers with running balance, payments, credit limits.
- Purchases: supplier invoice, bonus/free qty, part payment, purchase returns, updates cost price.
- Expenses, shift open/close with cash difference.
- Reports: daily/monthly sales, profit (admin), by category/brand/item, top & dead items, udhaar, payables, stock value, by cashier/counter, returns, cancels, discounts.
- Dashboard: today's sales, profit (admin), cash, low stock, dues, connected counters.
- Settings: shop info, users & limits, devices, tax %, receipt footer, language, backup/restore.
- Emergency mode (counter, Electron only): if server unreachable, save bills to a local SQLite queue with prefix E-<A>-, upload when server returns.
- Licence key tied to server PC hardware ID.

## Coding rules
- TypeScript everywhere. Validate all API input (zod).
- Small, clear files. No unused code.
- Write tests (vitest) for stock, billing, returns, khata and permission logic.
- After each change: run the tests and type-check.
- Keep UI simple: big buttons, clear colours (green in stock, orange low, red out).

## UI & design (must follow)
Goal: professional, attractive, and very easy for non-technical shop staff.

### Libraries
- Tailwind CSS + shadcn/ui components (Radix based) + lucide-react icons.
- sonner for toasts, TanStack Table for lists, Recharts for dashboard charts, react-hook-form + zod for forms.

### Colours (Tailwind theme tokens, light + dark mode)
- primary: deep teal #0F766E (water/sanitary) — main buttons, active menu.
- accent: amber #F59E0B (electric) — highlights, badges, quick buttons. Use sparingly.
- background: #F8FAFC, surface/cards: #FFFFFF, borders: #E2E8F0, text: #0F172A, muted text: #64748B.
- dark mode: background #0B1220, surface #111827, text #E5E7EB (same primary/accent).
- status: success #16A34A (in stock, paid, saved), warning #EA580C (low stock, waiting), danger #DC2626 (out of stock, cancel, errors).
- Never use colour alone for meaning: always add a label or icon.

### Typography
- English: "Inter" or "Plus Jakarta Sans". Urdu: "Noto Nastaliq Urdu" (line-height 2) — load from local files (offline!).
- Base text 16px. Product names 15–16px semibold. Bill TOTAL 32–40px bold. Use tabular numbers for all money and quantities.
- Money format: "Rs 12,450" (comma separated, no paisa unless needed).

### Layout
- Left sidebar menu with icon + label (collapsible). Top bar: shop name, counter name (A/B/C), cashier name, server status dot (green connected / red not connected), language switch, lock button.
- POS screen (most important):
  - LEFT (≈65%): big search bar at top (auto-focused, barcode ready), category chips row, product grid cards (photo or icon, name EN/UR, size, price, stock badge green/orange/red). Fast-moving items as quick buttons.
  - RIGHT (≈35%): customer + price tier + plumber at top, cart list (name, qty − / + buttons, rate, line total, remove), totals area fixed at bottom: subtotal, discount, tax, BIG TOTAL, then large buttons: Hold, Quotation, PAY (F9).
  - Pay dialog: big payment method buttons (Cash, Card, JazzCash, Easypaisa, Bank, Udhaar), quick cash buttons (exact, 500, 1000, 5000), on-screen number pad, "Change to return" shown very large in green.
- Lists (products, bills, khata): clean tables with sticky header, search, filters, status chips; add/edit in a right-side drawer, not a new page.
- Dashboard: 4–6 KPI cards (today's sales, profit for admin, cash, udhaar, low stock), 7-day sales chart, low stock list, recent bills.

### Ease of use
- Touch friendly: buttons and inputs at least 44px tall; works on tablet.
- Sale in 3 steps: scan/search → qty → Pay. Search box always focused after each action.
- Search matches name, code, barcode, aliases and Roman Urdu; shows results while typing.
- Show keyboard shortcut on buttons (F2 Search, F9 Pay, Esc Cancel). Beep on successful barcode scan.
- Highlight the last added cart item for 1 second.
- Toast feedback for every save ("Bill A-00045 saved"). Undo for removing a cart item.
- Ask for confirmation ONLY for risky actions (cancel bill, delete, big return).
- Error messages in plain words with what to do ("Stock is 0. Ask Admin to approve."), in the selected language.
- Empty states with a helpful action ("No products yet — Import from Excel").
- Loading skeletons, never a blank screen.
- Same buttons always in the same place on every screen.
- Urdu mode: full RTL layout (dir="rtl"), mirrored icons where needed.
- Cashier sees a simpler menu than Admin (only allowed items).

## Build phases (do ONE at a time)
1. [x] Project setup, SQLite + schema + migrations, Fastify server, PIN login, roles
2. [x] Products, categories, stock, Excel import
3. [x] POS sale screen, billing transaction, receipt printing
4. [ ] Customers, suppliers, plumbers, khata, payments
5. [ ] Purchases and purchase returns
6. [ ] Customer returns and site challans
7. [ ] Expenses, shifts, Admin PIN approvals, activity log
8. [ ] Reports and dashboard
9. [ ] Socket.IO live updates across devices
10. [ ] Electron counter app, silent printing, emergency mode
11. [ ] Backups/restore, Windows service, installers, licence
12. [ ] Urdu UI, final testing
