import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useI18n } from '@/i18n';
import { useProducts } from '@/hooks/use-products';
import type { TranslationKey } from '@/i18n/en';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Field, Switch } from '@/components/ui/misc';
import { Dialog } from '@/components/ui/dialog';

const FIELDS = ['retailPrice', 'plumberPrice', 'wholesalePrice', 'costPrice'] as const;

export function PriceUpdateDialog({ onClose }: { onClose: () => void }) {
  const { t, errorText } = useI18n();
  const qc = useQueryClient();
  const products = useProducts();
  const brands = useMemo(() => [...new Set((products.data ?? []).map((p) => p.brand).filter(Boolean))].sort(), [products.data]);
  const [brand, setBrand] = useState('');
  const [pct, setPct] = useState('');
  const [fields, setFields] = useState<string[]>(['retailPrice', 'plumberPrice', 'wholesalePrice']);
  const save = useMutation({
    mutationFn: () => api<{ updated: number }>('/products/price-update', 'POST', { brand, pct: Number(pct), fields }),
    onSuccess: (r) => {
      toast.success(t('products.priceUpdated', { count: r.updated }));
      qc.invalidateQueries({ queryKey: ['products'] });
      onClose();
    },
    onError: (e) => toast.error(errorText(e)),
  });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('products.priceUpdateTitle')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!brand || !Number(pct) || fields.length === 0 || save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('products.brand')}>
          <NativeSelect value={brand} onChange={(e) => setBrand(e.target.value)}>
            <option value="">—</option>
            {brands.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t('products.pct')}>
          <Input type="number" step="any" className="num" value={pct} onChange={(e) => setPct(e.target.value)} />
        </Field>
        <Field label={t('products.fields')}>
          <div className="grid grid-cols-2 gap-2">
            {FIELDS.map((f) => (
              <label key={f} className="flex h-11 items-center gap-2">
                <Switch checked={fields.includes(f)} onCheckedChange={(on) => setFields((cur) => (on ? [...cur, f] : cur.filter((x) => x !== f)))} />
                {t(`products.${f}` as TranslationKey)}
              </label>
            ))}
          </div>
        </Field>
      </div>
    </Dialog>
  );
}
