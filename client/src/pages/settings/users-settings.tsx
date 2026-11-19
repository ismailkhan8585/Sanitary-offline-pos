import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { Plus, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/i18n';
import { formatMoney, toPaisa, toRupees } from '@shared/money';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Badge, EmptyState, Field, Switch } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/dialog';
import { DataTable } from '@/components/ui/data-table';
import type { Role } from '@shared/permissions';

interface User {
  id: number;
  name: string;
  role: Role;
  discountLimitPct: number;
  returnLimit: number;
  expenseLimit: number;
  active: boolean;
}

const schema = z.object({
  name: z.string().trim().min(1),
  role: z.enum(['admin', 'cashier']),
  pin: z.string().regex(/^(\d{4,8})?$/, '4–8 digits'),
  discountLimitPct: z.coerce.number().min(0).max(100),
  returnLimit: z.coerce.number().min(0),
  expenseLimit: z.coerce.number().min(0),
  active: z.boolean(),
});
type FormValues = z.infer<typeof schema>;

export function UsersSettings() {
  const { t } = useI18n();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') });
  const [editing, setEditing] = useState<User | 'new' | null>(null);

  const columns: ColumnDef<User>[] = [
    { accessorKey: 'name', header: t('common.name'), cell: (c) => <span className="font-semibold">{c.row.original.name}</span> },
    { accessorKey: 'role', header: t('users.role'), cell: (c) => <Badge tone={c.row.original.role === 'admin' ? 'accent' : 'primary'}>{t(`role.${c.row.original.role}`)}</Badge> },
    { accessorKey: 'discountLimitPct', header: t('users.discountLimit'), cell: (c) => <span className="num">{c.row.original.discountLimitPct}%</span> },
    { accessorKey: 'returnLimit', header: t('users.returnLimit'), cell: (c) => <span className="num">{formatMoney(c.row.original.returnLimit)}</span> },
    { accessorKey: 'expenseLimit', header: t('users.expenseLimit'), cell: (c) => <span className="num">{formatMoney(c.row.original.expenseLimit)}</span> },
    {
      accessorKey: 'active',
      header: t('common.active'),
      cell: (c) => <Badge tone={c.row.original.active ? 'success' : 'neutral'}>{c.row.original.active ? t('common.active') : t('common.inactive')}</Badge>,
    },
  ];

  return (
    <>
      <DataTable
        data={users.data}
        loading={users.isLoading}
        columns={columns}
        onRowClick={setEditing}
        toolbar={
          <Button onClick={() => setEditing('new')}>
            <Plus /> {t('users.add')}
          </Button>
        }
        empty={<EmptyState icon={<Users />} title={t('common.empty')} />}
      />
      {editing && <UserForm user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function UserForm({ user, onClose }: { user: User | null; onClose: () => void }) {
  const { t, errorText } = useI18n();
  const qc = useQueryClient();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: user
      ? { ...user, pin: '', returnLimit: toRupees(user.returnLimit), expenseLimit: toRupees(user.expenseLimit) }
      : { name: '', role: 'cashier', pin: '', discountLimitPct: 5, returnLimit: 2000, expenseLimit: 1000, active: true },
  });
  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const body = { ...v, returnLimit: toPaisa(v.returnLimit), expenseLimit: toPaisa(v.expenseLimit), pin: v.pin || undefined };
      return user ? api(`/users/${user.id}`, 'PUT', body) : api('/users', 'POST', body);
    },
    onSuccess: () => {
      toast.success(t('common.saved'));
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['auth', 'users'] });
      onClose();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const err = form.formState.errors;

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={user ? t('users.edit') : t('users.add')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={form.handleSubmit((v) => (!user && !v.pin ? form.setError('pin', { message: '4–8 digits' }) : save.mutate(v)))} disabled={save.isPending}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
        <Field label={t('common.name')} error={err.name?.message}>
          <Input autoFocus {...form.register('name')} />
        </Field>
        <Field label={t('users.role')}>
          <NativeSelect {...form.register('role')}>
            <option value="cashier">{t('role.cashier')}</option>
            <option value="admin">{t('role.admin')}</option>
          </NativeSelect>
        </Field>
        <Field label={user ? t('users.pinKeep') : t('users.pin')} error={err.pin?.message}>
          <Input type="password" inputMode="numeric" autoComplete="new-password" className="num" {...form.register('pin')} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('users.discountLimit')} error={err.discountLimitPct?.message}>
            <Input type="number" step="0.5" className="num" {...form.register('discountLimitPct')} />
          </Field>
          <Field label={t('users.returnLimit')} error={err.returnLimit?.message}>
            <Input type="number" className="num" {...form.register('returnLimit')} />
          </Field>
          <Field label={t('users.expenseLimit')} error={err.expenseLimit?.message}>
            <Input type="number" className="num" {...form.register('expenseLimit')} />
          </Field>
        </div>
        <label className="flex items-center gap-3">
          <Switch checked={form.watch('active')} onCheckedChange={(v) => form.setValue('active', v)} />
          {t('common.active')}
        </label>
      </form>
    </Sheet>
  );
}
