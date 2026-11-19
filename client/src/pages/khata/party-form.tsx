import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useI18n } from '@/i18n';
import { useCan } from '@/hooks/use-auth';
import { PRICE_TIERS } from '@/lib/pricing';
import { toPaisa, toRupees } from '@shared/money';
import type { PartyType } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Field } from '@/components/ui/misc';

const schema = z.object({
  name: z.string().trim().min(1),
  phone: z.string(),
  address: z.string(),
  company: z.string(),
  priceTier: z.enum(['retail', 'plumber', 'wholesale']),
  creditLimit: z.coerce.number().min(0),
  openingBalance: z.coerce.number(),
  commissionPct: z.coerce.number().min(0).max(50),
});
type FormValues = z.infer<typeof schema>;

export interface PartyRecord {
  id: number;
  name: string;
  phone: string;
  address?: string;
  company?: string;
  priceTier?: 'retail' | 'plumber' | 'wholesale';
  creditLimit?: number;
  openingBalance?: number;
  commissionPct?: number;
}

/** Add/edit form for a customer, supplier or plumber (fields depend on the type). */
export function PartyForm({ type, party, onSaved }: { type: PartyType; party: PartyRecord | null; onSaved: (p: PartyRecord) => void }) {
  const { t, errorText } = useI18n();
  const can = useCan();
  const qc = useQueryClient();
  const isAdmin = can('party.manage');
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: party?.name ?? '',
      phone: party?.phone ?? '',
      address: party?.address ?? '',
      company: party?.company ?? '',
      priceTier: party?.priceTier ?? 'retail',
      creditLimit: toRupees(party?.creditLimit ?? 0),
      openingBalance: toRupees(party?.openingBalance ?? 0),
      commissionPct: party?.commissionPct ?? 0,
    },
  });
  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const body =
        type === 'customer'
          ? { name: v.name, phone: v.phone, address: v.address, priceTier: v.priceTier, creditLimit: toPaisa(v.creditLimit), openingBalance: toPaisa(v.openingBalance) }
          : type === 'supplier'
            ? { name: v.name, phone: v.phone, company: v.company, openingBalance: toPaisa(v.openingBalance) }
            : { name: v.name, phone: v.phone, commissionPct: v.commissionPct };
      return party ? api<PartyRecord>(`/${type}s/${party.id}`, 'PUT', body) : api<PartyRecord>(`/${type}s`, 'POST', body);
    },
    onSuccess: (p) => {
      toast.success(t('common.saved'));
      qc.invalidateQueries({ queryKey: [`${type}s`] });
      qc.invalidateQueries({ queryKey: ['ledger'] });
      onSaved(p);
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const err = form.formState.errors;

  return (
    <form className="grid grid-cols-2 gap-4" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
      <Field label={t('common.name')} error={err.name?.message} className="col-span-2">
        <Input autoFocus={!party} {...form.register('name')} />
      </Field>
      <Field label={t('common.phone')}>
        <Input inputMode="tel" className="num" {...form.register('phone')} />
      </Field>
      {type === 'customer' && (
        <>
          <Field label={t('khata.tier')}>
            <NativeSelect {...form.register('priceTier')}>
              {PRICE_TIERS.map((tier) => (
                <option key={tier} value={tier}>
                  {t(`tier.${tier}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t('common.address')} className="col-span-2">
            <Input {...form.register('address')} />
          </Field>
          {isAdmin && (
            <Field label={t('khata.creditLimit')}>
              <Input type="number" step="any" className="num" {...form.register('creditLimit')} />
            </Field>
          )}
        </>
      )}
      {type === 'supplier' && (
        <Field label={t('khata.company')}>
          <Input {...form.register('company')} />
        </Field>
      )}
      {type === 'plumber' && (
        <Field label={t('khata.commission')} error={err.commissionPct?.message}>
          <Input type="number" step="0.5" className="num" {...form.register('commissionPct')} />
        </Field>
      )}
      {type !== 'plumber' && isAdmin && (
        <Field label={`${t('khata.openingBalance')} — ${type === 'customer' ? t('khata.openingHintCustomer') : t('khata.openingHintSupplier')}`} className="col-span-2">
          <Input type="number" step="any" className="num" {...form.register('openingBalance')} />
        </Field>
      )}
      <div className="col-span-2">
        <Button type="submit" size="lg" disabled={save.isPending}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}
