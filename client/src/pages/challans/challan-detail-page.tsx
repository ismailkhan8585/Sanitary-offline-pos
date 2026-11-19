import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { toast } from 'sonner';
import { PackagePlus, Printer, ReceiptText, Undo2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n, useLocalName, translate, type Lang } from '@/i18n';
import { usePublicSettings, type PublicSettings } from '@/hooks/use-auth';
import { usePrintSale } from '@/hooks/use-print-sale';
import { formatMoney, formatQty, toPaisa } from '@shared/money';
import { formatDateTime, cn } from '@/lib/utils';
import { printHtml } from '@/lib/print';
import { PAYMENT_METHODS, type PaymentMethod, type SaleDetail } from '@/lib/types';
import { RECEIPT_CSS } from '@/components/receipt';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, Field, PageHeader, Skeleton } from '@/components/ui/misc';
import { Dialog } from '@/components/ui/dialog';
import { ChallanLines, linesToItems, type ChallanLine } from './challan-lines';
import { ChallanStatus } from './challans-page';

interface ChallanItem {
  productId: number;
  nameEn: string;
  nameUr: string;
  unit: string;
  qtyOut: number;
  qtyReturned: number;
  atSite: number;
  rate: number;
  value: number;
}

interface Challan {
  id: number;
  challanNo: string;
  customerName: string;
  customerPhone: string;
  siteName: string;
  advance: number;
  status: 'open' | 'closed';
  createdAt: number;
  finalSaleId: number | null;
  finalBillNo: string | null;
  items: ChallanItem[];
}

export function ChallanDetailPage() {
  const { id } = useParams();
  const { t, lang, unitLabel } = useI18n();
  const name = useLocalName();
  const { data: shop } = usePublicSettings();
  const challan = useQuery({ queryKey: ['challans', id], queryFn: () => api<Challan>(`/challans/${id}`) });
  const [dialog, setDialog] = useState<'add' | 'return' | 'close' | null>(null);
  const c = challan.data;
  if (!c) return <Skeleton className="h-96" />;
  const atSiteValue = c.items.reduce((s, i) => s + i.value, 0);
  const open = c.status === 'open';

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span className="num">{c.challanNo}</span> <ChallanStatus status={c.status} />
          </span>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => shop && printHtml(challanDocument(c, shop, lang), shop.receipt_width)}>
              <Printer /> {t('challan.print')}
            </Button>
            {open && (
              <>
                <Button variant="outline" onClick={() => setDialog('add')}>
                  <PackagePlus /> {t('challan.addGoods')}
                </Button>
                <Button variant="outline" onClick={() => setDialog('return')}>
                  <Undo2 /> {t('challan.returnGoods')}
                </Button>
                <Button variant="success" onClick={() => setDialog('close')}>
                  <ReceiptText /> {t('challan.finalBill')}
                </Button>
              </>
            )}
          </>
        }
      />
      <Card className="flex flex-wrap gap-x-8 gap-y-2 p-4">
        <span>
          <span className="text-muted">{t('pos.customer')}: </span>
          <b>{c.customerName}</b> <span className="num text-muted">{c.customerPhone}</span>
        </span>
        <span>
          <span className="text-muted">{t('challan.site')}: </span>
          <b>{c.siteName || '—'}</b>
        </span>
        <span className="text-muted">{formatDateTime(c.createdAt)}</span>
        <span>
          <span className="text-muted">{t('challan.advance')}: </span>
          <b className="num">{formatMoney(c.advance)}</b>
        </span>
        {c.finalBillNo && (
          <span>
            <span className="text-muted">{t('challan.finalBillNo')}: </span>
            <b className="num">{c.finalBillNo}</b>
          </span>
        )}
      </Card>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-muted">
            <tr>
              <th className="px-3 py-2 text-start">{t('common.name')}</th>
              <th className="px-3 py-2 text-end">{t('challan.out')}</th>
              <th className="px-3 py-2 text-end">{t('challan.back')}</th>
              <th className="px-3 py-2 text-end">{t('challan.atSite')}</th>
              <th className="px-3 py-2 text-end">{t('pos.rate')}</th>
              <th className="px-3 py-2 text-end">{t('challan.value')}</th>
            </tr>
          </thead>
          <tbody>
            {c.items.map((i) => (
              <tr key={i.productId} className="border-t border-border">
                <td className="px-3 py-2 font-semibold">{name(i)}</td>
                <td className="num px-3 py-2 text-end">{formatQty(i.qtyOut)}</td>
                <td className="num px-3 py-2 text-end">{formatQty(i.qtyReturned)}</td>
                <td className="num px-3 py-2 text-end font-bold">
                  {formatQty(i.atSite)} {unitLabel(i.unit)}
                </td>
                <td className="num px-3 py-2 text-end">{formatMoney(i.rate)}</td>
                <td className="num px-3 py-2 text-end font-semibold">{formatMoney(i.value)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border text-base">
              <td colSpan={5} className="px-3 py-2 text-end font-bold">
                {t('challan.value')}
              </td>
              <td className="num px-3 py-2 text-end font-bold">{formatMoney(atSiteValue)}</td>
            </tr>
          </tfoot>
        </table>
      </Card>
      {dialog === 'add' && <AddGoods challan={c} onClose={() => setDialog(null)} />}
      {dialog === 'return' && <ReturnGoods challan={c} onClose={() => setDialog(null)} />}
      {dialog === 'close' && <CloseChallan challan={c} value={atSiteValue} onClose={() => setDialog(null)} />}
    </div>
  );
}

function useChallanMutation(challan: Challan, path: string, onDone: () => void) {
  const { t, errorText } = useI18n();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: object) => api<Challan>(`/challans/${challan.id}/${path}`, 'POST', body),
    onSuccess: () => {
      toast.success(t('common.saved'));
      ['challans', 'products', 'customers', 'ledger', 'sales'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onDone();
    },
    onError: (e) => toast.error(errorText(e)),
  });
}

function AddGoods({ challan, onClose }: { challan: Challan; onClose: () => void }) {
  const { t } = useI18n();
  const [lines, setLines] = useState<ChallanLine[]>([]);
  const save = useChallanMutation(challan, 'items', onClose);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('challan.addGoods')}
      className="max-w-3xl"
      footer={
        <Button disabled={linesToItems(lines).length === 0 || save.isPending} onClick={() => save.mutate({ items: linesToItems(lines) })}>
          {t('common.save')}
        </Button>
      }
    >
      <ChallanLines lines={lines} onChange={setLines} />
    </Dialog>
  );
}

function ReturnGoods({ challan, onClose }: { challan: Challan; onClose: () => void }) {
  const { t, unitLabel } = useI18n();
  const name = useLocalName();
  const [qty, setQty] = useState<Record<number, string>>({});
  const items = challan.items.map((i) => ({ productId: i.productId, qty: Number(qty[i.productId]) || 0 })).filter((i) => i.qty > 0);
  const save = useChallanMutation(challan, 'return', onClose);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('challan.returnGoods')}
      footer={
        <Button disabled={items.length === 0 || save.isPending} onClick={() => save.mutate({ items })}>
          {t('common.save')}
        </Button>
      }
    >
      <div className="space-y-2">
        {challan.items
          .filter((i) => i.atSite > 0)
          .map((i) => (
            <div key={i.productId} className="grid grid-cols-[1fr_8rem] items-center gap-3">
              <div>
                <p className="font-semibold">{name(i)}</p>
                <p className="num text-sm text-muted">
                  {t('challan.atSite')}: {formatQty(i.atSite)} {unitLabel(i.unit)}
                </p>
              </div>
              <Input type="number" step="any" min="0" max={i.atSite} className="num" value={qty[i.productId] ?? ''} onChange={(e) => setQty({ ...qty, [i.productId]: e.target.value })} />
            </div>
          ))}
      </div>
    </Dialog>
  );
}

function CloseChallan({ challan, value, onClose }: { challan: Challan; value: number; onClose: () => void }) {
  const { t, errorText } = useI18n();
  const qc = useQueryClient();
  const printSale = usePrintSale();
  const [discount, setDiscount] = useState('');
  const [paid, setPaid] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const afterDiscount = value - toPaisa(Number(discount) || 0);
  const toPay = Math.max(0, afterDiscount - challan.advance);
  const save = useMutation({
    mutationFn: async () => {
      const closed = await api<Challan>(`/challans/${challan.id}/close`, 'POST', { billDiscount: toPaisa(Number(discount) || 0), paid: toPaisa(Number(paid) || 0), paymentMethod: method });
      return closed.finalSaleId ? api<SaleDetail>(`/sales/${closed.finalSaleId}`) : null;
    },
    onSuccess: (sale) => {
      if (sale) {
        toast.success(t('challan.closed', { billNo: sale.billNo }));
        printSale(sale);
      } else toast.success(t('challan.closedNoBill'));
      ['challans', 'customers', 'ledger', 'sales'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('challan.finalBill')}
      footer={
        <Button variant="success" size="lg" disabled={save.isPending || toPaisa(Number(paid) || 0) > toPay} onClick={() => save.mutate()}>
          <Printer /> {t('pay.saveFull')}
        </Button>
      }
    >
      <div className="space-y-3">
        <p className="flex justify-between text-lg">
          <span>{t('challan.usedValue')}</span>
          <b className="num">{formatMoney(value)}</b>
        </p>
        <Field label={t('pos.billDiscount')}>
          <Input type="number" step="any" min="0" className="num" value={discount} onChange={(e) => setDiscount(e.target.value)} />
        </Field>
        <p className="flex justify-between">
          <span>{t('challan.lessAdvance')}</span>
          <b className="num">− {formatMoney(Math.min(challan.advance, afterDiscount))}</b>
        </p>
        <p className="flex justify-between rounded-md bg-primary/10 p-3 text-xl font-bold">
          <span>{t('pos.toPay')}</span>
          <span className="num">{formatMoney(toPay)}</span>
        </p>
        <Field label={t('pay.paidNow')}>
          <Input type="number" step="any" min="0" className="num h-12 text-lg" value={paid} onChange={(e) => setPaid(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2">
          {PAYMENT_METHODS.filter((m) => m !== 'credit').map((m) => (
            <button key={m} onClick={() => setMethod(m)} className={cn('h-11 rounded-md border-2 px-3 font-semibold', method === m ? 'border-primary bg-primary/10 text-primary' : 'border-border')}>
              {t(`method.${m}`)}
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

/** Delivery note listing what is at the site (same paper as the receipts). */
function challanDocument(c: Challan, shop: PublicSettings, lang: Lang): string {
  const t = (k: Parameters<typeof translate>[1]) => translate(lang, k);
  const body = renderToStaticMarkup(
    <div className={`receipt w-${shop.receipt_width}`} dir={lang === 'ur' ? 'rtl' : 'ltr'}>
      <div className="center">
        <div className="shop">{shop.shop_name_en}</div>
        {shop.shop_name_ur && <div className="shop-ur">{shop.shop_name_ur}</div>}
        {shop.shop_phone && <div className="num">{shop.shop_phone}</div>}
      </div>
      <div className="banner">{t('challan.deliveryNote')}</div>
      <div className="row">
        <span>#</span>
        <b className="num">{c.challanNo}</b>
      </div>
      <div className="row">
        <span>{t('receipt.date')}</span>
        <span className="num">{new Date().toLocaleString('en-PK')}</span>
      </div>
      <div className="row">
        <span>{t('pos.customer')}</span>
        <span>{c.customerName}</span>
      </div>
      <div className="row">
        <span>{t('challan.site')}</span>
        <span>{c.siteName}</span>
      </div>
      <div className="rule" />
      <table>
        <thead>
          <tr>
            <th className="start">{t('receipt.item')}</th>
            <th>{t('challan.out')}</th>
            <th>{t('challan.back')}</th>
            <th>{t('challan.atSite')}</th>
          </tr>
        </thead>
        <tbody>
          {c.items.map((i) => (
            <tr key={i.productId}>
              <td className="start">{lang === 'ur' && i.nameUr ? i.nameUr : i.nameEn}</td>
              <td className="num">{formatQty(i.qtyOut)}</td>
              <td className="num">{formatQty(i.qtyReturned)}</td>
              <td className="num">
                <b>{formatQty(i.atSite)}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="rule" />
      <div className="row">
        <span>{t('challan.advance')}</span>
        <span className="num">{formatMoney(c.advance)}</span>
      </div>
    </div>,
  );
  const styles = [...document.querySelectorAll('link[rel="stylesheet"], style')].map((el) => el.outerHTML).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><base href="${location.origin}/">${styles}<style>${RECEIPT_CSS}</style></head><body>${body}</body></html>`;
}
