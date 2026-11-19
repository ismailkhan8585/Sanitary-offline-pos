import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n, type TFunction } from '@/i18n';
import { useCan, usePublicSettings, type PublicSettings } from '@/hooks/use-auth';
import { formatMoney } from '@shared/money';
import { formatDateTime } from '@/lib/utils';
import { printHtml } from '@/lib/print';
import type { LedgerEntry, PartyType } from '@/lib/types';
import type { TranslationKey } from '@/i18n/en';
import { Button } from '@/components/ui/button';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BalanceBadge } from './balance-badge';
import { PartyForm, type PartyRecord } from './party-form';
import { PaymentDialog } from './payment-dialog';

interface LedgerResponse {
  party: PartyRecord & { balance: number };
  entries: LedgerEntry[];
}

export function PartySheet({ type, party, onClose }: { type: PartyType; party: PartyRecord | null; onClose: () => void }) {
  const { t } = useI18n();
  const [current, setCurrent] = useState(party);
  const addKey = type === 'customer' ? 'khata.addCustomer' : type === 'supplier' ? 'khata.addSupplier' : 'khata.addPlumber';
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={current ? current.name : t(addKey)} className="max-w-2xl">
      {current ? (
        <Tabs defaultValue="ledger">
          <TabsList>
            <TabsTrigger value="ledger">{t('khata.ledger')}</TabsTrigger>
            <TabsTrigger value="details">{t('khata.details')}</TabsTrigger>
          </TabsList>
          <TabsContent value="ledger">
            <Ledger type={type} id={current.id} />
          </TabsContent>
          <TabsContent value="details">
            <PartyForm type={type} party={current} onSaved={setCurrent} />
          </TabsContent>
        </Tabs>
      ) : (
        <PartyForm type={type} party={null} onSaved={setCurrent} />
      )}
    </Sheet>
  );
}

function Ledger({ type, id }: { type: PartyType; id: number }) {
  const { t, lang } = useI18n();
  const can = useCan();
  const { data: shop } = usePublicSettings();
  const ledger = useQuery({ queryKey: ['ledger', type, id], queryFn: () => api<LedgerResponse>(`/${type}s/${id}/ledger`) });
  const [paying, setPaying] = useState<'in' | 'out' | null>(null);
  if (!ledger.data) return <Skeleton className="h-96" />;
  const { party, entries } = ledger.data;
  const canPayOut = can('payment.out');
  const kind = (k: string) => t(`ledger.${k}` as TranslationKey);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <BalanceBadge type={type} balance={party.balance} />
        <div className="ms-auto flex flex-wrap gap-2">
          {type === 'customer' && can('payment.receive') && (
            <Button variant="success" onClick={() => setPaying('in')}>
              <ArrowDownLeft /> {t('khata.receive')}
            </Button>
          )}
          {type === 'customer' && canPayOut && (
            <Button variant="outline" onClick={() => setPaying('out')}>
              <ArrowUpRight /> {t('khata.refund')}
            </Button>
          )}
          {type !== 'customer' && canPayOut && (
            <Button onClick={() => setPaying('out')}>
              <ArrowUpRight /> {t('khata.pay')}
            </Button>
          )}
          <Button variant="outline" onClick={() => shop && printHtml(statementHtml(party, entries, shop, t, lang === 'ur'), 'a4')}>
            <Printer /> {t('khata.printStatement')}
          </Button>
        </div>
      </div>
      {entries.length <= 1 && entries[0]?.balance === 0 ? (
        <EmptyState icon={<ArrowDownLeft />} title={t('khata.empty')} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-muted">
              <tr>
                <th className="px-3 py-2 text-start">{t('common.date')}</th>
                <th className="px-3 py-2 text-start">{t('common.note')}</th>
                <th className="px-3 py-2 text-end">{t('khata.debit')}</th>
                <th className="px-3 py-2 text-end">{t('khata.credit')}</th>
                <th className="px-3 py-2 text-end">{t('khata.balance')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="whitespace-nowrap px-3 py-2">{formatDateTime(e.date)}</td>
                  <td className="px-3 py-2">
                    <span className="font-semibold">{kind(e.kind)}</span> <span className="num text-muted">{e.ref}</span>
                    {e.note && <span className="block text-xs text-muted">{e.note}</span>}
                  </td>
                  <td className="num px-3 py-2 text-end">{e.debit ? formatMoney(e.debit) : ''}</td>
                  <td className="num px-3 py-2 text-end text-success">{e.credit ? formatMoney(e.credit) : ''}</td>
                  <td className="num px-3 py-2 text-end font-semibold">{formatMoney(e.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {paying && (
        <PaymentDialog
          partyType={type}
          partyId={party.id}
          name={party.name}
          direction={paying}
          suggested={paying === 'in' || type !== 'customer' ? Math.abs(party.balance) : 0}
          onClose={() => setPaying(null)}
        />
      )}
    </div>
  );
}

function statementHtml(party: PartyRecord & { balance: number }, entries: LedgerEntry[], shop: PublicSettings, t: TFunction, urdu: boolean): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const rows = entries
    .map(
      (e) =>
        `<tr><td>${formatDateTime(e.date)}</td><td>${esc(t(`ledger.${e.kind}` as TranslationKey))} ${esc(e.ref)}<br><small>${esc(e.note)}</small></td><td class="n">${e.debit ? formatMoney(e.debit) : ''}</td><td class="n">${e.credit ? formatMoney(e.credit) : ''}</td><td class="n"><b>${formatMoney(e.balance)}</b></td></tr>`,
    )
    .join('');
  const styles = [...document.querySelectorAll('link[rel="stylesheet"], style')].map((el) => el.outerHTML).join('');
  return `<!doctype html><html dir="${urdu ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><base href="${location.origin}/">${styles}<style>
    @page{size:A4;margin:12mm} body{font-family:Inter,Arial,sans-serif;font-size:12px;color:#000;background:#fff}
    h1{font-size:20px;margin:0} h2{font-size:15px;margin:10px 0} table{width:100%;border-collapse:collapse}
    th,td{border-bottom:1px solid #ccc;padding:4px;text-align:start;vertical-align:top} .n{text-align:end;font-variant-numeric:tabular-nums;white-space:nowrap}
    .ur{font-family:'Noto Nastaliq Urdu',serif}</style></head><body>
    <h1>${esc(shop.shop_name_en)}</h1><div class="ur">${esc(shop.shop_name_ur)}</div><div>${esc(shop.shop_address)} ${esc(shop.shop_phone)}</div>
    <h2>${esc(t('khata.statement'))}: ${esc(party.name)} ${esc(party.phone)}</h2>
    <table><thead><tr><th>${esc(t('common.date'))}</th><th>${esc(t('common.note'))}</th><th class="n">${esc(t('khata.debit'))}</th><th class="n">${esc(t('khata.credit'))}</th><th class="n">${esc(t('khata.balance'))}</th></tr></thead><tbody>${rows}</tbody></table>
    <h2>${esc(t('khata.balance'))}: ${formatMoney(party.balance)}</h2></body></html>`;
}
