import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PackagePlus, Trash2, Undo2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n, useLocalName } from '@/i18n';
import { formatMoney, toPaisa, toRupees } from '@shared/money';
import { PAYMENT_METHODS, type PaymentMethod, type Product, type Supplier } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Card, EmptyState, Field, PageHeader, Switch } from '@/components/ui/misc';
import { ProductSearch } from '@/components/product-search';

interface Line {
  key: number;
  product: Product;
  unit: string;
  qty: string;
  free: string;
  cost: string;
}

let seq = 0;

export function PurchaseEditorPage() {
  const { t, errorText, unitLabel } = useI18n();
  const name = useLocalName();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const isReturn = params.get('return') === '1';
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api<Supplier[]>('/suppliers') });
  const [supplierId, setSupplierId] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [paid, setPaid] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [updateCost, setUpdateCost] = useState(true);

  const packOf = (l: Line) => (l.product.packUnit && l.unit === l.product.packUnit ? l.product.packQty : 1);
  const amount = (l: Line) => Math.round((Number(l.qty) || 0) * toPaisa(Number(l.cost) || 0));
  const total = lines.reduce((s, l) => s + amount(l), 0);
  const paidPaisa = toPaisa(Number(paid) || 0);

  const add = (p: Product) => {
    const existing = lines.find((l) => l.product.id === p.id && l.unit === p.unit);
    if (existing) return update(existing.key, { qty: String((Number(existing.qty) || 0) + 1) });
    setLines((ls) => [...ls, { key: ++seq, product: p, unit: p.unit, qty: '1', free: '', cost: String(toRupees(p.costPrice ?? 0)) }]);
  };
  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const changeUnit = (l: Line, unit: string) => {
    const perBase = toPaisa(Number(l.cost) || 0) / packOf(l);
    const next = { ...l, unit };
    update(l.key, { unit, cost: String(toRupees(Math.round(perBase * packOf(next)))) });
  };

  const save = useMutation({
    mutationFn: () =>
      api<{ supplierBalance: number }>('/purchases', 'POST', {
        supplierId: Number(supplierId),
        invoiceNo,
        isReturn,
        updateCost,
        paid: paidPaisa,
        paymentMethod: method,
        items: lines.map((l) => ({ productId: l.product.id, unit: l.unit, qty: Number(l.qty), freeQty: Number(l.free) || 0, cost: toPaisa(Number(l.cost) || 0) })),
      }),
    onSuccess: (r) => {
      toast.success(t(isReturn ? 'purchase.returnSaved' : 'purchase.saved', { balance: formatMoney(r.supplierBalance) }));
      ['products', 'purchases', 'suppliers', 'ledger'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      navigate('/purchases');
    },
    onError: (e) => toast.error(errorText(e)),
  });

  const valid = supplierId && lines.length > 0 && lines.every((l) => Number(l.qty) > 0) && paidPaisa <= total;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title={isReturn ? t('purchase.newReturn') : t('purchase.new')} />
      <Card className="grid gap-4 p-4 md:grid-cols-3">
        <Field label={t('purchase.supplier')}>
          <NativeSelect value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">{t('purchase.chooseSupplier')}</option>
            {suppliers.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} {s.company && `(${s.company})`} — {formatMoney(s.balance)}
              </option>
            ))}
          </NativeSelect>
          {suppliers.data?.length === 0 && <p className="text-sm text-warning">{t('purchase.needSupplier')}</p>}
        </Field>
        <Field label={t('purchase.invoiceNo')}>
          <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} className="num" />
        </Field>
        <ProductSearch onPick={add} className="self-end" autoFocus />
      </Card>

      <Card className="overflow-x-auto">
        {lines.length === 0 ? (
          <EmptyState icon={<PackagePlus />} title={t('purchase.emptyLines')} />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-muted">
              <tr>
                <th className="px-3 py-2 text-start">{t('common.name')}</th>
                <th className="px-3 py-2 text-start">{t('pos.unit')}</th>
                <th className="px-3 py-2 text-start">{t('purchase.qty')}</th>
                {!isReturn && <th className="px-3 py-2 text-start">{t('purchase.free')}</th>}
                <th className="px-3 py-2 text-start">{t('purchase.cost')}</th>
                <th className="px-3 py-2 text-end">{t('purchase.amount')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key} className="border-t border-border">
                  <td className="px-3 py-2 font-semibold">{name(l.product)}</td>
                  <td className="px-3 py-2">
                    {l.product.packUnit ? (
                      <NativeSelect value={l.unit} onChange={(e) => changeUnit(l, e.target.value)} className="w-32">
                        <option value={l.product.unit}>{unitLabel(l.product.unit)}</option>
                        <option value={l.product.packUnit}>{unitLabel(l.product.packUnit)}</option>
                      </NativeSelect>
                    ) : (
                      unitLabel(l.unit)
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Input type="number" step="any" min="0" className="num w-24" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} />
                  </td>
                  {!isReturn && (
                    <td className="px-3 py-2">
                      <Input type="number" step="any" min="0" className="num w-24" value={l.free} onChange={(e) => update(l.key, { free: e.target.value })} />
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <Input type="number" step="any" min="0" className="num w-32" value={l.cost} onChange={(e) => update(l.key, { cost: e.target.value })} />
                  </td>
                  <td className="num px-3 py-2 text-end font-semibold">{formatMoney(amount(l))}</td>
                  <td className="px-1">
                    <Button variant="ghost" size="icon" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={t('pos.remove')}>
                      <Trash2 className="text-danger" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="grid gap-4 p-4 md:grid-cols-[1fr_1fr_auto]">
        <div className="space-y-3">
          <Field label={isReturn ? t('purchase.refundReceived') : t('purchase.paid')}>
            <Input type="number" step="any" min="0" className="num h-12 text-lg" value={paid} onChange={(e) => setPaid(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_METHODS.filter((m) => m !== 'credit').map((m) => (
              <button key={m} onClick={() => setMethod(m)} className={cn('h-11 rounded-md border-2 px-3 font-semibold', method === m ? 'border-primary bg-primary/10 text-primary' : 'border-border')}>
                {t(`method.${m}`)}
              </button>
            ))}
          </div>
          {!isReturn && (
            <label className="flex items-center gap-3">
              <Switch checked={updateCost} onCheckedChange={setUpdateCost} />
              {t('purchase.updateCost')}
            </label>
          )}
        </div>
        <div className="space-y-1 self-end text-lg">
          <p className="flex justify-between">
            <span>{t('common.total')}</span>
            <span className="num text-2xl font-bold">{formatMoney(total)}</span>
          </p>
          <p className={cn('flex justify-between', total - paidPaisa < 0 && 'text-danger')}>
            <span className="text-muted">{t('purchase.due')}</span>
            <span className="num font-semibold">{formatMoney(total - paidPaisa)}</span>
          </p>
        </div>
        <Button size="xl" variant={isReturn ? 'accent' : 'success'} className="self-end" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
          {isReturn ? <Undo2 /> : <PackagePlus />}
          {t('common.save')}
        </Button>
      </Card>
    </div>
  );
}
