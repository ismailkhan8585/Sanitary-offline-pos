import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { HardHat, Plus, UserRound } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/i18n';
import { formatMoney, toPaisa } from '@shared/money';
import { formatDateTime } from '@/lib/utils';
import type { Customer } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, EmptyState, Field, PageHeader } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/dialog';
import { DataTable } from '@/components/ui/data-table';
import { CustomerPicker } from '@/pages/pos/customer-picker';
import { ChallanLines, linesToItems, type ChallanLine } from './challan-lines';

export interface ChallanRow {
  id: number;
  challanNo: string;
  customerName: string;
  siteName: string;
  advance: number;
  status: 'open' | 'closed';
  createdAt: number;
  itemCount: number;
  valueAtSite: number;
}

export function ChallanStatus({ status }: { status: 'open' | 'closed' }) {
  const { t } = useI18n();
  return <Badge tone={status === 'open' ? 'warning' : 'success'}>{t(`challan.status.${status}`)}</Badge>;
}

export function ChallansPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const list = useQuery({ queryKey: ['challans'], queryFn: () => api<ChallanRow[]>('/challans') });
  const [creating, setCreating] = useState(false);

  const columns: ColumnDef<ChallanRow>[] = [
    { accessorKey: 'challanNo', header: '#', cell: (c) => <span className="num font-bold">{c.row.original.challanNo}</span> },
    { accessorKey: 'createdAt', header: t('common.date'), cell: (c) => formatDateTime(c.row.original.createdAt) },
    { accessorKey: 'customerName', header: t('pos.customer'), cell: (c) => <span className="font-semibold">{c.row.original.customerName}</span> },
    { accessorKey: 'siteName', header: t('challan.site') },
    { accessorKey: 'valueAtSite', header: t('challan.value'), cell: (c) => <span className="num">{formatMoney(c.row.original.valueAtSite)}</span> },
    { accessorKey: 'advance', header: t('challan.advance'), cell: (c) => <span className="num">{formatMoney(c.row.original.advance)}</span> },
    { accessorKey: 'status', header: t('bills.status'), cell: (c) => <ChallanStatus status={c.row.original.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title={t('challan.title')}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> {t('challan.new')}
          </Button>
        }
      />
      <DataTable
        data={list.data}
        loading={list.isLoading}
        columns={columns}
        searchable
        onRowClick={(c) => navigate(`/challans/${c.id}`)}
        empty={<EmptyState icon={<HardHat />} title={t('challan.empty')} />}
      />
      {creating && <NewChallan onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewChallan({ onClose }: { onClose: () => void }) {
  const { t, errorText } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [picking, setPicking] = useState(false);
  const [site, setSite] = useState('');
  const [advance, setAdvance] = useState('');
  const [lines, setLines] = useState<ChallanLine[]>([]);
  const save = useMutation({
    mutationFn: () => api<{ id: number; challanNo: string }>('/challans', 'POST', { customerId: customer!.id, siteName: site, advance: toPaisa(Number(advance) || 0), items: linesToItems(lines) }),
    onSuccess: (c) => {
      toast.success(t('challan.saved', { no: c.challanNo }));
      qc.invalidateQueries({ queryKey: ['challans'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      navigate(`/challans/${c.id}`);
    },
    onError: (e) => toast.error(errorText(e)),
  });

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('challan.new')}
      className="max-w-3xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!customer || linesToItems(lines).length === 0 || save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={t('pos.customer')}>
            <Button variant="outline" className="w-full justify-start" onClick={() => setPicking(true)}>
              <UserRound /> {customer?.name ?? t('pos.chooseCustomer')}
            </Button>
          </Field>
          <Field label={t('challan.site')}>
            <Input value={site} onChange={(e) => setSite(e.target.value)} />
          </Field>
          <Field label={t('challan.advance')}>
            <Input type="number" step="any" min="0" className="num" value={advance} onChange={(e) => setAdvance(e.target.value)} />
          </Field>
        </div>
        <ChallanLines lines={lines} onChange={setLines} />
      </div>
      {picking && <CustomerPicker onClose={() => setPicking(false)} onPick={(c) => (setCustomer(c), setPicking(false))} />}
    </Sheet>
  );
}
