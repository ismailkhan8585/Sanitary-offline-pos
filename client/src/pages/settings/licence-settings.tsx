import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, KeyRound } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Badge, Card, Field, Skeleton } from '@/components/ui/misc';

export interface Licence {
  hardwareId: string;
  status: 'active' | 'trial' | 'expired';
  daysLeft: number | null;
}

export function useLicence() {
  return useQuery({ queryKey: ['licence'], queryFn: () => api<Licence>('/licence'), staleTime: 300_000 });
}

export function LicenceSettings() {
  const { t, errorText } = useI18n();
  const qc = useQueryClient();
  const licence = useLicence();
  const [key, setKey] = useState('');
  const activate = useMutation({
    mutationFn: () => api<Licence>('/licence', 'POST', { key }),
    onSuccess: () => {
      toast.success(t('licence.activated'));
      setKey('');
      qc.invalidateQueries({ queryKey: ['licence'] });
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const l = licence.data;
  if (!l) return <Skeleton className="h-64" />;
  const tone = l.status === 'active' ? 'success' : l.status === 'trial' ? 'warning' : 'danger';

  return (
    <Card className="space-y-5 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={tone} className="text-sm">
          {t(`licence.status.${l.status}`)}
        </Badge>
        <span className="text-muted">{l.daysLeft === null ? t('licence.forever') : t('licence.daysLeft', { days: l.daysLeft })}</span>
      </div>
      <Field label={t('licence.hardwareId')}>
        <div className="flex gap-2">
          <span className="num flex h-11 items-center rounded-md bg-surface-2 px-4 text-xl font-bold tracking-wider">{l.hardwareId}</span>
          <Button variant="outline" onClick={() => navigator.clipboard?.writeText(l.hardwareId).then(() => toast.success(t('common.saved')))}>
            <Copy />
          </Button>
        </div>
        <p className="text-sm text-muted">{t('licence.help')}</p>
      </Field>
      <Field label={t('licence.key')}>
        <Textarea className="num min-h-24 text-xs" value={key} onChange={(e) => setKey(e.target.value)} />
      </Field>
      <Button disabled={key.trim().length < 10 || activate.isPending} onClick={() => activate.mutate()}>
        <KeyRound /> {t('licence.activate')}
      </Button>
    </Card>
  );
}
