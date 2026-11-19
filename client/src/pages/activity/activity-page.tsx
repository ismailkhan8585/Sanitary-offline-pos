import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { History, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/i18n';
import { formatDateTime, isoDay } from '@/lib/utils';
import type { TranslationKey } from '@/i18n/en';
import { Input } from '@/components/ui/input';
import { Badge, EmptyState, PageHeader } from '@/components/ui/misc';
import { DataTable } from '@/components/ui/data-table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { dayMs } from '@/pages/bills/bills-page';

interface ActivityRow {
  id: number;
  action: string;
  details: string;
  createdAt: number;
  userName: string | null;
  deviceName: string | null;
}

interface ApprovalRow {
  id: number;
  action: string;
  details: string;
  createdAt: number;
  requestedBy: string | null;
  approvedBy: string | null;
}

/** Readable one-line view of a JSON details column. */
function Details({ text }: { text: string }) {
  let shown = text;
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;
    shown = Object.entries(obj)
      .filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && v.length === 0))
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
      .join(' · ');
  } catch {
    // plain text
  }
  return (
    <span className="line-clamp-2 max-w-xl break-all text-xs text-muted" title={shown}>
      {shown}
    </span>
  );
}

export function ActivityPage() {
  const { t } = useI18n();
  const [from, setFrom] = useState(isoDay());
  const [to, setTo] = useState(isoDay());
  const [action, setAction] = useState('');
  const range = `from=${dayMs(from)}&to=${dayMs(to, true)}`;
  const log = useQuery({ queryKey: ['activity', from, to, action], queryFn: () => api<ActivityRow[]>(`/activity?${range}${action ? `&action=${encodeURIComponent(action)}` : ''}`) });
  const approvals = useQuery({ queryKey: ['approvals', from, to], queryFn: () => api<ApprovalRow[]>(`/approvals?${range}`) });

  const logColumns: ColumnDef<ActivityRow>[] = [
    { accessorKey: 'createdAt', header: t('common.date'), cell: (c) => <span className="whitespace-nowrap">{formatDateTime(c.row.original.createdAt)}</span> },
    { accessorKey: 'userName', header: t('activity.user'), cell: (c) => `${c.row.original.userName ?? '—'}${c.row.original.deviceName ? ` · ${c.row.original.deviceName}` : ''}` },
    { accessorKey: 'action', header: t('activity.action'), cell: (c) => <Badge tone={c.row.original.action.includes('cancel') ? 'danger' : 'neutral'}>{c.row.original.action}</Badge> },
    { accessorKey: 'details', header: t('activity.details'), cell: (c) => <Details text={c.row.original.details} /> },
  ];
  const approvalColumns: ColumnDef<ApprovalRow>[] = [
    { accessorKey: 'createdAt', header: t('common.date'), cell: (c) => formatDateTime(c.row.original.createdAt) },
    { accessorKey: 'action', header: t('activity.action'), cell: (c) => <Badge tone="warning">{t(`approval.${c.row.original.action}` as TranslationKey)}</Badge> },
    { accessorKey: 'requestedBy', header: t('activity.requestedBy') },
    { accessorKey: 'approvedBy', header: t('activity.approvedBy') },
    { accessorKey: 'details', header: t('activity.details'), cell: (c) => <Details text={c.row.original.details} /> },
  ];
  const dates = (
    <>
      <Input type="date" className="num w-44" value={from} onChange={(e) => setFrom(e.target.value)} />
      <Input type="date" className="num w-44" value={to} onChange={(e) => setTo(e.target.value)} />
    </>
  );

  return (
    <div>
      <PageHeader title={t('activity.title')} />
      <Tabs defaultValue="log">
        <TabsList>
          <TabsTrigger value="log">{t('activity.title')}</TabsTrigger>
          <TabsTrigger value="approvals">{t('activity.approvals')}</TabsTrigger>
        </TabsList>
        <TabsContent value="log">
          <DataTable
            data={log.data}
            loading={log.isLoading}
            columns={logColumns}
            toolbar={
              <>
                {dates}
                <Input value={action} onChange={(e) => setAction(e.target.value)} placeholder={t('activity.filter')} className="w-72" />
              </>
            }
            empty={<EmptyState icon={<History />} title={t('activity.empty')} />}
          />
        </TabsContent>
        <TabsContent value="approvals">
          <DataTable data={approvals.data} loading={approvals.isLoading} columns={approvalColumns} toolbar={dates} empty={<EmptyState icon={<ShieldCheck />} title={t('activity.empty')} />} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
