import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { Ban, FileText, Printer, ReceiptText, ShoppingCart } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/i18n';
import { useCan } from '@/hooks/use-auth';
import { usePrintSale } from '@/hooks/use-print-sale';
import type { PaymentMethod, SaleDetail, SaleStatus } from '@/lib/types';
import { formatMoney, formatQty } from '@shared/money';
import { formatDateTime, isoDay } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Badge, EmptyState, Field, PageHeader, Skeleton } from '@/components/ui/misc';
import { Dialog, Sheet } from '@/components/ui/dialog';
import { DataTable } from '@/components/ui/data-table';

interface BillRow {
  id: number;
  billNo: string;
  createdAt: number;
  total: number;
  paid: number;
  due: number;
  status: SaleStatus;
  paymentMethod: PaymentMethod;
  customerName: string | null;
  userName: string | null;
  deviceName: string | null;
}

const STATUS_TONE = { done: 'success', cancelled: 'danger', quotation: 'primary', held: 'warning' } as const;

export function StatusBadge({ status }: { status: SaleStatus }) {
  const { t } = useI18n();
  return <Badge tone={STATUS_TONE[status]}>{t(`bills.status.${status}`)}</Badge>;
}

/** Start of a yyyy-mm-dd day (local) in ms; `end` gives the last ms of that day. */
export function dayMs(day: string, end = false): number {
  const d = new Date(`${day}T00:00:00`);
  return end ? d.getTime() + 86_400_000 - 1 : d.getTime();
}

export function BillsPage() {
  const { t } = useI18n();
  const [from, setFrom] = useState(isoDay());
  const [to, setTo] = useState(isoDay());
  const [status, setStatus] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const bills = useQuery({
    queryKey: ['sales', 'list', from, to, status],
    queryFn: () => api<BillRow[]>(`/sales?${new URLSearchParams({ from: String(dayMs(from)), to: String(dayMs(to, true)), ...(status ? { status } : {}) })}`),
  });

  const columns: ColumnDef<BillRow>[] = [
    { accessorKey: 'billNo', header: t('bills.billNo'), cell: (c) => <span className="num font-bold">{c.row.original.billNo}</span> },
    { accessorKey: 'createdAt', header: t('common.date'), cell: (c) => formatDateTime(c.row.original.createdAt) },
    { accessorKey: 'customerName', header: t('pos.customer'), cell: (c) => c.row.original.customerName ?? <span className="text-muted">{t('pos.walkIn')}</span> },
    { accessorKey: 'total', header: t('common.total'), cell: (c) => <span className="num font-semibold">{formatMoney(c.row.original.total)}</span> },
    {
      accessorKey: 'due',
      header: t('receipt.due'),
      cell: (c) => (c.row.original.due > 0 ? <span className="num font-semibold text-warning">{formatMoney(c.row.original.due)}</span> : '—'),
    },
    { accessorKey: 'paymentMethod', header: t('bills.method'), cell: (c) => t(`method.${c.row.original.paymentMethod}`) },
    { accessorKey: 'status', header: t('bills.status'), cell: (c) => <StatusBadge status={c.row.original.status} /> },
    { accessorKey: 'userName', header: t('bills.by'), cell: (c) => `${c.row.original.userName ?? ''} · ${c.row.original.deviceName ?? ''}` },
  ];

  return (
    <div>
      <PageHeader title={t('bills.title')} />
      <DataTable
        data={bills.data}
        loading={bills.isLoading}
        columns={columns}
        searchable
        onRowClick={(b) => setOpenId(b.id)}
        toolbar={
          <>
            <Input type="date" className="num w-44" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t('common.from')} />
            <Input type="date" className="num w-44" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t('common.to')} />
            <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
              <option value="">{t('common.all')}</option>
              {(['done', 'cancelled', 'quotation', 'held'] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`bills.status.${s}`)}
                </option>
              ))}
            </NativeSelect>
          </>
        }
        empty={<EmptyState icon={<ReceiptText />} title={t('bills.empty')} />}
      />
      {openId && <BillSheet id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

export function BillSheet({ id, onClose }: { id: number; onClose: () => void }) {
  const { t, lang, unitLabel } = useI18n();
  const can = useCan();
  const navigate = useNavigate();
  const printSale = usePrintSale();
  const [cancelling, setCancelling] = useState(false);
  const bill = useQuery({ queryKey: ['sales', 'detail', id], queryFn: () => api<SaleDetail>(`/sales/${id}`) });
  const b = bill.data;

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={b ? `${t('receipt.bill')} ${b.billNo}` : t('common.loading')}
      footer={
        b && (
          <>
            {can('sale.cancel') && b.status === 'done' && (
              <Button variant="destructive" className="me-auto" onClick={() => setCancelling(true)}>
                <Ban /> {t('bills.cancel')}
              </Button>
            )}
            {(b.status === 'quotation' || b.status === 'held') && can('sale') && (
              <Button variant="outline" onClick={() => navigate('/pos', { state: { openSaleId: b.id } })}>
                <ShoppingCart /> {t('bills.openInPos')}
              </Button>
            )}
            <Button onClick={() => printSale(b)}>
              <Printer /> {t('bills.reprint')}
            </Button>
          </>
        )
      }
    >
      {!b ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={b.status} />
            <span className="text-muted">{formatDateTime(b.createdAt)}</span>
            <span className="text-muted">
              · {b.userName} · {b.deviceName}
            </span>
          </div>
          {b.cancelReason && (
            <p className="rounded-md bg-danger/10 p-3 text-danger">
              {t('bills.reason')}: {b.cancelReason}
            </p>
          )}
          <p>
            <span className="text-muted">{t('pos.customer')}: </span>
            <span className="font-semibold">{b.customerName ?? t('pos.walkIn')}</span>
            {b.plumberName && (
              <span className="text-muted">
                {' '}
                · {t('pos.plumber')}: {b.plumberName}
              </span>
            )}
          </p>
          <table className="w-full text-sm">
            <tbody>
              {b.items.map((i) => (
                <tr key={i.id} className="border-t border-border">
                  <td className="py-2">
                    <FileText className="me-1 inline size-4 text-muted" />
                    {lang === 'ur' && i.nameUr ? i.nameUr : i.nameEn}
                  </td>
                  <td className="num text-end">
                    {formatQty(i.qty)} {unitLabel(i.unit)} × {formatMoney(i.rate)}
                  </td>
                  <td className="num text-end font-semibold">{formatMoney(i.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="space-y-1 rounded-lg bg-surface-2 p-3">
            <Line label={t('pos.subtotal')} value={b.subtotal} />
            {b.discount > 0 && <Line label={t('pos.discount')} value={-b.discount} />}
            {b.tax > 0 && <Line label={t('pos.tax')} value={b.tax} />}
            <Line label={t('pos.total')} value={b.total} big />
            {b.creditApplied > 0 && <Line label={t('receipt.advance')} value={-b.creditApplied} />}
            <Line label={`${t('receipt.paid')} (${t(`method.${b.paymentMethod}`)})`} value={b.paid} />
            {b.due > 0 && <Line label={t('receipt.due')} value={b.due} />}
          </div>
        </div>
      )}
      {cancelling && b && <CancelDialog bill={b} onClose={() => setCancelling(false)} />}
    </Sheet>
  );
}

function Line({ label, value, big }: { label: string; value: number; big?: boolean }) {
  return (
    <div className={big ? 'flex justify-between text-xl font-bold' : 'flex justify-between'}>
      <span>{label}</span>
      <span className="num">{formatMoney(value)}</span>
    </div>
  );
}

function CancelDialog({ bill, onClose }: { bill: SaleDetail; onClose: () => void }) {
  const { t, errorText } = useI18n();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const cancel = useMutation({
    mutationFn: () => api(`/sales/${bill.id}/cancel`, 'POST', { reason }),
    onSuccess: () => {
      toast.success(t('bills.cancelled', { billNo: bill.billNo }));
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      onClose();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('bills.cancel')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('common.back')}
          </Button>
          <Button variant="destructive" disabled={reason.trim().length < 3 || cancel.isPending} onClick={() => cancel.mutate()}>
            <Ban /> {t('bills.cancel')}
          </Button>
        </>
      }
    >
      <p className="mb-3 font-semibold text-danger">{t('bills.cancelConfirm', { billNo: bill.billNo })}</p>
      <Field label={t('bills.cancelReason')}>
        <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Dialog>
  );
}
