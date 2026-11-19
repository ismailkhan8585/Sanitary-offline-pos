import { useEffect, useState } from 'react';
import { Banknote, BookUser, Building2, CreditCard, Delete, Printer, Smartphone, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useI18n } from '@/i18n';
import { formatMoney, toPaisa } from '@shared/money';
import { PAYMENT_METHODS, type PaymentMethod } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

const ICONS: Record<PaymentMethod, LucideIcon> = {
  cash: Banknote,
  card: CreditCard,
  jazzcash: Smartphone,
  easypaisa: Wallet,
  bank: Building2,
  credit: BookUser,
};

export interface PayResult {
  method: PaymentMethod;
  /** Money applied to the bill (≤ total). */
  paid: number;
  change: number;
  print: boolean;
}

interface PayDialogProps {
  total: number;
  hasCustomer: boolean;
  busy: boolean;
  onPay: (r: PayResult) => void;
  onClose: () => void;
}

export function PayDialog({ total, hasCustomer, busy, onPay, onClose }: PayDialogProps) {
  const { t } = useI18n();
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [entry, setEntryRaw] = useState('');
  // After a quick-cash button the next digit starts a new amount instead of appending.
  const [fresh, setFresh] = useState(false);
  const setEntry = (next: string | ((v: string) => string)) => {
    setEntryRaw((v) => (typeof next === 'function' ? next(fresh ? '' : v) : next));
    setFresh(false);
  };
  const quick = (v: string) => {
    setEntryRaw(v);
    setFresh(true);
  };
  const received = entry === '' ? (method === 'credit' ? 0 : total) : toPaisa(Number(entry) || 0);
  const paid = Math.min(received, total);
  const change = method === 'cash' ? Math.max(0, received - total) : 0;
  const due = total - paid;
  const needsCustomer = due > 0 && !hasCustomer;
  const canSave = !busy && !needsCustomer;

  const submit = (print: boolean) => canSave && onPay({ method, paid, change, print });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F9' || (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement))) {
        e.preventDefault();
        submit(true);
      } else if (/^[\d.]$/.test(e.key) && !(e.target instanceof HTMLInputElement)) {
        setEntry((v) => v + e.key);
      } else if (e.key === 'Backspace' && !(e.target instanceof HTMLInputElement)) {
        setEntry((v) => v.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const key = 'h-14 rounded-lg border border-border bg-surface text-2xl font-semibold num hover:bg-surface-2 active:scale-95';
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('pay.title')} className="max-w-3xl">
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-4">
          <div className="rounded-lg bg-primary/10 p-4 text-center">
            <p className="text-sm font-semibold text-muted">{t('pos.total')}</p>
            <p className="num text-4xl font-bold text-primary">{formatMoney(total)}</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {PAYMENT_METHODS.map((m) => {
              const Icon = ICONS[m];
              return (
                <button
                  key={m}
                  onClick={() => (setMethod(m), setEntry(''))}
                  className={cn(
                    'flex h-20 flex-col items-center justify-center gap-1 rounded-lg border-2 font-semibold',
                    method === m ? (m === 'credit' ? 'border-warning bg-warning/10 text-warning' : 'border-primary bg-primary/10 text-primary') : 'border-border hover:bg-surface-2',
                  )}
                >
                  <Icon className="size-6" />
                  {t(`method.${m}`)}
                </button>
              );
            })}
          </div>
          <div className="space-y-1 rounded-lg border border-border p-3">
            <p className="text-sm text-muted">{method === 'credit' ? t('pay.paidNow') : t('pay.received')}</p>
            <p className="num text-3xl font-bold">{formatMoney(received)}</p>
          </div>
          {change > 0 && (
            <div className="rounded-lg bg-success/10 p-4 text-center text-success">
              <p className="font-semibold">{t('pay.change')}</p>
              <p className="num text-5xl font-bold">{formatMoney(change)}</p>
            </div>
          )}
          {due > 0 && (
            <div className="rounded-lg bg-warning/10 p-3 text-warning">
              <p className="flex justify-between font-semibold">
                <span>{method === 'credit' || hasCustomer ? t('pay.due') : t('pay.short')}</span>
                <span className="num text-2xl">{formatMoney(due)}</span>
              </p>
              {needsCustomer && <p className="mt-1 font-semibold text-danger">{t('pay.needCustomer')}</p>}
            </div>
          )}
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-2">
            <Button variant="outline" className="h-12" onClick={() => quick(String(total / 100))}>
              {t('pay.exact')}
            </Button>
            {[500, 1000, 5000].map((v) => (
              <Button key={v} variant="outline" className="num h-12" onClick={() => quick(String(v))}>
                {v.toLocaleString()}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2" dir="ltr">
            {['7', '8', '9', '4', '5', '6', '1', '2', '3', '00', '0', '.'].map((d) => (
              <button key={d} className={key} onClick={() => setEntry((v) => v + d)}>
                {d}
              </button>
            ))}
            <button className={cn(key, 'col-span-2 text-base text-muted')} onClick={() => setEntry('')}>
              C
            </button>
            <button className={cn(key, 'flex items-center justify-center')} onClick={() => setEntry((v) => v.slice(0, -1))} aria-label="Backspace">
              <Delete className="size-6" />
            </button>
          </div>
          <Button size="xl" variant="success" className="w-full" disabled={!canSave} onClick={() => submit(true)} shortcut="F9">
            <Printer /> {t('pay.saveFull')}
          </Button>
          <Button size="lg" variant="outline" className="w-full" disabled={!canSave} onClick={() => submit(false)}>
            {t('pay.saveOnly')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
