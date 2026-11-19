import { describe, expect, it } from 'vitest';
import { formatMoney, formatQty, toPaisa } from '@shared/money';
import { translate } from '@/i18n';

describe('money format', () => {
  it('shows rupees with commas and paisa only when needed', () => {
    expect(formatMoney(1245000)).toBe('Rs 12,450');
    expect(formatMoney(125050)).toBe('Rs 1,250.50');
    expect(formatMoney(-50000)).toBe('-Rs 500');
    expect(toPaisa(1250.5)).toBe(125050);
    expect(toPaisa(0.1 + 0.2)).toBe(30);
  });

  it('formats quantities without trailing zeros', () => {
    expect(formatQty(2.5)).toBe('2.5');
    expect(formatQty(90)).toBe('90');
    expect(formatQty(1.23456)).toBe('1.235');
  });
});

describe('translate', () => {
  it('fills params and falls back to English', () => {
    expect(translate('ur', 'login.enterPin', { name: 'Ali' })).toContain('Ali');
    expect(translate('en', 'device.done', { name: 'Counter B' })).toBe('This device is now Counter B');
  });
});
