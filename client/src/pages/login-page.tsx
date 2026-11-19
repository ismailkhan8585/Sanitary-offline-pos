import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, MonitorSmartphone, ShieldCheck, UserRound } from 'lucide-react';
import { api } from '@/lib/api';
import { setDeviceId, setSession, useDeviceId, type Session } from '@/lib/session';
import { useI18n } from '@/i18n';
import { usePublicSettings } from '@/hooks/use-auth';
import { PinPad } from '@/components/pin-pad';
import { Button } from '@/components/ui/button';
import { Card, Skeleton } from '@/components/ui/misc';
import { cn } from '@/lib/utils';
import type { Role } from '@shared/permissions';

interface Device {
  id: number;
  name: string;
  billPrefix: string;
}

export function LoginPage() {
  const { t, lang, setLang } = useI18n();
  const deviceId = useDeviceId();
  const { data: shop } = usePublicSettings();
  const devices = useQuery({ queryKey: ['devices', 'public'], queryFn: () => api<Device[]>('/devices/public') });
  const device = devices.data?.find((d) => d.id === deviceId);
  const [settingUp, setSettingUp] = useState(false);
  const needsSetup = settingUp || (devices.isSuccess && !device);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-4">
      <div className="text-center">
        <img src="/icon.svg" alt="" className="mx-auto mb-3 size-16" />
        <h1 className="text-2xl font-bold">{lang === 'ur' && shop?.shop_name_ur ? shop.shop_name_ur : shop?.shop_name_en}</h1>
        {device && !needsSetup && (
          <button className="mt-1 text-sm text-muted underline" onClick={() => setSettingUp(true)}>
            {device.name} ({device.billPrefix}) · {t('device.change')}
          </button>
        )}
      </div>
      <Card className="w-full max-w-md p-6">
        {devices.isLoading ? (
          <Skeleton className="h-64" />
        ) : needsSetup ? (
          <DeviceSetup devices={devices.data ?? []} onDone={() => setSettingUp(false)} />
        ) : (
          <UserLogin deviceId={deviceId} />
        )}
      </Card>
      <Button variant="ghost" onClick={() => setLang(lang === 'en' ? 'ur' : 'en')}>
        {lang === 'en' ? 'اردو' : 'English'}
      </Button>
    </div>
  );
}

function UserLogin({ deviceId }: { deviceId: number | null }) {
  const { t, errorText } = useI18n();
  const users = useQuery({ queryKey: ['auth', 'users'], queryFn: () => api<{ id: number; name: string; role: Role }[]>('/auth/users') });
  const [userId, setUserId] = useState<number | null>(null);
  const [pin, setPin] = useState('');
  const user = users.data?.find((u) => u.id === userId);
  const login = useMutation({
    mutationFn: () => api<Session>('/auth/login', 'POST', { userId, pin, deviceId }),
    onSuccess: (s) => setSession(s),
    onError: (e) => {
      setPin('');
      toast.error(errorText(e));
    },
  });

  if (!user) {
    return (
      <div className="space-y-4">
        <h2 className="text-center text-xl font-bold">{t('login.title')}</h2>
        {users.isLoading && <Skeleton className="h-40" />}
        <div className="grid grid-cols-2 gap-3">
          {users.data?.map((u) => (
            <button
              key={u.id}
              onClick={() => setUserId(u.id)}
              className="flex flex-col items-center gap-2 rounded-lg border border-border p-4 hover:border-primary hover:bg-primary/5"
            >
              <span className={cn('flex size-14 items-center justify-center rounded-full', u.role === 'admin' ? 'bg-accent/20' : 'bg-primary/10')}>
                {u.role === 'admin' ? <ShieldCheck className="size-7 text-amber-700" /> : <UserRound className="size-7 text-primary" />}
              </span>
              <span className="font-semibold">{u.name}</span>
              <span className="text-xs text-muted">{t(`role.${u.role}`)}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => (setUserId(null), setPin(''))} aria-label={t('login.changeUser')}>
          <ArrowLeft className="rtl-flip" />
        </Button>
        <h2 className="text-xl font-bold">{t('login.enterPin', { name: user.name })}</h2>
      </div>
      <PinPad value={pin} onChange={setPin} onSubmit={() => login.mutate()} disabled={login.isPending} />
      <Button size="lg" className="w-full" disabled={pin.length < 4 || login.isPending} onClick={() => login.mutate()}>
        {t('login.button')}
      </Button>
    </div>
  );
}

function DeviceSetup({ devices, onDone }: { devices: Device[]; onDone: () => void }) {
  const { t, errorText } = useI18n();
  const [selected, setSelected] = useState<Device | null>(null);
  const [pin, setPin] = useState('');
  const verify = useMutation({
    mutationFn: () => api('/auth/verify-admin', 'POST', { pin }),
    onSuccess: () => {
      if (!selected) return;
      setDeviceId(selected.id);
      toast.success(t('device.done', { name: selected.name }));
      onDone();
    },
    onError: (e) => {
      setPin('');
      toast.error(errorText(e));
    },
  });

  return (
    <div className="space-y-4">
      <h2 className="flex items-center gap-2 text-xl font-bold">
        <MonitorSmartphone className="text-primary" />
        {t('device.title')}
      </h2>
      <p className="text-muted">{t('device.pick')}</p>
      <div className="grid grid-cols-2 gap-2">
        {devices.map((d) => (
          <button
            key={d.id}
            onClick={() => setSelected(d)}
            className={cn('h-14 rounded-lg border-2 font-semibold', selected?.id === d.id ? 'border-primary bg-primary/10' : 'border-border')}
          >
            {d.name} <span className="num">({d.billPrefix})</span>
          </button>
        ))}
      </div>
      {selected && (
        <>
          <p className="font-medium">{t('device.adminPin')}</p>
          <PinPad value={pin} onChange={setPin} onSubmit={() => verify.mutate()} disabled={verify.isPending} />
          <Button size="lg" className="w-full" disabled={pin.length < 4 || verify.isPending} onClick={() => verify.mutate()}>
            {t('device.confirm')}
          </Button>
        </>
      )}
    </div>
  );
}
