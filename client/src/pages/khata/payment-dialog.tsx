import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useI18n } from '@/i18n';
import { formatMoney, toPaisa } from '@shared/money';
import { PAYMENT_METHODS, type PartyType, type PaymentMethod } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/misc';
import { Dialog } from '@/components/ui/dialog';

interface PaymentDialogProps {
  partyType: PartyType;
  partyId: number;
  name: string;
  direction: 'in' | 'out';
  suggested?: number;
  onClose: () => void;
}

export function PaymentDialog({ partyType, partyId, name, direction, suggested, onClose }: PaymentDialogProps) {
  const { t, errorText } = useI18n();
  const qc = useQueryClient();
  const [amount, setAmount] = useState(suggested && suggested > 0 ? String(suggested / 100) : '');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [note, setNote] = useState('');
  const paisa = toPaisa(Number(amount) || 0);
  const save = useMutation({
    mutationFn: () => api<{ balance: number }>('/payments', 'POST', { partyType, partyId, amount: paisa, method, direction, note }),
    onSuccess: (r) => {
      const msg = direction === 'in' ? 'khata.received' : 'khata.paid';
      toast.success(t(msg, { amount: (paisa / 100).toLocaleString(), balance: formatMoney(r.balance) }));
      qc.invalidateQueries({ queryKey: ['ledger'] });
      qc.invalidateQueries({ queryKey: [`${partyType}s`] });
      onClose();
    },
    onError: (e) => toast.error(errorText(e)),
  });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('khata.payTitle', { name })}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="success" disabled={paisa <= 0 || save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), paisa > 0 && save.mutate())}>
        <Field label={`${t('common.amount')} (Rs)`}>
          <Input autoFocus type="number" step="any" min="0" inputMode="decimal" className="num h-14 text-2xl" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label={t('khata.method')}>
          <div className="grid grid-cols-3 gap-2">
            {PAYMENT_METHODS.filter((m) => m !== 'credit').map((m) => (
              <button
                type="button"
                key={m}
                onClick={() => setMethod(m)}
                className={cn('h-12 rounded-md border-2 font-semibold', method === m ? 'border-primary bg-primary/10 text-primary' : 'border-border')}
              >
                {t(`method.${m}`)}
              </button>
            ))}
          </div>
        </Field>
        <Field label={t('common.note')}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
