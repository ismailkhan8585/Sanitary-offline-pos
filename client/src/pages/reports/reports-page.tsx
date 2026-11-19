import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileBarChart } from 'lucide-react';
import { api, downloadUrl } from '@/lib/api';
import { useI18n } from '@/i18n';
import { formatMoney, formatQty } from '@shared/money';
import { formatDate, isoDay } from '@/lib/utils';
import type { TranslationKey } from '@/i18n/en';
import { MoneyBarChart } from '@/components/bar-chart';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { dayMs } from '@/pages/bills/bills-page';

type ColumnType = 'text' | 'money' | 'qty' | 'int' | 'date' | 'pct';
interface Report {
  columns: { key: string; type: ColumnType }[];
  rows: Record<string, string | number | null>[];
}

/** Each report, its grouping choices, and whether dates apply. */
const KINDS: { kind: string; groups?: string[]; dated: boolean }[] = [
  { kind: 'sales', groups: ['day', 'month'], dated: true },
  { kind: 'items', groups: ['category', 'brand', 'product'], dated: true },
  { kind: 'top', dated: true },
  { kind: 'dead', dated: true },
  { kind: 'udhaar', dated: false },
  { kind: 'payables', dated: false },
  { kind: 'stock', groups: ['category', 'product'], dated: false },
  { kind: 'staff', groups: ['user', 'device'], dated: true },
  { kind: 'returns', dated: true },
  { kind: 'cancels', dated: true },
  { kind: 'discounts', dated: true },
];

const SUMMABLE: ColumnType[] = ['money', 'int'];

export function ReportsPage() {
  const { t } = useI18n();
  const monthStart = new Date();
  monthStart.setDate(1);
  const [kind, setKind] = useState('sales');
  const [from, setFrom] = useState(isoDay(monthStart));
  const [to, setTo] = useState(isoDay());
  const [groups, setGroups] = useState<Record<string, string>>({});
  const spec = KINDS.find((k) => k.kind === kind)!;
  const group = groups[kind] ?? spec.groups?.[0];
  const params: Record<string, string> = { from: String(dayMs(from)), to: String(dayMs(to, true)), ...(group ? { group } : {}) };
  const report = useQuery({ queryKey: ['report', kind, params], queryFn: () => api<Report>(`/reports/${kind}?${new URLSearchParams(params)}`) });

  const cell = (type: ColumnType, v: string | number | null, key: string) => {
    if (v === null || v === undefined || v === '') return '—';
    if (type === 'money') return formatMoney(Number(v));
    if (type === 'qty') return formatQty(Number(v));
    if (type === 'date') return formatDate(Number(v));
    if (type === 'pct') return `${v}%`;
    if (key === 'kind') return t(`report.kind.${v}` as TranslationKey);
    if (key === 'refundType') return t(`return.refund.${v}` as TranslationKey);
    return String(v);
  };

  const r = report.data;
  return (
    <div>
      <PageHeader
        title={t('report.title')}
        actions={
          <Button variant="outline" asChild>
            <a href={downloadUrl(`/reports/${kind}`, { ...params, format: 'xlsx' })} download>
              <Download /> {t('report.export')}
            </a>
          </Button>
        }
      />
      <Tabs value={kind} onValueChange={setKind}>
        <TabsList>
          {KINDS.map((k) => (
            <TabsTrigger key={k.kind} value={k.kind}>
              {t(`report.${k.kind}` as TranslationKey)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="mb-3 flex flex-wrap gap-2">
        {spec.dated && (
          <>
            <Input type="date" className="num w-44" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t('common.from')} />
            <Input type="date" className="num w-44" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t('common.to')} />
          </>
        )}
        {spec.groups && (
          <NativeSelect value={group} onChange={(e) => setGroups({ ...groups, [kind]: e.target.value })} className="w-44">
            {spec.groups.map((g) => (
              <option key={g} value={g}>
                {t(`report.group.${g}` as TranslationKey)}
              </option>
            ))}
          </NativeSelect>
        )}
      </div>
      {!r ? (
        <Skeleton className="h-96" />
      ) : r.rows.length === 0 ? (
        <EmptyState icon={<FileBarChart />} title={t('report.empty')} />
      ) : (
        <div className="space-y-4">
          {kind === 'sales' && r.rows.length > 1 && (
            <Card className="p-4">
              <h2 className="text-lg font-bold">{t('report.sales')}</h2>
              <p className="text-sm text-muted">{t('report.chartSub')}</p>
              <MoneyBarChart valueName={t('report.col.net')} data={r.rows.map((row) => ({ label: String(row.period), value: Number(row.net) }))} />
            </Card>
          )}
          <div className="max-h-[calc(100vh-16rem)] overflow-auto rounded-lg border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-2 text-muted">
                <tr>
                  {r.columns.map((c) => (
                    <th key={c.key} className={`whitespace-nowrap px-3 py-2.5 ${c.type === 'text' || c.type === 'date' ? 'text-start' : 'text-end'}`}>
                      {t(`report.col.${c.key}` as TranslationKey)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.rows.map((row, i) => (
                  <tr key={i} className="border-t border-border">
                    {r.columns.map((c) => (
                      <td key={c.key} className={`px-3 py-2 ${c.type === 'text' || c.type === 'date' ? '' : 'num text-end'} ${c.key === 'profit' && Number(row[c.key]) < 0 ? 'text-danger' : ''}`}>
                        {cell(c.type, row[c.key], c.key)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 bg-surface-2 font-bold">
                <tr>
                  {r.columns.map((c, i) => (
                    <td key={c.key} className={`px-3 py-2.5 ${SUMMABLE.includes(c.type) ? 'num text-end' : ''}`}>
                      {i === 0
                        ? t('report.total')
                        : SUMMABLE.includes(c.type) && c.key !== 'creditLimit'
                          ? cell(c.type, r.rows.reduce((s, row) => s + Number(row[c.key] ?? 0), 0), c.key)
                          : ''}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
