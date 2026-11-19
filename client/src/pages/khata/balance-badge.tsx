import { ArrowDownLeft, ArrowUpRight, Check } from 'lucide-react';
import { useI18n } from '@/i18n';
import { formatMoney } from '@shared/money';
import type { PartyType } from '@/lib/types';
import { Badge } from '@/components/ui/misc';

/**
 * Positive balance: customer owes the shop / the shop owes a supplier or plumber.
 * Shown with words and an arrow, not colour alone.
 */
export function BalanceBadge({ type, balance }: { type: PartyType; balance: number }) {
  const { t } = useI18n();
  if (balance === 0) {
    return (
      <Badge tone="success">
        <Check /> {t('khata.settled')}
      </Badge>
    );
  }
  const owedToShop = type === 'customer' ? balance > 0 : balance < 0;
  const label = type === 'customer' ? (balance > 0 ? t('khata.receivable') : t('khata.advance')) : balance > 0 ? t('khata.payable') : t('khata.receivable');
  return (
    <Badge tone={owedToShop ? 'warning' : 'primary'} className="text-sm">
      {owedToShop ? <ArrowDownLeft /> : <ArrowUpRight />}
      <span className="num">{formatMoney(Math.abs(balance))}</span>
      <span className="font-normal">· {label}</span>
    </Badge>
  );
}
