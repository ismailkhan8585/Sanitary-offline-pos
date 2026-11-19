import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Left-to-right isolate: keeps "19-Nov-2026, 5:37 pm" in order inside Urdu (RTL) text. */
const ltr = (s: string) => `⁦${s}⁩`;

export function formatDateTime(ms: number): string {
  return ltr(new Date(ms).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' }));
}

export function formatDate(ms: number): string {
  return ltr(new Date(ms).toLocaleDateString('en-PK', { dateStyle: 'medium' }));
}

/** yyyy-mm-dd in local time, for <input type="date"> and report filters. */
export function isoDay(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Escapes text placed into hand-built print HTML. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
