import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useRealtime } from '@/lib/realtime';
import { useI18n } from '@/i18n';
import { useMe, usePublicSettings } from './use-auth';
import { useProducts } from './use-products';

/**
 * On the Electron counter app: keeps a copy of products on this PC for emergency billing,
 * and uploads bills made while the server was down as soon as the server is reachable.
 */
export function useDesktopSync() {
  const desktop = window.posDesktop;
  const { t, errorText } = useI18n();
  const { connected } = useRealtime();
  const products = useProducts();
  const { data: me } = useMe();
  const { data: shop } = usePublicSettings();
  const last = useQuery({ queryKey: ['emergency', 'last'], queryFn: () => api<{ last: number }>('/emergency/last'), enabled: Boolean(desktop) });
  const uploading = useRef(false);

  useEffect(() => {
    if (!desktop || !products.data || !me?.device || !shop || !last.data) return;
    void desktop.saveCatalog({
      savedAt: Date.now(),
      shop,
      device: me.device,
      user: { id: me.userId, name: me.name },
      lastEmergencyNo: last.data.last,
      products: products.data
        .filter((p) => p.active)
        .map((p) => ({ id: p.id, code: p.code, barcode: p.barcode, nameEn: p.nameEn, nameUr: p.nameUr, aliases: p.aliases, unit: p.unit, retailPrice: p.retailPrice })),
    });
  }, [desktop, products.data, me, shop, last.data]);

  useEffect(() => {
    if (!desktop || !connected || uploading.current) return;
    uploading.current = true;
    (async () => {
      try {
        const bills = await desktop.pendingEmergency();
        if (!bills.length) return;
        const result = await api<{ uploaded: string[]; skipped: string[]; failed: { billNo: string; message: string }[] }>('/emergency/upload', 'POST', {
          bills: bills.map((b) => ({
            billNo: b.billNo,
            createdAt: b.createdAt,
            userId: b.userId,
            billDiscount: b.billDiscount,
            paid: b.paid,
            items: b.items.map((i) => ({ productId: i.productId, qty: i.qty, unit: i.unit, rate: i.rate, discount: 0 })),
          })),
        });
        await desktop.markUploaded([...result.uploaded, ...result.skipped]);
        if (result.uploaded.length) toast.success(t('desktop.uploaded', { count: result.uploaded.length }));
        if (result.failed.length) toast.error(t('desktop.uploadFailed', { bills: result.failed.map((f) => `${f.billNo}: ${f.message}`).join('; ') }), { duration: 30_000 });
      } catch (e) {
        toast.error(errorText(e));
      } finally {
        uploading.current = false;
      }
    })();
  }, [desktop, connected, t, errorText]);
}
