/**
 * Fills a running POS with a small demo shop (categories, products, customers, suppliers,
 * plumbers, a cashier, counters and some bills) through the normal API.
 *   npm run demo-data                         (server on this PC, Admin PIN 1234)
 *   npm run demo-data -- http://192.168.1.10:3000 5678
 * Only for trying the app — do not run it on the shop's real data.
 */
const [base = 'http://127.0.0.1:3000', adminPin = '1234'] = process.argv.slice(2);

let token = '';
async function api<T = any>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json()) as T & { message?: string };
  if (!res.ok) throw new Error(`${method} ${path}: ${data.message ?? res.statusText}`);
  return data as T;
}
const rs = (rupees: number) => Math.round(rupees * 100);

async function main() {
  const users = await api<{ id: number; name: string; role: string }[]>('/auth/users');
  const admin = users.find((u) => u.role === 'admin')!;
  token = (await api<{ token: string }>('/auth/login', { userId: admin.id, pin: adminPin, deviceId: 1 })).token;
  if ((await api<unknown[]>('/products')).length > 0) {
    console.log('Products already exist — demo data not added (it is meant for an empty POS).');
    return;
  }

  console.log('Counters and cashier…');
  const devices = await api<{ billPrefix: string }[]>('/devices');
  for (const [name, billPrefix] of [['Counter B', 'B'], ['Tablet', 'D']]) {
    if (!devices.some((d) => d.billPrefix === billPrefix)) await api('/devices', { name, billPrefix, active: true });
  }
  if (!users.some((u) => u.name === 'Ali')) {
    await api('/users', { name: 'Ali', role: 'cashier', pin: '1111', discountLimitPct: 5, returnLimit: rs(2000), expenseLimit: rs(1000), active: true });
  }

  console.log('Categories…');
  const cat: Record<string, number> = {};
  for (const [en, ur] of [
    ['Wires', 'تار'],
    ['Switches & Sockets', 'سوئچ اور ساکٹ'],
    ['Lights', 'لائٹس'],
    ['Fans', 'پنکھے'],
    ['Pipes', 'پائپ'],
    ['Pipe Fittings', 'پائپ فٹنگ'],
    ['Taps & Mixers', 'ٹونٹیاں'],
    ['Sanitary', 'سینیٹری'],
  ]) {
    cat[en] = (await api<{ id: number }>('/categories', { nameEn: en, nameUr: ur })).id;
  }

  console.log('Products…');
  type P = [code: string, en: string, ur: string, aliases: string, category: string, brand: string, size: string, unit: string, pack: [string, number] | null, cost: number, retail: number, stock: number, min: number, barcode?: string];
  const list: P[] = [
    ['W-15', 'Wire 1.5mm', 'تار 1.5 ملی میٹر', 'taar wire', 'Wires', 'Pakistan Cables', '1.5mm', 'metre', ['coil', 90], 55, 70, 900, 180],
    ['W-25', 'Wire 2.5mm', 'تار 2.5 ملی میٹر', 'taar wire', 'Wires', 'Pakistan Cables', '2.5mm', 'metre', ['coil', 90], 88, 110, 60, 90],
    ['W-40', 'Wire 4mm', 'تار 4 ملی میٹر', 'taar', 'Wires', 'Fast Cables', '4mm', 'metre', ['coil', 90], 140, 175, 270, 90],
    ['S-1G', 'Switch 1 Gang', 'سوئچ ایک', 'button batan', 'Switches & Sockets', 'Clipsal', '', 'piece', ['box', 10], 95, 130, 200, 30, '8964000100011'],
    ['S-2G', 'Switch 2 Gang', 'سوئچ دو', 'button', 'Switches & Sockets', 'Clipsal', '', 'piece', ['box', 10], 160, 210, 8, 20, '8964000100012'],
    ['S-SKT', 'Socket 3 Pin', 'ساکٹ', 'saket plug', 'Switches & Sockets', 'Clipsal', '15A', 'piece', ['box', 10], 180, 240, 75, 20],
    ['L-12W', 'LED Bulb 12W', 'ایل ای ڈی بلب', 'bulb balb', 'Lights', 'Philips', '12W', 'piece', ['box', 10], 260, 350, 120, 30, '8964000100021'],
    ['L-TUBE', 'LED Tube Light 20W', 'ٹیوب لائٹ', 'tube', 'Lights', 'Osaka', '4 ft', 'piece', null, 520, 700, 0, 10],
    ['F-56', 'Ceiling Fan 56"', 'چھت کا پنکھا', 'pankha', 'Fans', 'GFC', '56"', 'piece', null, 8200, 9800, 6, 5],
    ['F-BR', 'Bracket Fan 18"', 'بریکٹ پنکھا', 'pankha', 'Fans', 'Royal', '18"', 'piece', null, 4800, 5900, 9, 3],
    ['P-12', 'PVC Pipe 1/2"', 'پی وی سی پائپ آدھا انچ', 'paip', 'Pipes', 'Beta', '1/2"', 'foot', ['length', 13], 30, 40, 650, 130],
    ['P-34', 'PVC Pipe 3/4"', 'پی وی سی پائپ پون انچ', 'paip', 'Pipes', 'Beta', '3/4"', 'foot', ['length', 13], 45, 60, 390, 130],
    ['PF-EL12', 'Elbow 1/2"', 'ایلبو آدھا انچ', 'albo kohni', 'Pipe Fittings', 'Beta', '1/2"', 'piece', ['packet', 25], 12, 20, 400, 100],
    ['PF-T12', 'Tee 1/2"', 'ٹی آدھا انچ', 'tee', 'Pipe Fittings', 'Beta', '1/2"', 'piece', ['packet', 25], 15, 25, 30, 50],
    ['T-BIB', 'Bib Tap Steel', 'ٹونٹی سٹیل', 'tonti nalka', 'Taps & Mixers', 'Sonex', '', 'piece', null, 680, 850, 24, 6, '8964000100031'],
    ['T-MIX', 'Mixer Tap Chrome', 'مکسر ٹونٹی', 'tonti mixer', 'Taps & Mixers', 'Faisal', '', 'piece', null, 3600, 4500, 4, 3],
    ['SN-WC', 'Commode Set', 'کموڈ سیٹ', 'commode kamod', 'Sanitary', 'Porta', '', 'set', null, 14500, 17500, 3, 2],
    ['SN-SHW', 'Shower Set', 'شاور سیٹ', 'shawar', 'Sanitary', 'Sonex', '', 'set', null, 2100, 2800, 12, 4],
  ];
  const id: Record<string, number> = {};
  for (const [code, nameEn, nameUr, aliases, category, brand, size, unit, pack, cost, retail, stock, min, barcode] of list) {
    const p = await api<{ id: number }>('/products', {
      code,
      barcode: barcode ?? null,
      nameEn,
      nameUr,
      aliases,
      categoryId: cat[category],
      brand,
      size,
      unit,
      packUnit: pack?.[0] ?? null,
      packQty: pack?.[1] ?? 1,
      costPrice: rs(cost),
      retailPrice: rs(retail),
      plumberPrice: rs(retail * 0.93),
      wholesalePrice: rs(retail * 0.88),
      minStock: min,
      openingStock: stock,
    });
    id[code] = p.id;
  }

  console.log('Customers, suppliers, plumbers…');
  const rashid = await api<{ id: number }>('/customers', { name: 'Rashid Contractor', phone: '0300-1234567', address: 'DHA Phase 5', priceTier: 'wholesale', creditLimit: rs(100000), openingBalance: rs(15000) });
  const kamran = await api<{ id: number }>('/customers', { name: 'Kamran Builders', phone: '0321-7654321', address: 'Bahria Town', priceTier: 'wholesale', creditLimit: rs(250000), openingBalance: 0 });
  await api('/customers', { name: 'Imran Bhai', phone: '0333-1112223', priceTier: 'retail', creditLimit: rs(10000) });
  const supplier = await api<{ id: number }>('/suppliers', { name: 'Pakistan Cables Distributor', company: 'Pakistan Cables', phone: '042-35000000', openingBalance: rs(45000) });
  await api('/suppliers', { name: 'Beta Pipes Agency', company: 'Beta Pipes', phone: '042-36000000', openingBalance: 0 });
  const akram = await api<{ id: number }>('/plumbers', { name: 'Ustad Akram', phone: '0311-2223334', commissionPct: 5 });
  await api('/plumbers', { name: 'Shahid Electrician', phone: '0345-5556667', commissionPct: 3 });

  console.log('Bills, purchase, payments, expense, challan…');
  const line = (code: string, qty: number, unit: string, rate: number) => ({ productId: id[code], qty, unit, rate: rs(Math.round(rate)) });
  await api('/sales', { items: [line('L-12W', 4, 'piece', 350), line('S-1G', 2, 'piece', 130)], paymentMethod: 'cash', paid: rs(1660) });
  await api('/sales', { items: [line('T-BIB', 1, 'piece', 850), line('PF-EL12', 6, 'piece', 20)], paymentMethod: 'jazzcash', paid: rs(970) });
  await api('/sales', {
    customerId: rashid.id,
    priceTier: 'wholesale',
    items: [line('W-15', 1, 'coil', 70 * 0.88 * 90), line('S-SKT', 1, 'box', 240 * 0.88 * 10)],
    paymentMethod: 'cash',
    paid: rs(3000),
  });
  await api('/sales', { plumberId: akram.id, priceTier: 'plumber', items: [line('P-12', 2, 'length', 40 * 0.93 * 13), line('PF-T12', 4, 'piece', 25 * 0.93)], paymentMethod: 'cash', paid: rs(99999) });
  await api('/sales', { customerId: kamran.id, priceTier: 'wholesale', items: [line('F-56', 2, 'piece', 9800 * 0.88)], paymentMethod: 'credit', paid: 0 });
  await api('/sales', { status: 'held', items: [line('SN-SHW', 1, 'set', 2800)] });
  await api('/sales', { status: 'quotation', customerId: kamran.id, items: [line('SN-WC', 2, 'set', 17500), line('T-MIX', 2, 'piece', 4500)] });

  await api('/purchases', { supplierId: supplier.id, invoiceNo: 'PC-1043', items: [{ productId: id['W-25'], unit: 'coil', qty: 4, freeQty: 0, cost: rs(88 * 90) }], paid: rs(20000), paymentMethod: 'bank' });
  await api('/payments', { partyType: 'customer', partyId: rashid.id, amount: rs(5000), method: 'cash', direction: 'in', note: 'Part payment' });
  await api('/expenses', { category: 'Tea / food', amount: rs(350), method: 'cash', note: 'Chai for staff' });
  await api('/challans', { customerId: kamran.id, siteName: 'Bahria Town House 21', advance: rs(10000), items: [{ productId: id['W-25'], qty: 90, rate: rs(110) }, { productId: id['S-1G'], qty: 10, rate: rs(130) }] });

  console.log('\nDemo data added. Logins: Admin / your PIN, Ali / 1111 (cashier).');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
