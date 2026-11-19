import { Trash2 } from 'lucide-react';
import { useI18n, useLocalName } from '@/i18n';
import type { Product } from '@/lib/types';
import { formatMoney, formatQty, toPaisa } from '@shared/money';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ProductSearch } from '@/components/product-search';

export interface ChallanLine {
  product: Product;
  qty: string;
  rate: string;
}

/** Editable list of goods going to a site (quantities in the base unit). */
export function ChallanLines({ lines, onChange }: { lines: ChallanLine[]; onChange: (l: ChallanLine[]) => void }) {
  const { t, unitLabel } = useI18n();
  const name = useLocalName();
  const add = (p: Product) => {
    const found = lines.find((l) => l.product.id === p.id);
    if (found) onChange(lines.map((l) => (l === found ? { ...l, qty: String((Number(l.qty) || 0) + 1) } : l)));
    else onChange([...lines, { product: p, qty: '1', rate: String(p.retailPrice / 100) }]);
  };
  const set = (i: number, patch: Partial<ChallanLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-3">
      <ProductSearch onPick={add} />
      {lines.length === 0 && <p className="text-center text-muted">{t('challan.lines')}</p>}
      {lines.map((l, i) => (
        <div key={l.product.id} className="grid grid-cols-[1fr_7rem_7rem_6rem_auto] items-center gap-2">
          <div>
            <p className="font-semibold">{name(l.product)}</p>
            <p className="num text-xs text-muted">
              {t('pos.inStock', { qty: formatQty(l.product.stock) })} {unitLabel(l.product.unit)}
            </p>
          </div>
          <Input type="number" step="any" min="0" className="num" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} aria-label={t('pos.qty')} />
          <Input type="number" step="any" min="0" className="num" value={l.rate} onChange={(e) => set(i, { rate: e.target.value })} aria-label={t('pos.rate')} />
          <span className="num text-end font-semibold">{formatMoney(Math.round((Number(l.qty) || 0) * toPaisa(Number(l.rate) || 0)))}</span>
          <Button variant="ghost" size="icon" onClick={() => onChange(lines.filter((_, j) => j !== i))} aria-label={t('pos.remove')}>
            <Trash2 className="text-danger" />
          </Button>
        </div>
      ))}
    </div>
  );
}

export function linesToItems(lines: ChallanLine[]) {
  return lines.filter((l) => Number(l.qty) > 0).map((l) => ({ productId: l.product.id, qty: Number(l.qty), rate: toPaisa(Number(l.rate) || 0) }));
}
