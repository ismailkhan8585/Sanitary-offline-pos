import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useI18n, useLocalName } from '@/i18n';
import { useCategories } from '@/hooks/use-products';
import type { Product } from '@/lib/types';
import { formatQty, toPaisa, toRupees } from '@shared/money';
import { BASE_UNITS, PACK_UNITS } from '@shared/units';
import { formatDateTime } from '@/lib/utils';
import type { TranslationKey } from '@/i18n/en';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Field, Switch } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StockBadge } from '@/components/stock-badge';

const num = z.coerce.number().min(0);
const schema = z.object({
  code: z.string().trim().min(1),
  barcode: z.string().trim(),
  nameEn: z.string().trim().min(1),
  nameUr: z.string().trim(),
  aliases: z.string(),
  categoryId: z.string(),
  brand: z.string(),
  size: z.string(),
  color: z.string(),
  unit: z.string().min(1),
  packUnit: z.string(),
  packQty: z.coerce.number().positive(),
  costPrice: num,
  retailPrice: num,
  plumberPrice: num,
  wholesalePrice: num,
  minStock: num,
  openingStock: num,
  active: z.boolean(),
});
type FormValues = z.infer<typeof schema>;

function defaults(p: Product | null): FormValues {
  if (!p) {
    return {
      code: '', barcode: '', nameEn: '', nameUr: '', aliases: '', categoryId: '', brand: '', size: '', color: '',
      unit: 'piece', packUnit: '', packQty: 1, costPrice: 0, retailPrice: 0, plumberPrice: 0, wholesalePrice: 0,
      minStock: 0, openingStock: 0, active: true,
    };
  }
  return {
    ...p,
    barcode: p.barcode ?? '',
    categoryId: p.categoryId ? String(p.categoryId) : '',
    packUnit: p.packUnit ?? '',
    costPrice: toRupees(p.costPrice ?? 0),
    retailPrice: toRupees(p.retailPrice),
    plumberPrice: toRupees(p.plumberPrice),
    wholesalePrice: toRupees(p.wholesalePrice),
    openingStock: 0,
  };
}

export function ProductForm({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const { t, errorText, unitLabel } = useI18n();
  const name = useLocalName();
  const qc = useQueryClient();
  const categories = useCategories();
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults(product) });
  const unit = form.watch('unit');
  const packUnit = form.watch('packUnit');

  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const body = {
        ...v,
        barcode: v.barcode || null,
        packUnit: v.packUnit || null,
        packQty: v.packUnit ? v.packQty : 1,
        categoryId: v.categoryId ? Number(v.categoryId) : null,
        costPrice: toPaisa(v.costPrice),
        retailPrice: toPaisa(v.retailPrice),
        plumberPrice: toPaisa(v.plumberPrice),
        wholesalePrice: toPaisa(v.wholesalePrice),
      };
      if (product) {
        const { openingStock: _unused, ...update } = body;
        return api(`/products/${product.id}`, 'PUT', update);
      }
      return api('/products', 'POST', body);
    },
    onSuccess: () => {
      toast.success(t('common.saved'));
      qc.invalidateQueries({ queryKey: ['products'] });
      onClose();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const err = form.formState.errors;

  const details = (
    <form className="grid grid-cols-2 gap-4" onSubmit={(e) => e.preventDefault()}>
      <Field label={t('products.code')} error={err.code?.message}>
        <Input autoFocus={!product} className="num" {...form.register('code')} />
      </Field>
      <Field label={t('products.barcode')}>
        <Input className="num" {...form.register('barcode')} />
      </Field>
      <Field label={t('products.nameEn')} error={err.nameEn?.message} className="col-span-2">
        <Input {...form.register('nameEn')} />
      </Field>
      <Field label={t('products.nameUr')} className="col-span-2">
        <Input dir="rtl" className="font-urdu" {...form.register('nameUr')} />
      </Field>
      <Field label={`${t('products.aliases')} — ${t('products.aliasesHint')}`} className="col-span-2">
        <Input {...form.register('aliases')} />
      </Field>
      <Field label={t('products.category')}>
        <NativeSelect {...form.register('categoryId')}>
          <option value="">—</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {name(c)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label={t('products.brand')}>
        <Input {...form.register('brand')} />
      </Field>
      <Field label={t('products.size')}>
        <Input {...form.register('size')} />
      </Field>
      <Field label={t('products.color')}>
        <Input {...form.register('color')} />
      </Field>
      <Field label={t('products.unit')}>
        <NativeSelect {...form.register('unit')}>
          {BASE_UNITS.map((u) => (
            <option key={u} value={u}>
              {unitLabel(u)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label={t('products.packUnit')}>
        <NativeSelect {...form.register('packUnit')}>
          <option value="">{t('products.noPack')}</option>
          {PACK_UNITS.map((u) => (
            <option key={u} value={u}>
              {unitLabel(u)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {packUnit && (
        <Field label={`${t('products.packQty')} (1 ${unitLabel(packUnit)} = ? ${unitLabel(unit)})`} error={err.packQty?.message} className="col-span-2">
          <Input type="number" step="any" className="num" {...form.register('packQty')} />
        </Field>
      )}
      <p className="col-span-2 rounded-md bg-accent/10 px-3 py-2 text-sm">{t('products.pricePerUnit', { unit: unitLabel(unit) })}</p>
      {(['costPrice', 'retailPrice', 'plumberPrice', 'wholesalePrice'] as const).map((f) => (
        <Field key={f} label={`${t(`products.${f}` as TranslationKey)} (Rs)`}>
          <Input type="number" step="any" className="num" {...form.register(f)} />
        </Field>
      ))}
      <Field label={`${t('products.minStock')} (${unitLabel(unit)})`}>
        <Input type="number" step="any" className="num" {...form.register('minStock')} />
      </Field>
      {!product && (
        <Field label={`${t('products.openingStock')} (${unitLabel(unit)})`}>
          <Input type="number" step="any" className="num" {...form.register('openingStock')} />
        </Field>
      )}
      <label className="col-span-2 flex items-center gap-3">
        <Switch checked={form.watch('active')} onCheckedChange={(v) => form.setValue('active', v)} />
        {t('common.active')}
      </label>
    </form>
  );

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={product ? t('products.edit') : t('products.add')}
      className="max-w-2xl"
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
      {product ? (
        <Tabs defaultValue="details">
          <TabsList>
            <TabsTrigger value="details">{t('products.details')}</TabsTrigger>
            <TabsTrigger value="stock">{t('products.history')}</TabsTrigger>
          </TabsList>
          <TabsContent value="details">{details}</TabsContent>
          <TabsContent value="stock">
            <StockTab product={product} />
          </TabsContent>
        </Tabs>
      ) : (
        details
      )}
    </Sheet>
  );
}

interface MovementRow {
  id: number;
  qty: number;
  type: string;
  createdAt: number;
  userName: string | null;
}

function StockTab({ product }: { product: Product }) {
  const { t, errorText, unitLabel } = useI18n();
  const qc = useQueryClient();
  const [qty, setQty] = useState('');
  const movements = useQuery({
    queryKey: ['movements', product.id],
    queryFn: () => api<MovementRow[]>(`/products/${product.id}/movements`),
  });
  const damage = useMutation({
    mutationFn: () => api<{ stock: number }>('/stock/damage', 'POST', { productId: product.id, qty: Number(qty) }),
    onSuccess: (r) => {
      toast.success(t('products.damageSaved', { qty: formatQty(r.stock) }));
      setQty('');
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['movements', product.id] });
    },
    onError: (e) => toast.error(errorText(e)),
  });

  return (
    <div className="space-y-4">
      <StockBadge qty={product.stock} minStock={product.minStock} unit={product.unit} className="text-base" />
      <div className="flex items-end gap-2 rounded-lg border border-border p-3">
        <Field label={`${t('products.damageQty')} (${unitLabel(product.unit)})`} className="flex-1">
          <Input type="number" step="any" className="num" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Button variant="destructive" disabled={!(Number(qty) > 0) || damage.isPending} onClick={() => damage.mutate()}>
          {t('products.damage')}
        </Button>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {movements.data?.map((m) => (
            <tr key={m.id} className="border-t border-border">
              <td className="py-2">{formatDateTime(m.createdAt)}</td>
              <td>{t(`mvt.${m.type}` as TranslationKey)}</td>
              <td className={m.qty < 0 ? 'num text-danger' : 'num text-success'}>
                {m.qty > 0 ? '+' : ''}
                {formatQty(m.qty)}
              </td>
              <td className="text-muted">{m.userName}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
