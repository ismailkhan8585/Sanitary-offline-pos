import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { Clock, DoorClosed, DoorOpen, Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/i18n';
import { usePublicSettings } from '@/hooks/use-auth';
import { formatMoney, toPaisa } from '@shared/money';
import { cn, escapeHtml, formatDateTime } from '@/lib/utils';
import { printHtml } from '@/lib/print';
import { RECEIPT_CSS } from '@/components/receipt';
import type { TranslationKey } from '@/i18n/en';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, Card, EmptyState, Field, PageHeader, Skeleton } from '@/components/ui/misc';
import { Dialog } from '@/components/ui/dialog';
import { DataTable } from '@/components/ui/data-table';

export interface ShiftSummary {
  salesCount: number;
  salesTotal: number;
  byMethod: Record<string, number>;
  udhaarGiven: number;
  cashSales: number;
  paymentsIn: number;
  paymentsOut: number;
  expenses: number;
  refunds: number;
  challanAdvances: number;
  supplierPaid: number;
  supplierRefunds: number;
  expected: number;
}

export interface Shift {
  id: number;
  userId: number;
  openingCash: number;
  closingCash: number | null;
  expectedCash: number | null;
  difference: number | null;
  openedAt: number;
  closedAt: number | null;
  userName?: string | null;
  deviceName?: string | null;
  summary?: ShiftSummary;
}

export function useCurrentShift() {
  return useQuery({ queryKey: ['shift', 'current'], queryFn: () => api<Shift | null>('/shifts/current'), refetchInterval: 60_000 });
}

export function DifferenceBadge({ diff }: { diff: number }) {
  const { t } = useI18n();
  if (diff === 0) return <Badge tone="success">{t('shift.exact')}</Badge>;
  return (
    <Badge tone={diff < 0 ? 'danger' : 'warning'} className="text-sm">
      {diff < 0 ? t('shift.short') : t('shift.extra')} <span className="num">{formatMoney(Math.abs(diff))}</span>
    </Badge>
  );
}

export function ShiftPage() {
  const { t } = useI18n();
  const current = useCurrentShift();
  const [reportId, setReportId] = useState<number | null>(null);
  const history = useQuery({ queryKey: ['shift', 'list'], queryFn: () => api<Shift[]>('/shifts') });

  const columns: ColumnDef<Shift>[] = [
    { accessorKey: 'openedAt', header: t('shift.openedAt'), cell: (c) => formatDateTime(c.row.original.openedAt) },
    { accessorKey: 'closedAt', header: t('shift.closedAt'), cell: (c) => (c.row.original.closedAt ? formatDateTime(c.row.original.closedAt) : <Badge tone="warning">{t('shift.running')}</Badge>) },
    { accessorKey: 'userName', header: t('activity.user'), cell: (c) => `${c.row.original.userName ?? ''} · ${c.row.original.deviceName ?? ''}` },
    { accessorKey: 'expectedCash', header: t('shift.expected'), cell: (c) => <span className="num">{c.row.original.expectedCash !== null ? formatMoney(c.row.original.expectedCash) : '—'}</span> },
    { accessorKey: 'closingCash', header: t('shift.closingCash'), cell: (c) => <span className="num">{c.row.original.closingCash !== null ? formatMoney(c.row.original.closingCash) : '—'}</span> },
    { accessorKey: 'difference', header: t('shift.difference'), cell: (c) => (c.row.original.difference !== null ? <DifferenceBadge diff={c.row.original.difference} /> : '—') },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title={t('shift.title')} />
      {current.isLoading ? <Skeleton className="h-64" /> : current.data ? <CloseShift shift={current.data} /> : <OpenShift />}
      <div>
        <h2 className="mb-2 text-lg font-bold">{t('shift.history')}</h2>
        <DataTable data={history.data} loading={history.isLoading} columns={columns} onRowClick={(s) => setReportId(s.id)} empty={<EmptyState icon={<Clock />} title={t('common.empty')} />} />
      </div>
      {reportId && <ShiftReport id={reportId} onClose={() => setReportId(null)} />}
    </div>
  );
}

function useShiftMutation(path: 'open' | 'close', onDone: (s: Shift) => void) {
  const { errorText } = useI18n();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: object) => api<Shift>(`/shifts/${path}`, 'POST', body),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ['shift'] });
      onDone(s);
    },
    onError: (e) => toast.error(errorText(e)),
  });
}

function OpenShift() {
  const { t } = useI18n();
  const [cash, setCash] = useState('');
  const open = useShiftMutation('open', () => toast.success(t('shift.opened')));
  return (
    <Card className="flex flex-wrap items-end gap-4 p-5">
      <DoorOpen className="size-10 text-primary" />
      <Field label={t('shift.openingCash')} className="w-64">
        <Input autoFocus type="number" step="any" min="0" className="num h-12 text-xl" value={cash} onChange={(e) => setCash(e.target.value)} />
      </Field>
      <Button size="lg" disabled={open.isPending} onClick={() => open.mutate({ openingCash: toPaisa(Number(cash) || 0) })}>
        {t('shift.open')}
      </Button>
    </Card>
  );
}

function CloseShift({ shift }: { shift: Shift }) {
  const { t } = useI18n();
  const printReport = usePrintShift();
  const [cash, setCash] = useState('');
  const [confirming, setConfirming] = useState(false);
  const counted = toPaisa(Number(cash) || 0);
  const expected = shift.summary?.expected ?? 0;
  const close = useShiftMutation('close', (s) => {
    toast.success(t('shift.closedMsg', { diff: formatMoney(s.difference ?? 0) }));
    printReport(s);
  });
  return (
    <Card className="grid gap-6 p-5 md:grid-cols-2">
      <div>
        <p className="mb-2 text-muted">
          {t('shift.openedAt')}: {formatDateTime(shift.openedAt)}
        </p>
        {shift.summary && <SummaryTable shift={shift} />}
      </div>
      <div className="space-y-4">
        <div className="rounded-lg bg-primary/10 p-4 text-center">
          <p className="font-semibold text-muted">{t('shift.expected')}</p>
          <p className="num text-4xl font-bold text-primary">{formatMoney(expected)}</p>
        </div>
        <Field label={t('shift.closingCash')}>
          <Input type="number" step="any" min="0" className="num h-14 text-2xl" value={cash} onChange={(e) => setCash(e.target.value)} />
        </Field>
        {cash !== '' && (
          <div className="flex items-center justify-between text-lg">
            <span>{t('shift.difference')}</span>
            <DifferenceBadge diff={counted - expected} />
          </div>
        )}
        <Button size="xl" variant="destructive" className="w-full" disabled={cash === '' || close.isPending} onClick={() => setConfirming(true)}>
          <DoorClosed /> {t('shift.close')}
        </Button>
      </div>
      {confirming && (
        <Dialog
          open
          onOpenChange={(o) => !o && setConfirming(false)}
          title={t('shift.close')}
          footer={
            <>
              <Button variant="outline" onClick={() => setConfirming(false)}>
                {t('common.back')}
              </Button>
              <Button variant="destructive" onClick={() => (setConfirming(false), close.mutate({ closingCash: counted }))}>
                {t('shift.close')}
              </Button>
            </>
          }
        >
          <p className="text-lg font-semibold">{t('shift.closeConfirm', { amount: formatMoney(counted) })}</p>
        </Dialog>
      )}
    </Card>
  );
}

function summaryRows(shift: Shift): [TranslationKey, number][] {
  const s = shift.summary!;
  return [
    ['shift.opening', shift.openingCash],
    ['shift.cashSales', s.cashSales],
    ['shift.paymentsIn', s.paymentsIn],
    ['shift.advances', s.challanAdvances],
    ['shift.supplierRefunds', s.supplierRefunds],
    ['shift.paymentsOut', -s.paymentsOut],
    ['shift.expenses', -s.expenses],
    ['shift.refunds', -s.refunds],
    ['shift.supplierPaid', -s.supplierPaid],
  ];
}

function SummaryTable({ shift }: { shift: Shift }) {
  const { t } = useI18n();
  const s = shift.summary!;
  return (
    <table className="w-full text-sm">
      <tbody>
        <tr className="border-b border-border">
          <td className="py-1.5">
            {t('shift.sales')}: <b className="num">{s.salesCount}</b>
          </td>
          <td className="num text-end font-semibold">{formatMoney(s.salesTotal)}</td>
        </tr>
        {Object.entries(s.byMethod)
          .filter(([m]) => m !== 'credit')
          .map(([m, v]) => (
            <tr key={m} className="text-muted">
              <td className="py-1 ps-4">{t(`method.${m}` as TranslationKey)}</td>
              <td className="num text-end">{formatMoney(v)}</td>
            </tr>
          ))}
        <tr className="border-b border-border text-muted">
          <td className="py-1 ps-4">{t('shift.udhaar')}</td>
          <td className="num text-end">{formatMoney(s.udhaarGiven)}</td>
        </tr>
        {summaryRows(shift)
          .filter(([, v], i) => i === 0 || v !== 0)
          .map(([k, v]) => (
            <tr key={k}>
              <td className="py-1.5">{t(k)}</td>
              <td className={cn('num text-end font-semibold', v < 0 && 'text-danger')}>{formatMoney(v)}</td>
            </tr>
          ))}
        <tr className="border-t-2 border-border text-base">
          <td className="py-2 font-bold">{t('shift.expected')}</td>
          <td className="num text-end font-bold">{formatMoney(s.expected)}</td>
        </tr>
      </tbody>
    </table>
  );
}

function usePrintShift() {
  const { t } = useI18n();
  const { data: shop } = usePublicSettings();
  return (shift: Shift) => {
    if (!shop || !shift.summary) return;
    const row = (label: string, value: number) => `<div class="row"><span>${label}</span><span class="num">${formatMoney(value)}</span></div>`;
    const body = [
      `<div class="center"><div class="shop">${escapeHtml(shop.shop_name_en)}</div><div class="banner">${t('shift.report')}</div></div>`,
      `<div class="row"><span>${t('activity.user')}</span><span>${escapeHtml(shift.userName ?? '')}</span></div>`,
      `<div class="row"><span>${t('shift.openedAt')}</span><span class="num">${formatDateTime(shift.openedAt)}</span></div>`,
      shift.closedAt ? `<div class="row"><span>${t('shift.closedAt')}</span><span class="num">${formatDateTime(shift.closedAt)}</span></div>` : '',
      '<div class="rule"></div>',
      row(`${t('shift.sales')} (${shift.summary.salesCount})`, shift.summary.salesTotal),
      ...Object.entries(shift.summary.byMethod).map(([m, v]) => row(t(`method.${m}` as TranslationKey), v)),
      row(t('shift.udhaar'), shift.summary.udhaarGiven),
      '<div class="rule"></div>',
      ...summaryRows(shift).map(([k, v]) => row(t(k), v)),
      '<div class="rule"></div>',
      `<div class="total">${row(t('shift.expected'), shift.summary.expected)}</div>`,
      shift.closingCash !== null ? row(t('shift.closingCash'), shift.closingCash) : '',
      shift.difference !== null ? row(t('shift.difference'), shift.difference) : '',
    ].join('');
    const styles = [...document.querySelectorAll('link[rel="stylesheet"], style')].map((el) => el.outerHTML).join('');
    printHtml(`<!doctype html><html><head><meta charset="utf-8"><base href="${location.origin}/">${styles}<style>${RECEIPT_CSS}</style></head><body><div class="receipt w-${shop.receipt_width}">${body}</div></body></html>`, shop.receipt_width);
  };
}

function ShiftReport({ id, onClose }: { id: number; onClose: () => void }) {
  const { t } = useI18n();
  const printReport = usePrintShift();
  const shift = useQuery({ queryKey: ['shift', id], queryFn: () => api<Shift>(`/shifts/${id}`) });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('shift.report')}
      footer={
        shift.data && (
          <Button onClick={() => printReport(shift.data!)}>
            <Printer /> {t('shift.printReport')}
          </Button>
        )
      }
    >
      {!shift.data ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="space-y-3">
          <p className="text-muted">
            {shift.data.userName} · {formatDateTime(shift.data.openedAt)} → {shift.data.closedAt ? formatDateTime(shift.data.closedAt) : t('shift.running')}
          </p>
          <SummaryTable shift={shift.data} />
          {shift.data.difference !== null && (
            <div className="flex items-center justify-between">
              <span>
                {t('shift.closingCash')}: <b className="num">{formatMoney(shift.data.closingCash ?? 0)}</b>
              </span>
              <DifferenceBadge diff={shift.data.difference} />
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
