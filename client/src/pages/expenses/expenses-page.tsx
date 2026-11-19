import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { Plus, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/i18n';
import { formatMoney, toPaisa } from '@shared/money';
import { cn, formatDateTime, isoDay } from '@/lib/utils';
import { PAYMENT_METHODS, type PaymentMethod } from '@/lib/types';
import { useWithApproval } from '@/components/approval';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState, Field, PageHeader } from '@/components/ui/misc';
import { Dialog } from '@/components/ui/dialog';
import { DataTable } from '@/components/ui/data-table';
import { dayMs } from '@/pages/bills/bills-page';

interface ExpenseRow {
  id: number;
  category: string;
  amount: number;
  method: PaymentMethod;
  note: string;
  createdAt: number;
  userName: string | null;
}

export function ExpensesPage() {
  const { t } = useI18n();
  const [from, setFrom] = useState(isoDay());
  const [to, setTo] = useState(isoDay());
  const [adding, setAdding] = useState(false);
  const list = useQuery({ queryKey: ['expenses', from, to], queryFn: () => api<ExpenseRow[]>(`/expenses?from=${dayMs(from)}&to=${dayMs(to, true)}`) });
  const total = (list.data ?? []).reduce((s, e) => s + e.amount, 0);

  const columns: ColumnDef<ExpenseRow>[] = [
    { accessorKey: 'createdAt', header: t('common.date'), cell: (c) => formatDateTime(c.row.original.createdAt) },
    { accessorKey: 'category', header: t('expense.category'), cell: (c) => <span className="font-semibold">{c.row.original.category}</span> },
    { accessorKey: 'amount', header: t('common.amount'), cell: (c) => <span className="num font-semibold">{formatMoney(c.row.original.amount)}</span> },
    { accessorKey: 'method', header: t('khata.method'), cell: (c) => t(`method.${c.row.original.method}`) },
    { accessorKey: 'note', header: t('common.note') },
    { accessorKey: 'userName', header: t('activity.user') },
  ];

  return (
    <div>
      <PageHeader
        title={t('expense.title')}
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus /> {t('expense.add')}
          </Button>
        }
      />
      <DataTable
        data={list.data}
        loading={list.isLoading}
        columns={columns}
        searchable
        toolbar={
          <>
            <Input type="date" className="num w-44" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input type="date" className="num w-44" value={to} onChange={(e) => setTo(e.target.value)} />
            <span className="num rounded-md bg-surface-2 px-3 py-2 font-semibold">
              {t('expense.total')}: {formatMoney(total)}
            </span>
          </>
        }
        empty={<EmptyState icon={<Wallet />} title={t('expense.empty')} />}
      />
      {adding && <AddExpense onClose={() => setAdding(false)} />}
    </div>
  );
}

function AddExpense({ onClose }: { onClose: () => void }) {
  const { t, errorText } = useI18n();
  const qc = useQueryClient();
  const withApproval = useWithApproval();
  const categories = useQuery({ queryKey: ['expenses', 'categories'], queryFn: () => api<string[]>('/expenses/categories') });
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [note, setNote] = useState('');
  const paisa = toPaisa(Number(amount) || 0);
  const save = useMutation({
    mutationFn: () => withApproval((adminPin) => api('/expenses', 'POST', { category, amount: paisa, method, note, adminPin })),
    onSuccess: () => {
      toast.success(t('expense.saved'));
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['shift'] });
      onClose();
    },
    onError: (e) => toast.error(errorText(e)),
  });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('expense.add')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!category.trim() || paisa <= 0 || save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('expense.category')}>
          <div className="mb-2 flex flex-wrap gap-2">
            {categories.data?.map((c) => (
              <button key={c} onClick={() => setCategory(c)} className={cn('h-10 rounded-full border px-3 text-sm font-semibold', category === c ? 'border-primary bg-primary text-primary-foreground' : 'border-border')}>
                {c}
              </button>
            ))}
          </div>
          <Input value={category} onChange={(e) => setCategory(e.target.value)} />
        </Field>
        <Field label={`${t('common.amount')} (Rs)`}>
          <Input type="number" step="any" min="0" className="num h-12 text-xl" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2">
          {PAYMENT_METHODS.filter((m) => m !== 'credit').map((m) => (
            <button key={m} onClick={() => setMethod(m)} className={cn('h-11 rounded-md border-2 px-3 font-semibold', method === m ? 'border-primary bg-primary/10 text-primary' : 'border-border')}>
              {t(`method.${m}`)}
            </button>
          ))}
        </div>
        <Field label={t('common.note')}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
