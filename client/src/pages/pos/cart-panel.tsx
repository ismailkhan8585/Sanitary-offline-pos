import { useEffect, useRef } from 'react';
import { FileText, Minus, PauseCircle, Plus, ShoppingCart, UserRound, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { useCustomers, usePlumbers } from '@/hooks/use-parties';
import { PRICE_TIERS } from '@/lib/pricing';
import { formatMoney, formatQty, toPaisa, toRupees } from '@shared/money';
import type { Totals } from '@shared/billing';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/misc';
import { lineAmount, packQtyOf, type Cart, type CartAction, type CartLine } from './cart';

interface CartPanelProps {
  cart: Cart;
  totals: Totals;
  dispatch: (a: CartAction) => void;
  onEditLine: (l: CartLine) => void;
  onRemoveLine: (l: CartLine) => void;
  onPickCustomer: () => void;
  onHold: () => void;
  onQuotation: () => void;
  onPay: () => void;
  busy: boolean;
}

export function CartPanel({ cart, totals, dispatch, onEditLine, onRemoveLine, onPickCustomer, onHold, onQuotation, onPay, busy }: CartPanelProps) {
  const { t, lang, unitLabel } = useI18n();
  const customers = useCustomers();
  const plumbers = usePlumbers();
  const customer = customers.data?.find((c) => c.id === cart.customerId);
  const lastRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    lastRef.current?.scrollIntoView({ block: 'nearest' });
  }, [cart.lastKey, cart.lines]);

  const empty = cart.lines.length === 0;
  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-border bg-surface shadow-sm">
      <div className="space-y-2 border-b border-border p-3">
        <button onClick={onPickCustomer} className="flex h-12 w-full items-center gap-3 rounded-md border border-border px-3 text-start hover:bg-surface-2">
          <UserRound className="size-5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate font-semibold">{customer ? customer.name : t('pos.walkIn')}</span>
          {customer?.balance !== undefined && customer.balance !== 0 && (
            <span className="num text-sm font-semibold text-warning">
              {t('pos.balance')} {formatMoney(customer.balance)}
            </span>
          )}
        </button>
        <div className="grid grid-cols-[3fr_2fr] gap-2">
          <div className="grid grid-cols-3 gap-1 rounded-md bg-surface-2 p-1">
            {PRICE_TIERS.map((tier) => (
              <button
                key={tier}
                onClick={() => dispatch({ type: 'setTier', tier })}
                className={cn('h-9 rounded text-xs font-semibold', cart.tier === tier ? 'bg-surface text-primary shadow-sm' : 'text-muted')}
              >
                {t(`tier.${tier}`)}
              </button>
            ))}
          </div>
          <NativeSelect value={cart.plumberId ?? ''} onChange={(e) => dispatch({ type: 'setPlumber', plumberId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">{t('pos.noPlumber')}</option>
            {plumbers.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.commissionPct}%)
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {empty ? (
          <EmptyState icon={<ShoppingCart />} title={t('pos.emptyCart')} />
        ) : (
          cart.lines.map((l) => {
            const overStock = l.qty * packQtyOf(l) > l.stock;
            return (
              <div
                // A new key for the last-added line re-mounts it, replaying the 1-second highlight on every scan.
                key={l.key === cart.lastKey ? `${l.key}-${l.qty}` : l.key}
                ref={l.key === cart.lastKey ? lastRef : undefined}
                className={cn('border-b border-border px-3 py-2', l.key === cart.lastKey && 'flash')}
              >
                <div className="flex items-start gap-2">
                  <button className="min-w-0 flex-1 text-start" onClick={() => onEditLine(l)}>
                    <p className="line-clamp-2 text-[15px] font-semibold leading-snug">{lang === 'ur' && l.nameUr ? l.nameUr : l.nameEn}</p>
                  </button>
                  <button className="-me-1 -mt-1 rounded-md p-2 text-danger hover:bg-danger/10" aria-label={t('pos.remove')} onClick={() => onRemoveLine(l)}>
                    <X className="size-5" />
                  </button>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <button className="num min-w-0 flex-1 truncate text-start text-sm text-muted" onClick={() => onEditLine(l)}>
                    {formatMoney(l.rate)} / {unitLabel(l.unit)}
                    {l.discount > 0 && <span className="text-warning"> − {formatMoney(l.discount)}</span>}
                    {overStock && <span className="block font-semibold text-danger">{t('pos.overStock', { qty: formatQty(l.stock) })}</span>}
                  </button>
                  <div className="flex items-center gap-1" dir="ltr">
                    <Button variant="outline" size="icon" aria-label="−" onClick={() => dispatch({ type: 'step', key: l.key, delta: -1 })}>
                      <Minus />
                    </Button>
                    <button className="num h-11 min-w-12 rounded-md px-1 text-center text-lg font-bold hover:bg-surface-2" onClick={() => onEditLine(l)}>
                      {formatQty(l.qty)}
                    </button>
                    <Button variant="outline" size="icon" aria-label="+" onClick={() => dispatch({ type: 'step', key: l.key, delta: 1 })}>
                      <Plus />
                    </Button>
                  </div>
                  <span className="num w-24 text-end text-base font-bold">{formatMoney(lineAmount(l))}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="space-y-1 border-t border-border bg-surface-2/50 p-3">
        <Row label={t('pos.subtotal')} value={formatMoney(totals.subtotal)} />
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted">{t('pos.billDiscount')}</span>
          <Input
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            className="num h-10 w-32 text-end"
            value={cart.billDiscount ? toRupees(cart.billDiscount) : ''}
            placeholder="0"
            onChange={(e) => dispatch({ type: 'setBillDiscount', amount: toPaisa(Number(e.target.value) || 0) })}
          />
        </div>
        {totals.tax > 0 && <Row label={t('pos.tax')} value={formatMoney(totals.tax)} />}
        <div className="flex items-baseline justify-between pt-1">
          <span className="text-xl font-bold">{t('pos.total')}</span>
          <span className="num text-4xl font-bold text-primary">{formatMoney(totals.total)}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 pt-2">
          <Button variant="outline" disabled={empty || busy} onClick={onHold}>
            <PauseCircle /> {t('pos.hold')}
          </Button>
          <Button variant="outline" disabled={empty || busy} onClick={onQuotation}>
            <FileText /> {t('pos.quotation')}
          </Button>
          <Button variant="success" size="xl" className="col-span-2 text-2xl" disabled={empty || busy} onClick={onPay} shortcut="F9">
            {t('pos.pay')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{label}</span>
      <span className="num font-semibold">{value}</span>
    </div>
  );
}
