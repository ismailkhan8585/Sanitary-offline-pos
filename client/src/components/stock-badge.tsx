import { CircleAlert, CircleCheck, CircleX } from 'lucide-react';
import { stockLevel } from '@shared/units';
import { formatQty } from '@shared/money';
import { useI18n } from '@/i18n';
import { Badge } from '@/components/ui/misc';

/** Green in stock, orange low, red out — always with an icon and words, not colour alone. */
export function StockBadge({ qty, minStock, unit, className }: { qty: number; minStock: number; unit?: string; className?: string }) {
  const { t, unitLabel } = useI18n();
  const level = stockLevel(qty, minStock);
  const Icon = level === 'out' ? CircleX : level === 'low' ? CircleAlert : CircleCheck;
  const tone = level === 'out' ? 'danger' : level === 'low' ? 'warning' : 'success';
  return (
    <Badge tone={tone} className={className}>
      <Icon />
      {level === 'out' ? (
        t('stock.out')
      ) : (
        <span>
          <span className="num">{formatQty(qty)}</span> {unit && unitLabel(unit)}
        </span>
      )}
      {level === 'low' && <span>· {t('stock.low')}</span>}
    </Badge>
  );
}
