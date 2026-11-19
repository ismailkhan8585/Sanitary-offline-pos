import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import { MonitorSmartphone, AlertTriangle, BookUser, Banknote, CircleCheck, ReceiptText, TrendingUp } from 'lucide-react';
import { api } from '@/lib/api';
import { useRealtime } from '@/lib/realtime';
import { useI18n, useLocalName } from '@/i18n';
import { formatMoney } from '@shared/money';
import { cn, formatDateTime } from '@/lib/utils';
import type { SaleStatus } from '@/lib/types';
import { MoneyBarChart } from '@/components/bar-chart';
import { StockBadge } from '@/components/stock-badge';
import { Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';
import { BillSheet, StatusBadge } from '@/pages/bills/bills-page';
import { BackupHealthGrid, useBackupHealth } from '@/pages/backup/backup-health';
import { useCan } from '@/hooks/use-auth';

interface Dashboard {
  today: { bills: number; total: number; cash: number; udhaar: number; lowStock: number; profit?: number };
  days: { day: string; total: number; profit?: number }[];
  lowStock: { id: number; code: string; name: string; nameUr: string; unit: string; stock: number; minStock: number }[];
  recent: { id: number; billNo: string; total: number; due: number; status: SaleStatus; createdAt: number; customerName: string | null }[];
}

function Kpi({ icon: Icon, label, value, sub, tone = 'text-primary', to }: { icon: LucideIcon; label: string; value: string; sub?: string; tone?: string; to?: string }) {
  const body = (
    <Card className="h-full p-4 transition hover:shadow-md">
      <p className="flex items-center gap-2 text-sm font-medium text-muted">
        <span className={`rounded-md bg-surface-2 p-1.5 ${tone}`}>
          <Icon className="size-5" />
        </span>
        {label}
      </p>
      <p className="num mt-2 whitespace-nowrap text-2xl font-bold">{value}</p>
      {sub && <p className="text-sm text-muted">{sub}</p>}
    </Card>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

export function DashboardPage() {
  const { t } = useI18n();
  const name = useLocalName();
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/dashboard'), refetchInterval: 60_000 });
  const [openBill, setOpenBill] = useState<number | null>(null);
  const d = dash.data;

  if (!d) {
    return (
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
        <Skeleton className="h-72 md:col-span-3 xl:col-span-5" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t('dash.title')} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi icon={TrendingUp} label={t('dash.sales')} value={formatMoney(d.today.total)} sub={t('dash.bills', { count: d.today.bills })} to="/bills" />
        {d.today.profit !== undefined && <Kpi icon={TrendingUp} label={t('dash.profit')} value={formatMoney(d.today.profit)} tone="text-success" to="/reports" />}
        <Kpi icon={Banknote} label={t('dash.cash')} value={formatMoney(d.today.cash)} tone="text-success" />
        <Kpi icon={BookUser} label={t('dash.udhaar')} value={formatMoney(d.today.udhaar)} tone="text-warning" to="/khata" />
        <Kpi
          icon={d.today.lowStock ? AlertTriangle : CircleCheck}
          label={t('dash.lowStock')}
          value={String(d.today.lowStock)}
          tone={d.today.lowStock ? 'text-warning' : 'text-success'}
          to="/products"
        />
      </div>
      <BackupStatus />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="p-4 xl:col-span-2">
          <h2 className="text-lg font-bold">{t('dash.week')}</h2>
          <p className="text-sm text-muted">{t('dash.weekSub')}</p>
          <MoneyBarChart valueName={t('report.col.net')} data={d.days.map((x) => ({ label: x.day.slice(5), value: x.total }))} />
        </Card>
        <div className="space-y-4">
        <Counters />
        <Card className="p-4">
          <h2 className="mb-2 text-lg font-bold">{t('dash.lowList')}</h2>
          {d.lowStock.length === 0 ? (
            <EmptyState icon={<CircleCheck />} title={t('dash.allGood')} />
          ) : (
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {d.lowStock.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 border-b border-border py-2 last:border-0">
                  <span className="min-w-0 truncate font-semibold">{name({ nameEn: p.name, nameUr: p.nameUr })}</span>
                  <StockBadge qty={p.stock} minStock={p.minStock} unit={p.unit} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        </div>
      </div>
      <Card className="p-4">
        <h2 className="mb-2 text-lg font-bold">{t('dash.recent')}</h2>
        {d.recent.length === 0 ? (
          <EmptyState icon={<ReceiptText />} title={t('bills.empty')} />
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {d.recent.map((b) => (
                <tr key={b.id} className="cursor-pointer border-t border-border hover:bg-surface-2" onClick={() => setOpenBill(b.id)}>
                  <td className="num py-2 font-bold">{b.billNo}</td>
                  <td>{formatDateTime(b.createdAt)}</td>
                  <td>{b.customerName ?? t('pos.walkIn')}</td>
                  <td>
                    <StatusBadge status={b.status} />
                  </td>
                  <td className="num text-end font-semibold">{formatMoney(b.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {openBill && <BillSheet id={openBill} onClose={() => setOpenBill(null)} />}
    </div>
  );
}

/** Which counters are online right now (live from the server). */
function Counters() {
  const { t } = useI18n();
  const { presence } = useRealtime();
  const devices = useQuery({ queryKey: ['devices', 'public'], queryFn: () => api<{ id: number; name: string; billPrefix: string }[]>('/devices/public') });
  return (
    <Card className="p-4">
      <h2 className="mb-2 text-lg font-bold">{t('dash.counters')}</h2>
      <ul className="space-y-1">
        {devices.data?.map((d) => {
          const here = presence.filter((p) => p.deviceId === d.id);
          return (
            <li key={d.id} className="flex items-center justify-between gap-2 py-1">
              <span className="flex items-center gap-2 font-semibold">
                <MonitorSmartphone className="size-5 text-muted" /> {d.name} <span className="num text-muted">({d.billPrefix})</span>
              </span>
              <span className={cn('flex items-center gap-1.5 text-sm font-medium', here.length ? 'text-success' : 'text-muted')}>
                <span className={cn('size-2.5 rounded-full', here.length ? 'bg-success' : 'bg-border')} />
                {here.length ? `${t('dash.online')} · ${here.map((p) => p.userName).join(', ')}` : t('dash.offline')}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Admin only: backup health tiles and the weekly take-home reminder. */
function BackupStatus() {
  const { t } = useI18n();
  const can = useCan();
  const health = useBackupHealth(can('backup'));
  if (!health.data) return null;
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">{t('backup.health')}</h2>
        <Link to="/backup" className="text-sm font-semibold text-primary underline">
          {t('nav.backup')}
        </Link>
      </div>
      {!health.data.takeHome.ok && (
        <p className="flex items-center gap-2 rounded-md bg-danger/10 p-3 font-semibold text-danger">
          <AlertTriangle className="size-5" /> {t('backup.takeHomeDue')}
        </p>
      )}
      <BackupHealthGrid h={health.data} />
    </Card>
  );
}
