import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileText, PauseCircle, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/i18n';
import { formatMoney } from '@shared/money';
import { formatDateTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/dialog';

interface OpenBill {
  id: number;
  billNo: string;
  total: number;
  createdAt: number;
  customerName: string | null;
  status: 'held' | 'quotation';
}

export function OpenBillsSheet({ onOpen, onClose }: { onOpen: (id: number) => void; onClose: () => void }) {
  const { t, errorText } = useI18n();
  const qc = useQueryClient();
  const bills = useQuery({ queryKey: ['sales', 'open'], queryFn: () => api<OpenBill[]>('/sales/open') });
  const discard = useMutation({
    mutationFn: (id: number) => api(`/sales/${id}/discard`, 'POST', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales'] }),
    onError: (e) => toast.error(errorText(e)),
  });

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={t('pos.openBills')}>
      {bills.data?.length === 0 && <EmptyState icon={<PauseCircle />} title={t('pos.noOpenBills')} />}
      <div className="space-y-2">
        {bills.data?.map((b) => (
          <div key={b.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="num font-bold">{b.billNo}</span>
                <Badge tone={b.status === 'held' ? 'warning' : 'primary'}>
                  {b.status === 'held' ? <PauseCircle /> : <FileText />}
                  {t(`bills.status.${b.status}`)}
                </Badge>
              </div>
              <p className="text-sm text-muted">
                {b.customerName ?? t('pos.walkIn')} · {formatDateTime(b.createdAt)}
              </p>
            </div>
            <span className="num font-bold">{formatMoney(b.total)}</span>
            <Button onClick={() => onOpen(b.id)}>{t('pos.open')}</Button>
            <Button variant="ghost" size="icon" aria-label={t('pos.remove')} onClick={() => discard.mutate(b.id)}>
              <Trash2 className="text-danger" />
            </Button>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
