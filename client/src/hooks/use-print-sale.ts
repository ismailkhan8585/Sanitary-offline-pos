import { toast } from 'sonner';
import { useI18n } from '@/i18n';
import { usePublicSettings } from './use-auth';
import { receiptDocument } from '@/components/receipt';
import { printHtml } from '@/lib/print';
import type { SaleDetail } from '@/lib/types';

/** Returns a function that prints a bill in the current language on this counter's printer. */
export function usePrintSale() {
  const { lang, errorText } = useI18n();
  const { data: shop } = usePublicSettings();
  return async (sale: SaleDetail, change?: number) => {
    if (!shop) return;
    try {
      await printHtml(receiptDocument({ sale, shop, lang, change }), shop.receipt_width);
    } catch (e) {
      toast.error(errorText(e));
    }
  };
}
