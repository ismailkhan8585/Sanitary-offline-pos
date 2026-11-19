import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EmergencyQueue } from './queue';
import type { Catalog } from './types';

const catalog = (lastEmergencyNo = 0): Catalog => ({
  savedAt: Date.now(),
  shop: { shop_name_en: 'Shop', shop_name_ur: '', shop_address: '', shop_phone: '', receipt_footer_en: '', receipt_footer_ur: '', receipt_width: '80' },
  device: { id: 1, name: 'Counter A', billPrefix: 'A' },
  user: { id: 2, name: 'Ali' },
  lastEmergencyNo,
  products: [{ id: 1, code: 'W', barcode: null, nameEn: 'Wire', nameUr: '', aliases: '', unit: 'metre', retailPrice: 7000 }],
});

const bill = { createdAt: 1, userId: 2, userName: 'Ali', items: [], subtotal: 0, billDiscount: 0, total: 0, paid: 0, change: 0 };

describe('emergency queue', () => {
  it('numbers bills E-A-00001.., survives a restart, and tracks uploads', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'posq-')), 'q.db');
    let q = await EmergencyQueue.open(file);
    q.saveCatalog(catalog());
    expect(q.addBill(bill, 'A').billNo).toBe('E-A-00001');
    expect(q.addBill(bill, 'A').billNo).toBe('E-A-00002');
    q = await EmergencyQueue.open(file);
    expect(q.catalog()?.products[0].nameEn).toBe('Wire');
    expect(q.pending().map((b) => b.billNo)).toEqual(['E-A-00001', 'E-A-00002']);
    q.markUploaded(['E-A-00001']);
    expect((await EmergencyQueue.open(file)).pending().map((b) => b.billNo)).toEqual(['E-A-00002']);
    expect(q.addBill(bill, 'A').billNo).toBe('E-A-00003');
  });

  it('never reuses numbers the server already has', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'posq-')), 'q.db');
    const q = await EmergencyQueue.open(file);
    q.saveCatalog(catalog(41));
    expect(q.addBill(bill, 'A').billNo).toBe('E-A-00042');
    q.saveCatalog(catalog(10));
    expect(q.addBill(bill, 'A').billNo).toBe('E-A-00043');
  });
});
