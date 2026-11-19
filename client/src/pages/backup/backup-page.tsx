import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DatabaseBackup, FileDown, FileSpreadsheet, KeyRound, Lock, RefreshCw, RotateCcw, ShieldCheck, Upload, Usb } from 'lucide-react';
import { api, downloadUrl } from '@/lib/api';
import { useI18n } from '@/i18n';
import { formatDateTime } from '@/lib/utils';
import type { TranslationKey } from '@/i18n/en';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, Card, Field, PageHeader, Skeleton } from '@/components/ui/misc';
import { Dialog } from '@/components/ui/dialog';
import { PinPad } from '@/components/pin-pad';
import { BackupHealthGrid, useBackupHealth } from './backup-health';

interface Entry {
  path: string;
  source: string;
  name: string;
  size: number;
  createdAt: number;
  encrypted: boolean;
}

function useAction<T>(fn: () => Promise<T>, onDone: (r: T) => void) {
  const { errorText } = useI18n();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['backup'] });
      onDone(r);
    },
    onError: (e) => toast.error(errorText(e)),
  });
}

export function BackupPage() {
  const { t } = useI18n();
  const health = useBackupHealth();
  const runNow = useAction(() => api<{ usbDisk: boolean }>('/backup/run', 'POST', {}), (r) => toast.success(t(r.usbDisk ? 'backup.doneUsb' : 'backup.done')));
  const takeHome = useAction(() => api<{ usb: number }>('/backup/takehome', 'POST', {}), (r) => toast.success(t('backup.takeHomeDone', { usb: r.usb })));

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title={t('backup.title')}
        actions={
          <>
            <Button variant="outline" asChild>
              <a href={downloadUrl('/reports/closing.pdf')} target="_blank" rel="noreferrer">
                <FileDown /> {t('backup.closingPdf')}
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href={downloadUrl('/exports/monthly.xlsx')} download>
                <FileSpreadsheet /> {t('backup.monthlyExcel')}
              </a>
            </Button>
          </>
        }
      />
      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">{t('backup.health')}</h2>
          <div className="flex gap-2">
            <Button variant="outline" disabled={takeHome.isPending} onClick={() => takeHome.mutate()}>
              <Usb /> {t('backup.copyTakeHome')}
            </Button>
            <Button disabled={runNow.isPending} onClick={() => runNow.mutate()}>
              <DatabaseBackup /> {t('backup.now')}
            </Button>
          </div>
        </div>
        {health.data ? <BackupHealthGrid h={health.data} /> : <Skeleton className="h-24" />}
        {health.data?.lastError && (
          <p className="rounded-md bg-danger/10 p-2 text-sm text-danger">
            {t('backup.lastError')}: {health.data.lastError}
          </p>
        )}
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <PasswordCard set={health.data?.passwordSet ?? false} />
        <DrivesCard />
      </div>
      <PlacesCard />
      <RestoreCard />
    </div>
  );
}

function PasswordCard({ set }: { set: boolean }) {
  const { t } = useI18n();
  const [pw, setPw] = useState('');
  const save = useAction(() => api('/backup/password', 'POST', { password: pw }), () => (setPw(''), toast.success(t('common.saved'))));
  return (
    <Card className="space-y-3 p-5">
      <h2 className="flex items-center gap-2 text-lg font-bold">
        <KeyRound className="text-primary" /> {t('backup.password')}
      </h2>
      <p className="text-sm text-muted">{t('backup.passwordHelp')}</p>
      <Badge tone={set ? 'success' : 'danger'}>{set ? t('backup.passwordSet') : t('backup.passwordMissing')}</Badge>
      <div className="flex gap-2">
        <Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        <Button disabled={pw.length < 8 || save.isPending} onClick={() => save.mutate()}>
          {t('backup.setPassword')}
        </Button>
      </div>
    </Card>
  );
}

function DrivesCard() {
  const { t } = useI18n();
  const drives = useQuery({ queryKey: ['backup', 'drives'], queryFn: () => api<{ root: string; role: string | null }[]>('/backup/drives') });
  const { errorText } = useI18n();
  const qc = useQueryClient();
  const prepare = useMutation({
    mutationFn: (v: { root: string; role: string }) => api('/backup/prepare-usb', 'POST', v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['backup'] });
      toast.success(t('common.saved'));
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const choose = (root: string, role: string) => prepare.mutate({ root, role });

  return (
    <Card className="space-y-3 p-5">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <Usb className="text-primary" /> {t('backup.drives')}
        </h2>
        <Button variant="ghost" size="sm" onClick={() => drives.refetch()}>
          <RefreshCw /> {t('backup.refresh')}
        </Button>
      </div>
      {drives.data?.length === 0 && <p className="text-muted">{t('backup.noDrives')}</p>}
      {drives.data?.map((d) => (
        <div key={d.root} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
          <span className="num w-12 font-bold">{d.root}</span>
          {d.role && <Badge tone="success">{t(`backup.role.${d.role}` as TranslationKey)}</Badge>}
          <div className="ms-auto flex flex-wrap gap-1">
            <Button size="sm" variant="outline" onClick={() => choose(d.root, 'disk')}>
              {t('backup.useAsDisk')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => choose(d.root, 'takehome-1')}>
              {t('backup.useAsTake1')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => choose(d.root, 'takehome-2')}>
              {t('backup.useAsTake2')}
            </Button>
          </div>
        </div>
      ))}
    </Card>
  );
}

function PlacesCard() {
  const { t } = useI18n();
  const settings = useQuery({ queryKey: ['backup', 'settings'], queryFn: () => api<Record<string, string>>('/backup/settings') });
  const [form, setForm] = useState<Record<string, string>>({});
  useEffect(() => {
    if (settings.data) setForm(settings.data);
  }, [settings.data]);
  const save = useAction(() => api('/backup/settings', 'PUT', form), () => toast.success(t('common.saved')));
  const fields: [string, TranslationKey][] = [
    ['backupDir', 'backup.dir'],
    ['replicaPath', 'backup.replicaPath'],
    ['litestreamPath', 'backup.litestreamPath'],
    ['cloudFolder', 'backup.cloudFolder'],
  ];
  return (
    <Card className="space-y-3 p-5">
      <h2 className="text-lg font-bold">{t('backup.settings')}</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {fields.map(([k, label]) => (
          <Field key={k} label={t(label)}>
            <Input className="num" value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
          </Field>
        ))}
      </div>
      <Button disabled={save.isPending} onClick={() => save.mutate()}>
        {t('common.save')}
      </Button>
    </Card>
  );
}

function RestoreCard() {
  const { t, errorText } = useI18n();
  const list = useQuery({ queryKey: ['backup', 'list'], queryFn: () => api<Entry[]>('/backup/list') });
  const [restoring, setRestoring] = useState<Entry | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const upload = useAction(
    () => {
      const fd = new FormData();
      fd.append('file', fileInput.current!.files![0]);
      return api('/backup/upload', 'POST', fd);
    },
    () => toast.success(t('backup.uploaded')),
  );
  const verify = async (e: Entry) => {
    try {
      const r = await api<{ ok: boolean; integrity: string; sales: number; products: number; lastSaleAt: number | null }>('/backup/verify', 'POST', { path: e.path });
      if (r.ok) toast.success(t('backup.verifyOk', { sales: r.sales, products: r.products, last: r.lastSaleAt ? formatDateTime(r.lastSaleAt) : '—' }), { duration: 8000 });
      else toast.error(t('backup.verifyBad', { why: r.integrity }));
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <RotateCcw className="text-primary" /> {t('backup.restoreList')}
        </h2>
        <div className="flex gap-2">
          <input ref={fileInput} type="file" accept=".db,.enc" hidden onChange={() => fileInput.current?.files?.length && upload.mutate()} />
          <Button variant="outline" onClick={() => fileInput.current?.click()}>
            <Upload /> {t('backup.upload')}
          </Button>
          <Button variant="ghost" onClick={() => list.refetch()}>
            <RefreshCw /> {t('backup.refresh')}
          </Button>
        </div>
      </div>
      <div className="max-h-[28rem] overflow-y-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-2 text-muted">
            <tr>
              <th className="px-3 py-2 text-start">{t('common.date')}</th>
              <th className="px-3 py-2 text-start">{t('backup.source')}</th>
              <th className="px-3 py-2 text-start">{t('common.name')}</th>
              <th className="px-3 py-2 text-end">{t('backup.size')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.data?.map((e) => (
              <tr key={e.path} className="border-t border-border">
                <td className="whitespace-nowrap px-3 py-2">{formatDateTime(e.createdAt)}</td>
                <td className="px-3 py-2">
                  <Badge tone="primary">{t(`backup.src.${e.source}` as TranslationKey)}</Badge>
                </td>
                <td className="num px-3 py-2 text-xs text-muted">
                  {e.encrypted && <Lock className="me-1 inline size-3.5" aria-label={t('backup.locked')} />}
                  {e.name}
                </td>
                <td className="num px-3 py-2 text-end">{(e.size / 1_048_576).toFixed(1)} MB</td>
                <td className="whitespace-nowrap px-3 py-1 text-end">
                  <Button size="sm" variant="ghost" onClick={() => verify(e)}>
                    <ShieldCheck /> {t('backup.verify')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setRestoring(e)}>
                    <RotateCcw /> {t('backup.restore')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {restoring && <RestoreDialog entry={restoring} onClose={() => setRestoring(null)} />}
    </Card>
  );
}

function RestoreDialog({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const { t, errorText } = useI18n();
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [waiting, setWaiting] = useState(false);
  const restore = useMutation({
    mutationFn: () => api('/backup/restore', 'POST', { path: entry.path, password: password || undefined, adminPin: pin }),
    onSuccess: () => {
      setWaiting(true);
      // Wait for the server to come back on the restored data, then reload everything.
      const started = Date.now();
      const timer = setInterval(async () => {
        if (Date.now() - started < 4000) return;
        try {
          if ((await fetch('/api/health')).ok) {
            clearInterval(timer);
            location.reload();
          }
        } catch {
          // still restarting
        }
      }, 1500);
    },
    onError: (e) => (setPin(''), toast.error(errorText(e))),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && !waiting && onClose()} title={t('backup.restoreTitle')}>
      {waiting ? (
        <p className="flex items-center gap-3 text-lg font-semibold">
          <RefreshCw className="animate-spin text-primary" /> {t('backup.restoring')}
        </p>
      ) : (
        <div className="space-y-4">
          <p className="num rounded-md bg-surface-2 p-2 text-sm">
            {entry.name} · {formatDateTime(entry.createdAt)}
          </p>
          <p className="rounded-md bg-warning/10 p-3 font-semibold text-warning">{t('backup.restoreWarn')}</p>
          {entry.encrypted && (
            <Field label={t('backup.filePassword')}>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          )}
          <p className="font-semibold">{t('backup.adminPin')}</p>
          <PinPad value={pin} onChange={setPin} onSubmit={() => restore.mutate()} disabled={restore.isPending} />
          <Button variant="destructive" size="lg" className="w-full" disabled={pin.length < 4 || restore.isPending} onClick={() => restore.mutate()}>
            <RotateCcw /> {t('backup.restore')}
          </Button>
        </div>
      )}
    </Dialog>
  );
}
