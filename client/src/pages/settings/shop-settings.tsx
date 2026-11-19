import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Card, Field, Skeleton } from '@/components/ui/misc';

type ShopForm = Record<
  | 'shop_name_en'
  | 'shop_name_ur'
  | 'shop_address'
  | 'shop_phone'
  | 'tax_pct'
  | 'receipt_footer_en'
  | 'receipt_footer_ur'
  | 'receipt_width'
  | 'default_language'
  | 'closing_time',
  string
>;

export function ShopSettings() {
  const { t, errorText } = useI18n();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['settings', 'all'], queryFn: () => api<ShopForm>('/settings') });
  const form = useForm<ShopForm>();
  useEffect(() => {
    if (query.data) form.reset(query.data);
  }, [query.data, form]);
  const save = useMutation({
    mutationFn: (values: ShopForm) => api('/settings', 'PUT', values),
    onSuccess: () => {
      toast.success(t('common.saved'));
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (e) => toast.error(errorText(e)),
  });

  if (query.isLoading) return <Skeleton className="h-96" />;
  return (
    <Card className="p-5">
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4 md:grid-cols-2">
        <Field label={t('settings.shopNameEn')}>
          <Input {...form.register('shop_name_en')} />
        </Field>
        <Field label={t('settings.shopNameUr')}>
          <Input dir="rtl" className="font-urdu" {...form.register('shop_name_ur')} />
        </Field>
        <Field label={t('common.address')}>
          <Input {...form.register('shop_address')} />
        </Field>
        <Field label={t('common.phone')}>
          <Input {...form.register('shop_phone')} />
        </Field>
        <Field label={t('settings.taxPct')}>
          <Input inputMode="decimal" className="num" {...form.register('tax_pct')} />
        </Field>
        <Field label={t('settings.receiptWidth')}>
          <NativeSelect {...form.register('receipt_width')}>
            <option value="80">80 mm</option>
            <option value="58">58 mm</option>
            <option value="a4">A4</option>
          </NativeSelect>
        </Field>
        <Field label={t('settings.footerEn')}>
          <Textarea {...form.register('receipt_footer_en')} />
        </Field>
        <Field label={t('settings.footerUr')}>
          <Textarea dir="rtl" className="font-urdu" {...form.register('receipt_footer_ur')} />
        </Field>
        <Field label={t('settings.defaultLanguage')}>
          <NativeSelect {...form.register('default_language')}>
            <option value="en">English</option>
            <option value="ur">اردو</option>
          </NativeSelect>
        </Field>
        <Field label={t('settings.closingTime')}>
          <Input type="time" className="num" {...form.register('closing_time')} />
        </Field>
        <div className="md:col-span-2">
          <Button type="submit" size="lg" disabled={save.isPending}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
