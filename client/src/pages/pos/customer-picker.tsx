import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { UserPlus, UserRound } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/i18n';
import { useCustomers } from '@/hooks/use-parties';
import { PRICE_TIERS, type PriceTier } from '@/lib/pricing';
import type { Customer } from '@/lib/types';
import { normalizeSearch } from '@shared/search';
import { formatMoney } from '@shared/money';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Field } from '@/components/ui/misc';
import { Dialog } from '@/components/ui/dialog';

interface CustomerPickerProps {
  onPick: (c: Customer | null) => void;
  onClose: () => void;
}

export function CustomerPicker({ onPick, onClose }: CustomerPickerProps) {
  const { t, errorText } = useI18n();
  const qc = useQueryClient();
  const customers = useCustomers();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', priceTier: 'retail' as PriceTier });

  const shown = useMemo(() => {
    const nq = normalizeSearch(q);
    const list = customers.data ?? [];
    return (nq ? list.filter((c) => normalizeSearch(`${c.name} ${c.phone}`).includes(nq) || c.phone.includes(q.trim())) : list).slice(0, 50);
  }, [customers.data, q]);

  const create = useMutation({
    mutationFn: () => api<Customer>('/customers', 'POST', form),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      toast.success(t('common.saved'));
      onPick(c);
    },
    onError: (e) => toast.error(errorText(e)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('pos.chooseCustomer')}>
      {adding ? (
        <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), form.name.trim() && create.mutate())}>
          <Field label={t('common.name')}>
            <Input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label={t('common.phone')}>
            <Input inputMode="tel" className="num" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label={t('pos.tier')}>
            <NativeSelect value={form.priceTier} onChange={(e) => setForm({ ...form, priceTier: e.target.value as PriceTier })}>
              {PRICE_TIERS.map((tier) => (
                <option key={tier} value={tier}>
                  {t(`tier.${tier}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setAdding(false)}>
              {t('common.back')}
            </Button>
            <Button type="submit" disabled={!form.name.trim() || create.isPending}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('pos.searchCustomer')} />
            <Button variant="outline" onClick={() => (setAdding(true), setForm({ ...form, name: /\d/.test(q) ? '' : q, phone: /\d/.test(q) ? q : '' }))}>
              <UserPlus /> {t('pos.addCustomer')}
            </Button>
          </div>
          <button onClick={() => onPick(null)} className="flex h-12 w-full items-center gap-3 rounded-md border border-dashed border-border px-3 text-muted hover:bg-surface-2">
            <UserRound className="size-5" /> {t('pos.walkIn')}
          </button>
          <div className="max-h-[50vh] space-y-1 overflow-y-auto">
            {shown.map((c) => (
              <button key={c.id} onClick={() => onPick(c)} className="flex min-h-12 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-start hover:bg-surface-2">
                <span>
                  <span className="font-semibold">{c.name}</span>
                  {c.phone && <span className="num ms-2 text-sm text-muted">{c.phone}</span>}
                </span>
                {c.balance !== undefined && c.balance !== 0 && (
                  <span className={c.balance > 0 ? 'num font-semibold text-warning' : 'num text-success'}>{formatMoney(c.balance)}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </Dialog>
  );
}
