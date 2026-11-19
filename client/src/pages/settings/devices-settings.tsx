import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { MonitorSmartphone, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/i18n';
import { formatDateTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, EmptyState, Field, Switch } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/dialog';
import { DataTable } from '@/components/ui/data-table';

interface Device {
  id: number;
  name: string;
  billPrefix: string;
  lastSeen: number | null;
  active: boolean;
}

const schema = z.object({
  name: z.string().trim().min(1),
  billPrefix: z.string().regex(/^[A-Z]$/, 'A–Z'),
  active: z.boolean(),
});
type FormValues = z.infer<typeof schema>;

export function DevicesSettings() {
  const { t } = useI18n();
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api<Device[]>('/devices') });
  const [editing, setEditing] = useState<Device | 'new' | null>(null);

  const columns: ColumnDef<Device>[] = [
    { accessorKey: 'name', header: t('common.name'), cell: (c) => <span className="font-semibold">{c.row.original.name}</span> },
    { accessorKey: 'billPrefix', header: t('devices.prefix'), cell: (c) => <Badge tone="accent" className="num text-sm">{c.row.original.billPrefix}-00001</Badge> },
    {
      accessorKey: 'lastSeen',
      header: t('devices.lastSeen'),
      cell: (c) => (c.row.original.lastSeen ? formatDateTime(c.row.original.lastSeen) : t('devices.never')),
    },
    {
      accessorKey: 'active',
      header: t('common.active'),
      cell: (c) => <Badge tone={c.row.original.active ? 'success' : 'neutral'}>{c.row.original.active ? t('common.active') : t('common.inactive')}</Badge>,
    },
  ];

  return (
    <>
      <DataTable
        data={devices.data}
        loading={devices.isLoading}
        columns={columns}
        onRowClick={setEditing}
        toolbar={
          <Button onClick={() => setEditing('new')}>
            <Plus /> {t('devices.add')}
          </Button>
        }
        empty={<EmptyState icon={<MonitorSmartphone />} title={t('common.empty')} />}
      />
      {editing && <DeviceForm device={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function DeviceForm({ device, onClose }: { device: Device | null; onClose: () => void }) {
  const { t, errorText } = useI18n();
  const qc = useQueryClient();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: device ?? { name: '', billPrefix: '', active: true },
  });
  const save = useMutation({
    mutationFn: (v: FormValues) => (device ? api(`/devices/${device.id}`, 'PUT', v) : api('/devices', 'POST', v)),
    onSuccess: () => {
      toast.success(t('common.saved'));
      qc.invalidateQueries({ queryKey: ['devices'] });
      onClose();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const err = form.formState.errors;

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={device ? t('devices.edit') : t('devices.add')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={form.handleSubmit((v) => save.mutate(v))} disabled={save.isPending}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
        <Field label={t('common.name')} error={err.name?.message}>
          <Input autoFocus {...form.register('name')} />
        </Field>
        <Field label={t('devices.prefix')} error={err.billPrefix?.message}>
          <Input maxLength={1} className="num uppercase" {...form.register('billPrefix', { setValueAs: (v: string) => v.toUpperCase() })} />
        </Field>
        <label className="flex items-center gap-3">
          <Switch checked={form.watch('active')} onCheckedChange={(v) => form.setValue('active', v)} />
          {t('common.active')}
        </label>
      </form>
    </Sheet>
  );
}
