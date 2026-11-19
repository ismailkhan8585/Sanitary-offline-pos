import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Printer, Server } from 'lucide-react';
import { useI18n } from '@/i18n';
import { usePublicSettings } from '@/hooks/use-auth';
import { printHtml } from '@/lib/print';
import { escapeHtml } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { Card, Field } from '@/components/ui/misc';

/** Settings stored on this counter PC (Electron app only). */
export function CounterSettings() {
  const { t, errorText } = useI18n();
  const { data: shop } = usePublicSettings();
  const desktop = window.posDesktop!;
  const [printers, setPrinters] = useState<{ name: string; isDefault: boolean }[]>([]);
  const [printer, setPrinter] = useState('');
  const [server, setServer] = useState('');

  useEffect(() => {
    desktop.getPrinters().then(setPrinters);
    desktop.getConfig().then((c) => (setPrinter(c.printerName), setServer(c.serverUrl)));
  }, [desktop]);

  const save = async (name: string) => {
    setPrinter(name);
    await desktop.setPrinter(name);
    toast.success(t('common.saved'));
  };
  const testPrint = async () => {
    try {
      const name = escapeHtml(shop?.shop_name_en ?? '');
      await printHtml(`<!doctype html><html><body style="font:14px Arial;padding:4mm"><b>${name}</b><br>${escapeHtml(t('desktop.testPage'))}<br>${new Date().toLocaleString()}</body></html>`, shop?.receipt_width ?? '80');
      toast.success(t('desktop.printed'));
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  return (
    <Card className="space-y-5 p-5">
      <Field label={t('desktop.printer')}>
        <div className="flex gap-2">
          <NativeSelect value={printer} onChange={(e) => save(e.target.value)}>
            <option value="">{t('desktop.defaultPrinter')}</option>
            {printers.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
                {p.isDefault ? ' ✓' : ''}
              </option>
            ))}
          </NativeSelect>
          <Button variant="outline" onClick={testPrint}>
            <Printer /> {t('desktop.testPrint')}
          </Button>
        </div>
      </Field>
      <Field label={t('desktop.server')}>
        <div className="flex gap-2">
          <span className="num flex h-11 flex-1 items-center rounded-md bg-surface-2 px-3">{server}</span>
          <Button variant="outline" onClick={() => desktop.changeServer()}>
            <Server /> {t('desktop.changeServer')}
          </Button>
        </div>
      </Field>
    </Card>
  );
}
