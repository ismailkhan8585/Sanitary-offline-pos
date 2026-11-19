import { renderToStaticMarkup } from 'react-dom/server';
import type { PublicSettings } from '@/hooks/use-auth';
import type { SaleDetail } from '@/lib/types';
import { formatMoney, formatQty } from '@shared/money';
import { translate, type Lang } from '@/i18n';
import type { TranslationKey } from '@/i18n/en';

interface ReceiptProps {
  sale: SaleDetail;
  shop: PublicSettings;
  lang: Lang;
  /** Cash handed back, shown only on the first print. */
  change?: number;
}

/** Thermal (58/80 mm) or A4 bill. Uses its own CSS so it prints the same everywhere. */
export function Receipt({ sale, shop, lang, change }: ReceiptProps) {
  const t = (k: TranslationKey) => translate(lang, k);
  const m = (p: number) => formatMoney(p, false);
  const prevBalance = sale.customerBalance !== null && sale.status === 'done' ? sale.customerBalance - sale.due : null;
  const unit = (u: string) => {
    const key = `unit.${u}` as TranslationKey;
    return translate(lang, key) === key ? u : translate(lang, key);
  };
  return (
    <div className={`receipt w-${shop.receipt_width}`} dir={lang === 'ur' ? 'rtl' : 'ltr'}>
      <div className="center">
        <div className="shop">{shop.shop_name_en}</div>
        {shop.shop_name_ur && <div className="shop-ur">{shop.shop_name_ur}</div>}
        {shop.shop_address && <div>{shop.shop_address}</div>}
        {shop.shop_phone && <div className="num">{shop.shop_phone}</div>}
      </div>
      {sale.status === 'quotation' && <div className="banner">{t('receipt.quotation')}</div>}
      {sale.status === 'cancelled' && <div className="banner">{t('receipt.cancelled')}</div>}
      <div className="rule" />
      <Row label={t('receipt.bill')} value={<b className="num">{sale.billNo}</b>} />
      <Row label={t('receipt.date')} value={<span className="num">{new Date(sale.createdAt).toLocaleString('en-PK')}</span>} />
      <Row label={t('receipt.cashier')} value={`${sale.userName ?? ''}${sale.deviceName ? ` · ${sale.deviceName}` : ''}`} />
      {sale.customerName && <Row label={t('pos.customer')} value={`${sale.customerName}${sale.customerPhone ? ` · ${sale.customerPhone}` : ''}`} />}
      <div className="rule" />
      <table>
        <thead>
          <tr>
            <th className="start">{t('receipt.item')}</th>
            <th>{t('receipt.qty')}</th>
            <th>{t('receipt.rate')}</th>
            <th>{t('receipt.amount')}</th>
          </tr>
        </thead>
        <tbody>
          {sale.items.map((i) => (
            <tr key={i.id}>
              <td className="start">
                {lang === 'ur' && i.nameUr ? i.nameUr : i.nameEn}
                {i.discount > 0 && <div className="small">- {m(i.discount)}</div>}
              </td>
              <td className="num">
                {formatQty(i.qty)} {unit(i.unit)}
              </td>
              <td className="num">{m(i.rate)}</td>
              <td className="num">{m(i.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="rule" />
      <Row label={t('pos.subtotal')} value={m(sale.subtotal)} />
      {sale.discount > 0 && <Row label={t('pos.discount')} value={`- ${m(sale.discount)}`} />}
      {sale.tax > 0 && <Row label={t('pos.tax')} value={m(sale.tax)} />}
      <div className="total">
        <Row label={t('pos.total')} value={`Rs ${m(sale.total)}`} />
      </div>
      {sale.status === 'done' && (
        <>
          {sale.creditApplied > 0 && <Row label={t('receipt.advance')} value={`- ${m(sale.creditApplied)}`} />}
          <Row label={`${t('receipt.paid')} (${t(`method.${sale.paymentMethod}`)})`} value={m(sale.paid)} />
          {change !== undefined && change > 0 && <Row label={t('pay.change')} value={m(change)} />}
          {sale.due > 0 && <Row label={t('receipt.due')} value={<b>{m(sale.due)}</b>} />}
        </>
      )}
      {prevBalance !== null && sale.customerBalance !== null && (
        <>
          <div className="rule" />
          <Row label={t('receipt.prevBalance')} value={m(prevBalance)} />
          <Row label={t('receipt.totalBalance')} value={<b>{m(sale.customerBalance)}</b>} />
        </>
      )}
      <div className="rule" />
      <div className="center footer">
        {shop.receipt_footer_en && <div>{shop.receipt_footer_en}</div>}
        {shop.receipt_footer_ur && <div className="ur">{shop.receipt_footer_ur}</div>}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="row">
      <span>{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}

export const RECEIPT_CSS = `
@page { margin: 0; }
body { margin: 0; color: #000; background: #fff; }
.receipt { font-family: Inter, Arial, sans-serif; font-size: 12px; line-height: 1.35; padding: 2mm 3mm; box-sizing: border-box; }
.receipt.w-80 { width: 80mm; }
.receipt.w-58 { width: 58mm; font-size: 10.5px; padding: 1mm 2mm; }
.receipt.w-a4 { width: 190mm; font-size: 13px; padding: 12mm 10mm; margin: 0 auto; }
.receipt .center { text-align: center; }
.receipt .shop { font-size: 1.45em; font-weight: 700; }
.receipt .shop-ur, .receipt .ur, .receipt[dir=rtl] { font-family: 'Noto Nastaliq Urdu', serif; line-height: 2; }
.receipt .shop-ur { font-size: 1.3em; }
.receipt .num { font-family: Inter, Arial, sans-serif; font-variant-numeric: tabular-nums; }
.receipt .banner { text-align: center; font-weight: 700; border: 1.5px solid #000; margin: 4px 0; padding: 2px; }
.receipt .rule { border-top: 1px dashed #000; margin: 4px 0; }
.receipt .row { display: flex; justify-content: space-between; gap: 6px; }
.receipt table { width: 100%; border-collapse: collapse; }
.receipt th { font-weight: 700; text-align: end; border-bottom: 1px solid #000; }
.receipt td { text-align: end; vertical-align: top; padding: 2px 0; }
.receipt .start { text-align: start; }
.receipt .small { font-size: 0.85em; }
.receipt .total { font-size: 1.5em; font-weight: 700; margin: 3px 0; }
.receipt .footer { margin-top: 4px; }
`;

/** Full HTML document for printing (fonts come from the app's own stylesheets). */
export function receiptDocument(props: ReceiptProps): string {
  const styles = [...document.querySelectorAll('link[rel="stylesheet"], style')].map((el) => el.outerHTML).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><base href="${location.origin}/">${styles}<style>${RECEIPT_CSS}</style></head><body>${renderToStaticMarkup(<Receipt {...props} />)}</body></html>`;
}
