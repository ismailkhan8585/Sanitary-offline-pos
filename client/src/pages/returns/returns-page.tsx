import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Search, Undo2, UserRound } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n, useLocalName } from '@/i18n';
import { formatMoney, formatQty, toPaisa } from '@shared/money';
import { formatDateTime, cn } from '@/lib/utils';
import type { Customer } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, Card, EmptyState, Field, PageHeader } from '@/components/ui/misc';
import { Dialog } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CustomerPicker } from '@/pages/pos/customer-picker';

interface ReturnableItem {
  productId: number;
  nameEn: string;
  nameUr: string;
  unit: string;
  sold: number;
  returned: number;
  returnable: number;
  rate: number;
}

interface Returnable {
  sale: { id: number; billNo: string; createdAt: number; total: number } | null;
  customer: Customer | null;
  items: ReturnableItem[];
}

type RefundType = 'cash' | 'khata' | 'exchange';
const BIG_REFUND = 1_000_000; // Rs 10,000 asks for confirmation.

export function ReturnsPage() {
  const { t, errorText } = useI18n();
  const [mode, setMode] = useState<'bill' | 'customer'>('bill');
  const [billNo, setBillNo] = useState('');
  const [picking, setPicking] = useState(false);
  const [data, setData] = useState<Returnable | null>(null);

  const load = async (query: string) => {
    try {
      setData(await api<Returnable>(`/returns/returnable?${query}`));
    } catch (e) {
      setData(null);
      toast.error(errorText(e));
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title={t('return.title')} />
      <Card className="space-y-3 p-4">
        <Tabs value={mode} onValueChange={(v) => (setMode(v as 'bill' | 'customer'), setData(null))}>
          <TabsList>
            <TabsTrigger value="bill">{t('return.byBill')}</TabsTrigger>
            <TabsTrigger value="customer">{t('return.byCustomer')}</TabsTrigger>
          </TabsList>
        </Tabs>
        {mode === 'bill' ? (
          <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), billNo.trim() && load(`billNo=${encodeURIComponent(billNo.trim())}`))}>
            <Input autoFocus value={billNo} onChange={(e) => setBillNo(e.target.value)} placeholder={t('return.billNo')} className="num max-w-sm uppercase" />
            <Button type="submit">
              <Search /> {t('return.find')}
            </Button>
          </form>
        ) : (
          <Button variant="outline" onClick={() => setPicking(true)}>
            <UserRound /> {data?.customer?.name ?? t('pos.chooseCustomer')}
          </Button>
        )}
      </Card>
      {data ? <ReturnForm key={`${data.sale?.id}-${data.customer?.id}`} data={data} onDone={() => setData(null)} /> : <EmptyState icon={<Undo2 />} title={t('return.findFirst')} />}
      <RecentReturns />
      {picking && <CustomerPicker onClose={() => setPicking(false)} onPick={(c) => (setPicking(false), c && load(`customerId=${c.id}`))} />}
    </div>
  );
}

function ReturnForm({ data, onDone }: { data: Returnable; onDone: () => void }) {
  const { t, errorText, unitLabel } = useI18n();
  const name = useLocalName();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [qty, setQty] = useState<Record<number, string>>({});
  const [condition, setCondition] = useState<Record<number, 'good' | 'damaged'>>({});
  const [refundType, setRefundType] = useState<RefundType>(data.customer ? 'khata' : 'cash');
  const [restock, setRestock] = useState('');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);

  const lines = data.items
    .map((i) => ({ ...i, qty: Number(qty[i.productId]) || 0, condition: condition[i.productId] ?? 'good' }))
    .filter((l) => l.qty > 0);
  const value = lines.reduce((s, l) => s + Math.round(l.qty * l.rate), 0);
  const refund = value - toPaisa(Number(restock) || 0);
  const invalid = lines.some((l) => l.qty > l.returnable) || refund < 0 || lines.length === 0;

  const save = useMutation({
    mutationFn: () =>
      api<{ id: number; refund: number }>('/returns', 'POST', {
        saleId: data.sale?.id,
        customerId: data.sale ? undefined : data.customer?.id,
        items: lines.map((l) => ({ productId: l.productId, qty: l.qty, condition: l.condition })),
        refundType,
        reason,
        restockCharge: toPaisa(Number(restock) || 0),
      }),
    onSuccess: (r) => {
      toast.success(t('return.saved', { amount: formatMoney(r.refund) }));
      ['products', 'returns', 'customers', 'ledger', 'sales'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      if (refundType === 'exchange') navigate('/pos', { state: { exchange: { returnId: r.id, amount: r.refund } } });
      else onDone();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const submit = () => (refund >= BIG_REFUND ? setConfirming(true) : save.mutate());

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap gap-4 text-sm">
        {data.sale && (
          <span>
            <span className="text-muted">{t('receipt.bill')}: </span>
            <b className="num">{data.sale.billNo}</b> · {formatDateTime(data.sale.createdAt)} · <span className="num">{formatMoney(data.sale.total)}</span>
          </span>
        )}
        <span>
          <span className="text-muted">{t('pos.customer')}: </span>
          <b>{data.customer?.name ?? t('pos.walkIn')}</b>
        </span>
      </div>
      {data.items.length === 0 ? (
        <EmptyState icon={<Undo2 />} title={t('return.nothing')} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-muted">
              <tr>
                <th className="px-3 py-2 text-start">{t('common.name')}</th>
                <th className="px-3 py-2 text-end">{t('return.sold')}</th>
                <th className="px-3 py-2 text-end">{t('return.canReturn')}</th>
                <th className="px-3 py-2 text-end">{t('return.rate')}</th>
                <th className="px-3 py-2">{t('return.qty')}</th>
                <th className="px-3 py-2">{t('return.condition')}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((i) => {
                const over = (Number(qty[i.productId]) || 0) > i.returnable;
                const cond = condition[i.productId] ?? 'good';
                return (
                  <tr key={i.productId} className="border-t border-border">
                    <td className="px-3 py-2 font-semibold">{name(i)}</td>
                    <td className="num px-3 py-2 text-end">
                      {formatQty(i.sold)} {unitLabel(i.unit)}
                    </td>
                    <td className="num px-3 py-2 text-end">{formatQty(i.returnable)}</td>
                    <td className="num px-3 py-2 text-end">{formatMoney(i.rate)}</td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        disabled={i.returnable <= 0}
                        className={cn('num w-28', over && 'border-danger')}
                        value={qty[i.productId] ?? ''}
                        onChange={(e) => setQty({ ...qty, [i.productId]: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        {(['good', 'damaged'] as const).map((c) => (
                          <button
                            key={c}
                            onClick={() => setCondition({ ...condition, [i.productId]: c })}
                            className={cn(
                              'h-10 rounded-md border-2 px-3 text-sm font-semibold',
                              cond === c ? (c === 'good' ? 'border-success bg-success/10 text-success' : 'border-danger bg-danger/10 text-danger') : 'border-border',
                            )}
                          >
                            {t(`return.${c}`)}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        <Field label={t('return.refundType')}>
          <div className="grid grid-cols-3 gap-2">
            {(['cash', 'khata', 'exchange'] as const).map((r) => (
              <button
                key={r}
                disabled={r === 'khata' && !data.customer}
                onClick={() => setRefundType(r)}
                className={cn('h-12 rounded-md border-2 font-semibold disabled:opacity-40', refundType === r ? 'border-primary bg-primary/10 text-primary' : 'border-border')}
              >
                {t(`return.refund.${r}`)}
              </button>
            ))}
          </div>
          {refundType === 'exchange' && <p className="text-sm text-muted">{t('return.exchangeHint')}</p>}
        </Field>
        <Field label={t('return.restock')}>
          <Input type="number" step="any" min="0" className="num" value={restock} onChange={(e) => setRestock(e.target.value)} />
        </Field>
        <Field label={t('return.reason')}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-6">
        <span className="text-muted">
          {t('return.value')}: <b className="num">{formatMoney(value)}</b>
        </span>
        <span className="text-xl">
          {t('return.refund')}: <b className="num text-2xl text-primary">{formatMoney(Math.max(0, refund))}</b>
        </span>
        <Button size="lg" variant="accent" disabled={invalid || save.isPending} onClick={submit}>
          <Undo2 /> {t('return.save')}
        </Button>
      </div>
      {confirming && (
        <Dialog
          open
          onOpenChange={(o) => !o && setConfirming(false)}
          title={t('common.confirm')}
          footer={
            <>
              <Button variant="outline" onClick={() => setConfirming(false)}>
                {t('common.back')}
              </Button>
              <Button variant="accent" onClick={() => (setConfirming(false), save.mutate())}>
                {t('return.save')}
              </Button>
            </>
          }
        >
          <p className="text-lg font-semibold">{t('return.bigConfirm', { amount: formatMoney(refund) })}</p>
        </Dialog>
      )}
    </Card>
  );
}

interface ReturnRow {
  id: number;
  total: number;
  restockCharge: number;
  refundType: RefundType;
  reason: string;
  createdAt: number;
  billNo: string | null;
  customerName: string | null;
  userName: string | null;
}

function RecentReturns() {
  const { t } = useI18n();
  const since = new Date();
  since.setDate(since.getDate() - 7);
  since.setHours(0, 0, 0, 0);
  const list = useQuery({ queryKey: ['returns', 'recent'], queryFn: () => api<ReturnRow[]>(`/returns?from=${since.getTime()}`) });
  if (!list.data?.length) return null;
  return (
    <Card className="p-4">
      <h2 className="mb-2 text-lg font-bold">{t('return.recent')}</h2>
      <table className="w-full text-sm">
        <tbody>
          {list.data.map((r) => (
            <tr key={r.id} className="border-t border-border">
              <td className="py-2">{formatDateTime(r.createdAt)}</td>
              <td className="num">{r.billNo ?? '—'}</td>
              <td>{r.customerName ?? t('pos.walkIn')}</td>
              <td>
                <Badge tone={r.refundType === 'cash' ? 'warning' : 'primary'}>{t(`return.refund.${r.refundType}`)}</Badge>
              </td>
              <td className="num text-end font-semibold">{formatMoney(r.total - r.restockCharge)}</td>
              <td className="text-muted">{r.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
