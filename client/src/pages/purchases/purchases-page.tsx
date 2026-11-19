import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { PackagePlus, Truck, Undo2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n, useLocalName } from '@/i18n';
import { formatMoney, formatQty } from '@shared/money';
import { formatDateTime, isoDay } from '@/lib/utils';
import type { PaymentMethod } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/dialog';
import { DataTable } from '@/components/ui/data-table';
import { dayMs } from '@/pages/bills/bills-page';

interface PurchaseRow {
  id: number;
  invoiceNo: string;
  total: number;
  paid: number;
  due: number;
  paymentMethod: PaymentMethod;
  isReturn: boolean;
  createdAt: number;
  supplierName: string;
  userName: string | null;
}

interface PurchaseDetail extends Omit<PurchaseRow, 'userName'> {
  items: { id: number; nameEn: string; nameUr: string; unit: string; qty: number; freeQty: number; cost: number }[];
}

export function PurchasesPage() {
  const { t } = useI18n();
  const monthStart = new Date();
  monthStart.setDate(1);
  const [from, setFrom] = useState(isoDay(monthStart));
  const [to, setTo] = useState(isoDay());
  const [openId, setOpenId] = useState<number | null>(null);
  const list = useQuery({
    queryKey: ['purchases', from, to],
    queryFn: () => api<PurchaseRow[]>(`/purchases?from=${dayMs(from)}&to=${dayMs(to, true)}`),
  });

  const columns: ColumnDef<PurchaseRow>[] = [
    { accessorKey: 'createdAt', header: t('common.date'), cell: (c) => formatDateTime(c.row.original.createdAt) },
    { accessorKey: 'supplierName', header: t('purchase.supplier'), cell: (c) => <span className="font-semibold">{c.row.original.supplierName}</span> },
    { accessorKey: 'invoiceNo', header: t('purchase.invoiceNo'), cell: (c) => <span className="num">{c.row.original.invoiceNo}</span> },
    {
      accessorKey: 'isReturn',
      header: t('purchase.type'),
      cell: (c) => (c.row.original.isReturn ? <Badge tone="accent">{t('purchase.typeReturn')}</Badge> : <Badge tone="primary">{t('purchase.typePurchase')}</Badge>),
    },
    { accessorKey: 'total', header: t('common.total'), cell: (c) => <span className="num font-semibold">{formatMoney(c.row.original.total)}</span> },
    { accessorKey: 'paid', header: t('receipt.paid'), cell: (c) => <span className="num">{formatMoney(c.row.original.paid)}</span> },
    { accessorKey: 'due', header: t('receipt.due'), cell: (c) => (c.row.original.due ? <span className="num text-warning">{formatMoney(c.row.original.due)}</span> : '—') },
  ];

  return (
    <div>
      <PageHeader
        title={t('purchase.title')}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/purchases/new?return=1">
                <Undo2 /> {t('purchase.newReturn')}
              </Link>
            </Button>
            <Button asChild>
              <Link to="/purchases/new">
                <PackagePlus /> {t('purchase.new')}
              </Link>
            </Button>
          </>
        }
      />
      <DataTable
        data={list.data}
        loading={list.isLoading}
        columns={columns}
        searchable
        onRowClick={(p) => setOpenId(p.id)}
        toolbar={
          <>
            <Input type="date" className="num w-44" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input type="date" className="num w-44" value={to} onChange={(e) => setTo(e.target.value)} />
          </>
        }
        empty={<EmptyState icon={<Truck />} title={t('purchase.empty')} />}
      />
      {openId && <PurchaseSheet id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function PurchaseSheet({ id, onClose }: { id: number; onClose: () => void }) {
  const { t, unitLabel } = useI18n();
  const name = useLocalName();
  const detail = useQuery({ queryKey: ['purchases', 'detail', id], queryFn: () => api<PurchaseDetail>(`/purchases/${id}`) });
  const p = detail.data;
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={p ? `${p.supplierName} ${p.invoiceNo}` : t('common.loading')}>
      {!p ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="space-y-4">
          <p className="text-muted">
            {formatDateTime(p.createdAt)} · {p.isReturn ? t('purchase.typeReturn') : t('purchase.typePurchase')}
          </p>
          <table className="w-full text-sm">
            <tbody>
              {p.items.map((i) => (
                <tr key={i.id} className="border-t border-border">
                  <td className="py-2">{name(i)}</td>
                  <td className="num text-end">
                    {formatQty(i.qty)}
                    {i.freeQty > 0 && ` + ${formatQty(i.freeQty)}`} {unitLabel(i.unit)}
                  </td>
                  <td className="num text-end">× {formatMoney(i.cost)}</td>
                  <td className="num text-end font-semibold">{formatMoney(Math.round(i.qty * i.cost))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="space-y-1 rounded-lg bg-surface-2 p-3">
            <p className="flex justify-between text-lg font-bold">
              <span>{t('common.total')}</span>
              <span className="num">{formatMoney(p.total)}</span>
            </p>
            <p className="flex justify-between">
              <span>
                {t('receipt.paid')} ({t(`method.${p.paymentMethod}`)})
              </span>
              <span className="num">{formatMoney(p.paid)}</span>
            </p>
            <p className="flex justify-between">
              <span>{t('receipt.due')}</span>
              <span className="num">{formatMoney(p.due)}</span>
            </p>
          </div>
        </div>
      )}
    </Sheet>
  );
}
