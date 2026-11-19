import { useQuery } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import { CircleAlert, CircleCheck, CircleX, Cloud, HardDrive, Server, Timer, Usb } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/i18n';
import { formatDateTime } from '@/lib/utils';
import { cn } from '@/lib/utils';

export interface BackupHealth {
  backupDir: string;
  passwordSet: boolean;
  hourly: { last: number | null; ok: boolean };
  daily: { last: number | null };
  replica: { configured: boolean; mode: string; last: number | null; ok: boolean };
  usbDisk: { connected: boolean; last: number | null; ok: boolean };
  takeHome: { usb1: number | null; usb2: number | null; last: number | null; ok: boolean };
  cloud: { configured: boolean; last: number | null };
  lastError: string | null;
}

export function useBackupHealth(enabled = true) {
  return useQuery({ queryKey: ['backup', 'health'], queryFn: () => api<BackupHealth>('/backup/health'), refetchInterval: 60_000, enabled });
}

type State = 'ok' | 'warn' | 'bad' | 'off';

function Item({ icon: Icon, label, state, detail }: { icon: LucideIcon; label: string; state: State; detail: string }) {
  const { t } = useI18n();
  const StateIcon = state === 'ok' ? CircleCheck : state === 'bad' ? CircleX : CircleAlert;
  const tone = state === 'ok' ? 'text-success' : state === 'bad' ? 'text-danger' : state === 'warn' ? 'text-warning' : 'text-muted';
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border p-3">
      <Icon className="mt-0.5 size-5 shrink-0 text-muted" />
      <div className="min-w-0">
        <p className="font-semibold">{label}</p>
        <p className={cn('flex items-center gap-1 text-sm font-semibold', tone)}>
          <StateIcon className="size-4" />
          {state === 'ok' ? t('backup.ok') : state === 'off' ? t('backup.notSet') : t('backup.late')}
        </p>
        <p className="text-xs text-muted">{detail}</p>
      </div>
    </div>
  );
}

/** Five tiles: hourly, live replica, USB disk, take-home USB (red after 7 days), cloud. */
export function BackupHealthGrid({ h }: { h: BackupHealth }) {
  const { t } = useI18n();
  const when = (ms: number | null) => (ms ? formatDateTime(ms) : t('backup.never'));
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Item icon={Timer} label={t('backup.hourly')} state={h.hourly.ok ? 'ok' : 'bad'} detail={when(h.hourly.last)} />
      <Item icon={Server} label={t('backup.replica')} state={!h.replica.configured ? 'off' : h.replica.ok ? 'ok' : 'bad'} detail={when(h.replica.last)} />
      <Item
        icon={HardDrive}
        label={t('backup.usbDisk')}
        state={h.usbDisk.ok ? 'ok' : h.usbDisk.connected ? 'warn' : 'bad'}
        detail={`${h.usbDisk.connected ? t('backup.connected') : t('backup.notConnected')} · ${when(h.usbDisk.last)}`}
      />
      <Item icon={Usb} label={t('backup.takeHome')} state={h.takeHome.ok ? 'ok' : 'bad'} detail={when(h.takeHome.last)} />
      <Item icon={Cloud} label={t('backup.cloud')} state={!h.cloud.configured ? 'off' : h.cloud.last ? 'ok' : 'warn'} detail={when(h.cloud.last)} />
    </div>
  );
}
