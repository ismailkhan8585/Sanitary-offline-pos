import { useState } from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { formatMoney, formatQty, toPaisa, toRupees } from '@shared/money';
import { lineTotal } from '@shared/billing';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/misc';
import { Dialog } from '@/components/ui/dialog';
import { packQtyOf, type CartLine } from './cart';

interface LineEditorProps {
  line: CartLine;
  onSave: (v: { unit: string; qty: number; rate: number; discount: number }) => void;
  onRemove: () => void;
  onClose: () => void;
}

export function LineEditor({ line, onSave, onRemove, onClose }: LineEditorProps) {
  const { t, unitLabel } = useI18n();
  const [unit, setUnit] = useState(line.unit);
  const [qty, setQty] = useState(String(line.qty));
  const [rate, setRate] = useState(String(toRupees(line.rate)));
  const [discount, setDiscount] = useState(String(toRupees(line.discount)));

  const changeUnit = (u: string) => {
    if (u === unit) return;
    setUnit(u);
    // Show the list price of the new unit until the cashier types a rate.
    const perBase = line.rate / packQtyOf(line);
    setRate(String(toRupees(Math.round(perBase * packQtyOf({ ...line, unit: u })))));
  };
  const values = { unit, qty: Number(qty) || 0, rate: toPaisa(Number(rate) || 0), discount: toPaisa(Number(discount) || 0) };
  const baseQty = values.qty * packQtyOf({ ...line, unit });
  const valid = values.qty > 0 && values.discount <= Math.round(values.qty * values.rate);
  const save = () => valid && onSave(values);

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('pos.editLine')}
      footer={
        <>
          <Button variant="destructive" onClick={onRemove} className="me-auto">
            <Trash2 /> {t('pos.remove')}
          </Button>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={save} disabled={!valid}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), save())}>
        <p className="text-lg font-semibold">{line.nameEn}</p>
        {line.packUnit && (
          <Field label={t('pos.unit')}>
            <div className="grid grid-cols-2 gap-2">
              {[line.baseUnit, line.packUnit].map((u) => (
                <button
                  type="button"
                  key={u}
                  onClick={() => changeUnit(u)}
                  className={cn('h-12 rounded-md border-2 font-semibold', unit === u ? 'border-primary bg-primary/10 text-primary' : 'border-border')}
                >
                  {unitLabel(u)}
                  {u === line.packUnit && <span className="num block text-xs font-normal text-muted">= {formatQty(line.productPackQty)} {unitLabel(line.baseUnit)}</span>}
                </button>
              ))}
            </div>
          </Field>
        )}
        <Field label={t('pos.qty')}>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="icon" className="h-12 w-12" onClick={() => setQty(String(Math.max(1, (Number(qty) || 0) - 1)))}>
              <Minus />
            </Button>
            <Input autoFocus type="number" step="any" min="0" inputMode="decimal" className="num h-12 text-center text-xl" value={qty} onChange={(e) => setQty(e.target.value)} onFocus={(e) => e.target.select()} />
            <Button type="button" variant="outline" size="icon" className="h-12 w-12" onClick={() => setQty(String((Number(qty) || 0) + 1))}>
              <Plus />
            </Button>
          </div>
          {unit !== line.baseUnit && <p className="num text-sm text-muted">= {formatQty(baseQty)} {unitLabel(line.baseUnit)}</p>}
          <p className={cn('text-sm', baseQty > line.stock ? 'font-semibold text-danger' : 'text-muted')}>
            {baseQty > line.stock ? t('pos.overStock', { qty: formatQty(line.stock) }) : t('pos.inStock', { qty: formatQty(line.stock) })}
          </p>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`${t('pos.rate')} / ${unitLabel(unit)}`}>
            <Input type="number" step="any" inputMode="decimal" className="num h-12 text-lg" value={rate} onChange={(e) => setRate(e.target.value)} onFocus={(e) => e.target.select()} />
          </Field>
          <Field label={t('pos.lineDiscount')}>
            <Input type="number" step="any" inputMode="decimal" className="num h-12 text-lg" value={discount} onChange={(e) => setDiscount(e.target.value)} onFocus={(e) => e.target.select()} />
          </Field>
        </div>
        <p className="num text-end text-2xl font-bold">{formatMoney(lineTotal(values))}</p>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
