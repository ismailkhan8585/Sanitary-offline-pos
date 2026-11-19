import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/i18n';
import { useCan } from '@/hooks/use-auth';
import { useCustomers, usePlumbers } from '@/hooks/use-parties';
import { formatMoney } from '@shared/money';
import type { PartyType } from '@/lib/types';
import type { TranslationKey } from '@/i18n/en';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState, PageHeader, Switch } from '@/components/ui/misc';
import { DataTable } from '@/components/ui/data-table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BalanceBadge } from './balance-badge';
import { PartySheet } from './party-sheet';
import type { PartyRecord } from './party-form';

type Row = PartyRecord & { balance?: number };

export function KhataPage() {
  const { t } = useI18n();
  const can = useCan();
  const manage = can('party.manage');
  return (
    <div>
      <PageHeader title={t('khata.title')} />
      <Tabs defaultValue="customer">
        <TabsList>
          <TabsTrigger value="customer">{t('khata.customers')}</TabsTrigger>
          {manage && <TabsTrigger value="supplier">{t('khata.suppliers')}</TabsTrigger>}
          {manage && <TabsTrigger value="plumber">{t('khata.plumbers')}</TabsTrigger>}
        </TabsList>
        <TabsContent value="customer">
          <PartyList type="customer" />
        </TabsContent>
        {manage && (
          <>
            <TabsContent value="supplier">
              <PartyList type="supplier" />
            </TabsContent>
            <TabsContent value="plumber">
              <PartyList type="plumber" />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}

function useParties(type: PartyType) {
  const customers = useCustomers();
  const plumbers = usePlumbers();
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api<Row[]>('/suppliers'), enabled: type === 'supplier' });
  return (type === 'customer' ? customers : type === 'plumber' ? plumbers : suppliers) as { data?: Row[]; isLoading: boolean };
}

const LABELS: Record<PartyType, { add: TranslationKey; empty: TranslationKey }> = {
  customer: { add: 'khata.addCustomer', empty: 'khata.emptyCustomers' },
  supplier: { add: 'khata.addSupplier', empty: 'khata.emptySuppliers' },
  plumber: { add: 'khata.addPlumber', empty: 'khata.emptyPlumbers' },
};

function PartyList({ type }: { type: PartyType }) {
  const { t } = useI18n();
  const can = useCan();
  const parties = useParties(type);
  const [onlyBalance, setOnlyBalance] = useState(false);
  const [open, setOpen] = useState<Row | 'new' | null>(null);
  const rows = useMemo(() => (parties.data ?? []).filter((p) => !onlyBalance || (p.balance ?? 0) !== 0), [parties.data, onlyBalance]);
  const total = rows.reduce((s, p) => s + (p.balance ?? 0), 0);
  const canAdd = type === 'customer' ? can('customer.write') : can('party.manage');

  const columns: ColumnDef<Row>[] = [
    { accessorKey: 'name', header: t('common.name'), cell: (c) => <span className="font-semibold">{c.row.original.name}</span> },
    { accessorKey: 'phone', header: t('common.phone'), cell: (c) => <span className="num">{c.row.original.phone}</span> },
    ...(type === 'customer'
      ? ([
          { accessorKey: 'priceTier', header: t('khata.tier'), cell: (c) => t(`tier.${c.row.original.priceTier ?? 'retail'}`) },
          {
            accessorKey: 'creditLimit',
            header: t('khata.creditLimit'),
            cell: (c) => {
              const { creditLimit = 0, balance = 0 } = c.row.original;
              if (!creditLimit) return '—';
              return (
                <span className="num">
                  {formatMoney(creditLimit)} {balance > creditLimit && <Badge tone="danger">{t('khata.overLimit')}</Badge>}
                </span>
              );
            },
          },
        ] as ColumnDef<Row>[])
      : []),
    ...(type === 'supplier' ? ([{ accessorKey: 'company', header: t('khata.company') }] as ColumnDef<Row>[]) : []),
    ...(type === 'plumber' ? ([{ accessorKey: 'commissionPct', header: t('khata.commission'), cell: (c) => <span className="num">{c.row.original.commissionPct}%</span> }] as ColumnDef<Row>[]) : []),
    ...(rows.some((r) => r.balance !== undefined)
      ? ([{ accessorKey: 'balance', header: t('khata.balance'), cell: (c) => <BalanceBadge type={type} balance={c.row.original.balance ?? 0} /> }] as ColumnDef<Row>[])
      : []),
  ];

  return (
    <>
      <DataTable
        data={rows}
        loading={parties.isLoading}
        columns={columns}
        searchable
        onRowClick={setOpen}
        toolbar={
          <>
            <label className="flex h-11 items-center gap-2 rounded-md border border-border bg-surface px-3">
              <Switch checked={onlyBalance} onCheckedChange={setOnlyBalance} />
              {t('khata.onlyBalance')}
            </label>
            {rows.some((r) => r.balance !== undefined) && (
              <span className="num rounded-md bg-surface-2 px-3 py-2 font-semibold">
                {t('common.total')}: {formatMoney(total)}
              </span>
            )}
            {canAdd && (
              <Button onClick={() => setOpen('new')}>
                <Plus /> {t(LABELS[type].add)}
              </Button>
            )}
          </>
        }
        empty={<EmptyState icon={<Users />} title={t(LABELS[type].empty)} />}
      />
      {open && <PartySheet type={type} party={open === 'new' ? null : open} onClose={() => setOpen(null)} />}
    </>
  );
}
