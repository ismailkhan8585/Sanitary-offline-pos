import type { Catalog, EmergencyBill } from '../types';

/** API the preload script gives this app's own pages. */
export interface PosLocal {
  testServer(address: string): Promise<boolean>;
  setServer(address: string): Promise<boolean>;
  catalog(): Promise<Catalog | null>;
  saveBill(bill: Omit<EmergencyBill, 'billNo'>): Promise<EmergencyBill>;
  pendingCount(): Promise<number>;
  serverUp(): Promise<boolean>;
  goOnline(): Promise<boolean>;
  print(html: string, width: '58' | '80' | 'a4'): Promise<void>;
}

export const posLocal = (window as unknown as { posLocal: PosLocal }).posLocal;

export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function money(paisa: number): string {
  const hasPaisa = paisa % 100 !== 0;
  return `Rs ${(paisa / 100).toLocaleString('en-US', { minimumFractionDigits: hasPaisa ? 2 : 0, maximumFractionDigits: 2 })}`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
