import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Clock, FilePlus2, PauseCircle } from 'lucide-react';
import { useCurrentShift } from '@/pages/shift/shift-page';
import { api } from '@/lib/api';
import { useI18n } from '@/i18n';
import { usePublicSettings } from '@/hooks/use-auth';
import { useProducts } from '@/hooks/use-products';
import { usePrintSale } from '@/hooks/use-print-sale';
import { beep } from '@/lib/beep';
import { useWithApproval } from '@/components/approval';
import type { Product, SaleDetail } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { cartReducer, cartTotals, emptyCart, toSaleItems, type Cart, type CartLine } from './cart';
import { ProductPanel } from './product-panel';
import { CartPanel } from './cart-panel';
import { LineEditor } from './line-editor';
import { PayDialog, type PayResult } from './pay-dialog';
import { CustomerPicker } from './customer-picker';
import { OpenBillsSheet } from './open-bills-sheet';

const CART_KEY = 'pos.cart';

function savedCart(): Cart {
  try {
    const raw = localStorage.getItem(CART_KEY);
    return raw ? { ...emptyCart, ...(JSON.parse(raw) as Cart) } : emptyCart;
  } catch {
    return emptyCart;
  }
}

/** Builds a cart from a held bill / quotation using today's product data. */
function cartFromSale(sale: SaleDetail, products: Product[]): Cart {
  let cart: Cart = { ...emptyCart, tier: sale.priceTier, customerId: sale.customerId, plumberId: sale.plumberId, heldId: sale.status === 'held' ? sale.id : null };
  for (const item of sale.items) {
    const p = products.find((x) => x.id === item.productId);
    if (!p) continue;
    cart = cartReducer(cart, { type: 'add', product: p, unit: item.unit, qty: item.qty });
    const line = cart.lines[cart.lines.length - 1];
    cart = cartReducer(cart, { type: 'update', key: line.key, unit: item.unit, qty: item.qty, rate: item.rate, discount: item.discount });
  }
  return { ...cart, billDiscount: sale.discount };
}

export function PosPage() {
  const { t, errorText } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const products = useProducts();
  const { data: shop } = usePublicSettings();
  const printSale = usePrintSale();
  const withApproval = useWithApproval();
  const current = useCurrentShift();
  const [cart, dispatch] = useReducer(cartReducer, undefined, savedCart);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<CartLine | null>(null);
  const [dialog, setDialog] = useState<'pay' | 'customer' | 'open' | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const totals = cartTotals(cart, Number(shop?.tax_pct ?? 0));
  const payTotal = Math.max(0, totals.total - (cart.exchange?.amount ?? 0));

  useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch {
      // Cart still works; it just will not survive a page reload.
    }
  }, [cart]);

  const focusSearch = useCallback(() => setTimeout(() => searchRef.current?.focus(), 0), []);
  useEffect(() => {
    if (!dialog && !editing) focusSearch();
  }, [dialog, editing, focusSearch]);

  const add = (p: Product) => {
    dispatch({ type: 'add', product: p });
    setQuery('');
    focusSearch();
  };

  const remove = (line: CartLine) => {
    const index = cart.lines.findIndex((l) => l.key === line.key);
    dispatch({ type: 'remove', key: line.key });
    setEditing(null);
    toast(t('pos.removed', { name: line.nameEn }), { action: { label: t('pos.undo'), onClick: () => dispatch({ type: 'restore', line, index }) } });
  };

  const clearBill = () => {
    const before = cart;
    dispatch({ type: 'clear' });
    toast(t('pos.cleared'), { action: { label: t('pos.undo'), onClick: () => dispatch({ type: 'load', cart: before }) } });
  };

  const openSale = useCallback(
    async (id: number) => {
      try {
        const sale = await api<SaleDetail>(`/sales/${id}`);
        dispatch({ type: 'load', cart: cartFromSale(sale, products.data ?? []) });
        toast.success(t('pos.recalled', { billNo: sale.billNo }));
        setDialog(null);
      } catch (e) {
        toast.error(errorText(e));
      }
    },
    [products.data, t, errorText],
  );

  // "Open in POS" from the Bills page, or an exchange coming from the Returns page.
  useEffect(() => {
    const state = location.state as { openSaleId?: number; exchange?: Cart['exchange'] } | null;
    if (state?.exchange) {
      navigate('.', { replace: true, state: null });
      dispatch({ type: 'setExchange', exchange: state.exchange });
    } else if (state?.openSaleId && products.data) {
      navigate('.', { replace: true, state: null });
      openSale(state.openSaleId);
    }
  }, [location.state, products.data, navigate, openSale]);

  const save = useMutation({
    mutationFn: (v: { status: 'done' | 'held' | 'quotation'; pay?: PayResult }) =>
      withApproval((adminPin) => api<SaleDetail>('/sales', 'POST', {
        adminPin,
        status: v.status,
        customerId: cart.customerId,
        plumberId: cart.plumberId,
        priceTier: cart.tier,
        items: toSaleItems(cart),
        billDiscount: cart.billDiscount,
        paymentMethod: v.pay?.method ?? 'cash',
        paid: v.pay?.paid ?? 0,
        fromHeldId: cart.heldId ?? undefined,
        exchangeReturnId: v.status === 'done' ? cart.exchange?.returnId : undefined,
      })),
    onSuccess: (sale, v) => {
      const msg = v.status === 'held' ? 'pos.held' : v.status === 'quotation' ? 'pos.quoted' : 'pos.saved';
      toast.success(t(msg, { billNo: sale.billNo }));
      if (v.pay?.print || v.status === 'quotation') printSale(sale, v.pay?.change);
      dispatch({ type: 'clear' });
      setDialog(null);
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['shift'] });
    },
    onError: (e) => toast.error(errorText(e)),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog || editing) return;
      if (e.key === 'F2') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.key === 'F9') {
        e.preventDefault();
        if (cart.lines.length) setDialog('pay');
      } else if (e.key === 'Escape') {
        if (query) setQuery('');
        else if (cart.lines.length) clearBill();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="-m-4 flex h-[calc(100vh-4rem)] flex-col gap-3 p-3 lg:-m-6 lg:flex-row">
      <div className="flex min-h-0 flex-col gap-2 lg:w-[65%]">
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setDialog('open')}>
            <PauseCircle /> {t('pos.openBills')}
          </Button>
          {cart.lines.length > 0 && (
            <Button variant="ghost" onClick={clearBill} shortcut="Esc">
              <FilePlus2 /> {t('pos.newBill')}
            </Button>
          )}
          {current.data === null && (
            <Link to="/shift" className="flex items-center gap-2 rounded-md bg-warning/10 px-3 font-semibold text-warning">
              <Clock className="size-5" /> {t('shift.notOpen')} <u>{t('shift.openNow')}</u>
            </Link>
          )}
          {cart.heldId && <span className="self-center rounded-md bg-warning/10 px-2 py-1 text-sm font-semibold text-warning">{t('pos.recalledFrom')}</span>}
        </div>
        <div className="min-h-0 flex-1">
          <ProductPanel
            ref={searchRef}
            query={query}
            onQueryChange={setQuery}
            tier={cart.tier}
            onPick={add}
            onSubmit={(match) => {
              if (match) {
                beep(true);
                add(match);
              } else beep(false);
            }}
          />
        </div>
      </div>
      <div className="min-h-[50vh] lg:min-h-0 lg:w-[35%]">
        <CartPanel
          cart={cart}
          totals={totals}
          dispatch={dispatch}
          busy={save.isPending}
          onEditLine={setEditing}
          onRemoveLine={remove}
          onPickCustomer={() => setDialog('customer')}
          onHold={() => save.mutate({ status: 'held' })}
          onQuotation={() => save.mutate({ status: 'quotation' })}
          onPay={() => setDialog('pay')}
        />
      </div>

      {editing && (
        <LineEditor
          line={editing}
          onClose={() => setEditing(null)}
          onRemove={() => remove(editing)}
          onSave={(v) => {
            dispatch({ type: 'update', key: editing.key, ...v });
            setEditing(null);
          }}
        />
      )}
      {dialog === 'pay' && (
        <PayDialog
          total={payTotal}
          hasCustomer={cart.customerId !== null}
          busy={save.isPending}
          onClose={() => setDialog(null)}
          onPay={(pay) => save.mutate({ status: 'done', pay })}
        />
      )}
      {dialog === 'customer' && (
        <CustomerPicker
          onClose={() => setDialog(null)}
          onPick={(c) => {
            dispatch({ type: 'setCustomer', customerId: c?.id ?? null, tier: c?.priceTier ?? 'retail' });
            setDialog(null);
          }}
        />
      )}
      {dialog === 'open' && <OpenBillsSheet onClose={() => setDialog(null)} onOpen={openSale} />}
    </div>
  );
}
