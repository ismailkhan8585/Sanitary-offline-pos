import type { Catalog, EmergencyBill } from '../types';
import { $, escapeHtml, money, posLocal } from './bridge.js';

type Product = Catalog['products'][number];
interface Line {
  product: Product;
  qty: number;
  rate: number;
}

let catalog: Catalog | null = null;
let lines: Line[] = [];
const search = $<HTMLInputElement>('search');
const results = $<HTMLUListElement>('results');
const cartBody = $<HTMLTableElement>('cart').tBodies[0];
const error = $<HTMLParagraphElement>('error');

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const toPaisa = (v: string) => Math.round((Number(v) || 0) * 100);

function totals() {
  const subtotal = lines.reduce((s, l) => s + Math.round(l.qty * l.rate), 0);
  const discount = Math.min(subtotal, toPaisa($<HTMLInputElement>('discount').value));
  const total = subtotal - discount;
  const cashRaw = $<HTMLInputElement>('cash').value;
  const paid = cashRaw === '' ? total : toPaisa(cashRaw);
  return { subtotal, discount, total, paid, change: Math.max(0, paid - total) };
}

function renderTotals() {
  const t = totals();
  $('total').textContent = money(t.total);
  $('change').textContent = money(t.change);
  $<HTMLButtonElement>('save').disabled = lines.length === 0 || t.paid < t.total;
}

function renderCart() {
  cartBody.innerHTML = '';
  lines.forEach((l, i) => {
    const tr = cartBody.insertRow();
    tr.innerHTML = `<td>${escapeHtml(l.product.nameEn)}<br><small class="ur">${escapeHtml(l.product.nameUr)}</small></td>
      <td><input type="number" min="0" step="any" class="num" value="${l.qty}" data-k="qty"></td>
      <td><input type="number" min="0" step="any" class="num" value="${l.rate / 100}" data-k="rate"></td>
      <td class="num">${money(Math.round(l.qty * l.rate))}</td><td><button data-k="del">✕</button></td>`;
    tr.querySelectorAll('input').forEach((input) =>
      input.addEventListener('input', () => {
        if (input.dataset.k === 'qty') l.qty = Number(input.value) || 0;
        else l.rate = toPaisa(input.value);
        tr.cells[3].textContent = money(Math.round(l.qty * l.rate));
        renderTotals();
      }),
    );
    tr.querySelector('button')!.addEventListener('click', () => {
      lines.splice(i, 1);
      renderCart();
    });
  });
  renderTotals();
}

function add(p: Product) {
  const found = lines.find((l) => l.product.id === p.id);
  if (found) found.qty += 1;
  else lines.push({ product: p, qty: 1, rate: p.retailPrice });
  search.value = '';
  results.innerHTML = '';
  renderCart();
  search.focus();
}

function find(q: string): Product[] {
  const n = norm(q);
  if (!catalog || !n) return [];
  const exact = catalog.products.find((p) => p.barcode === q.trim() || p.code.toLowerCase() === q.trim().toLowerCase());
  if (exact) return [exact];
  return catalog.products.filter((p) => norm(`${p.code}${p.nameEn}${p.nameUr}${p.aliases}`).includes(n)).slice(0, 40);
}

search.addEventListener('input', () => {
  results.innerHTML = '';
  for (const p of find(search.value)) {
    const li = document.createElement('li');
    li.innerHTML = `<span><b>${escapeHtml(p.nameEn)}</b> <span class="ur">${escapeHtml(p.nameUr)}</span> <small class="muted num">${escapeHtml(p.code)}</small></span><span class="num">${money(p.retailPrice)}</span>`;
    li.addEventListener('click', () => add(p));
    results.appendChild(li);
  }
});
search.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const first = find(search.value)[0];
  if (first) add(first);
});
['discount', 'cash'].forEach((id) => $(id).addEventListener('input', renderTotals));

function receiptHtml(bill: EmergencyBill): string {
  const shop = catalog!.shop;
  const rows = bill.items.map((i) => `<tr><td>${escapeHtml(i.name)}</td><td>${i.qty}</td><td>${money(i.rate)}</td><td>${money(i.total)}</td></tr>`).join('');
  const w = shop.receipt_width === '58' ? '58mm' : shop.receipt_width === 'a4' ? '190mm' : '80mm';
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{margin:0}body{margin:0;font:12px Arial,sans-serif;color:#000}
    .r{width:${w};padding:2mm 3mm;box-sizing:border-box}.c{text-align:center}table{width:100%;border-collapse:collapse}td{padding:2px 0;text-align:end}td:first-child{text-align:start}
    .row{display:flex;justify-content:space-between}.t{font-size:18px;font-weight:700}hr{border:0;border-top:1px dashed #000}</style></head><body><div class="r">
    <div class="c"><b style="font-size:16px">${escapeHtml(shop.shop_name_en)}</b><div>${escapeHtml(shop.shop_name_ur)}</div><div>${escapeHtml(shop.shop_phone)}</div></div><hr>
    <div class="row"><span>Bill</span><b>${bill.billNo}</b></div><div class="row"><span>Date</span><span>${new Date(bill.createdAt).toLocaleString('en-PK')}</span></div>
    <div class="row"><span>Cashier</span><span>${escapeHtml(bill.userName)}</span></div><hr><table>${rows}</table><hr>
    ${bill.billDiscount ? `<div class="row"><span>Discount</span><span>- ${money(bill.billDiscount)}</span></div>` : ''}
    <div class="row t"><span>TOTAL</span><span>${money(bill.total)}</span></div><div class="row"><span>Cash</span><span>${money(bill.paid)}</span></div>
    <div class="row"><span>Change</span><span>${money(bill.change)}</span></div><hr><div class="c">${escapeHtml(shop.receipt_footer_en)}</div></div></body></html>`;
}

async function save() {
  if (!catalog || !lines.length) return;
  const t = totals();
  if (t.paid < t.total) return;
  error.hidden = true;
  try {
    const bill = await posLocal.saveBill({
      createdAt: Date.now(),
      userId: catalog.user.id,
      userName: catalog.user.name,
      items: lines.map((l) => ({ productId: l.product.id, code: l.product.code, name: l.product.nameEn, qty: l.qty, unit: l.product.unit, rate: l.rate, total: Math.round(l.qty * l.rate) })),
      subtotal: t.subtotal,
      billDiscount: t.discount,
      total: t.total,
      paid: t.total,
      change: t.change,
    });
    lines = [];
    $<HTMLInputElement>('cash').value = '';
    $<HTMLInputElement>('discount').value = '0';
    renderCart();
    refreshPending();
    await posLocal.print(receiptHtml(bill), catalog.shop.receipt_width);
  } catch (err) {
    error.textContent = err instanceof Error ? err.message : String(err);
    error.hidden = false;
  }
}

$('save').addEventListener('click', save);
window.addEventListener('keydown', (e) => {
  if (e.key === 'F9') (e.preventDefault(), save());
  if (e.key === 'F2') (e.preventDefault(), search.focus());
});

async function refreshPending() {
  $('pending').textContent = String(await posLocal.pendingCount());
}

async function watchServer() {
  const up = await posLocal.serverUp();
  const btn = $<HTMLButtonElement>('online');
  btn.disabled = !up;
  $('banner').classList.toggle('ok', up);
}
$('online').addEventListener('click', () => posLocal.goOnline());

async function start() {
  catalog = await posLocal.catalog();
  if (!catalog) {
    error.textContent = 'This counter has no saved product list yet. Connect to the server once first.';
    error.hidden = false;
    search.disabled = true;
  } else {
    $('who').textContent = `${catalog.device.name} (${catalog.device.billPrefix}) · ${catalog.user.name} · products saved ${new Date(catalog.savedAt).toLocaleString('en-PK')}`;
  }
  await refreshPending();
  await watchServer();
  setInterval(watchServer, 5000);
}
void start();
