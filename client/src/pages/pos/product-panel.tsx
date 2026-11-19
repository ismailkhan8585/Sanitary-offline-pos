import { forwardRef, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Box, Search, Zap } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n, useLocalName } from '@/i18n';
import { useCategories, useProducts, useSearchIndex } from '@/hooks/use-products';
import { tierPrice, type PriceTier } from '@/lib/pricing';
import type { Product } from '@/lib/types';
import { searchProducts } from '@shared/search';
import { formatMoney } from '@shared/money';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { StockBadge } from '@/components/stock-badge';

interface ProductPanelProps {
  query: string;
  onQueryChange: (q: string) => void;
  /** Enter in the search box: add the exact barcode/code match or the single result. */
  onSubmit: (match: Product | null) => void;
  onPick: (p: Product) => void;
  tier: PriceTier;
}

const GRID_LIMIT = 60;

export const ProductPanel = forwardRef<HTMLInputElement, ProductPanelProps>(({ query, onQueryChange, onSubmit, onPick, tier }, ref) => {
  const { t } = useI18n();
  const name = useLocalName();
  const products = useProducts();
  const index = useSearchIndex(products.data);
  const categories = useCategories();
  const top = useQuery({ queryKey: ['sales', 'top'], queryFn: () => api<{ productId: number }[]>('/sales/top-products'), staleTime: 300_000 });
  const [categoryId, setCategoryId] = useState<number | 'quick' | null>(null);

  const active = useMemo(() => (products.data ?? []).filter((p) => p.active), [products.data]);
  const quick = useMemo(() => {
    const byId = new Map(active.map((p) => [p.id, p]));
    return (top.data ?? []).map((r) => byId.get(r.productId)).filter((p): p is Product => Boolean(p));
  }, [active, top.data]);

  const shown = useMemo(() => {
    if (query.trim()) return searchProducts(active, query, GRID_LIMIT, index);
    if (categoryId === 'quick') return quick;
    return (categoryId ? active.filter((p) => p.categoryId === categoryId) : active).slice(0, GRID_LIMIT);
  }, [active, query, categoryId, quick, index]);

  const submit = () => {
    const q = query.trim().toLowerCase();
    if (!q) return;
    const exact = active.find((p) => p.barcode?.toLowerCase() === q || p.code.toLowerCase() === q);
    onSubmit(exact ?? (shown.length === 1 ? shown[0] : null));
  };

  const chip = (selected: boolean) =>
    cn('h-11 shrink-0 rounded-full border px-4 font-semibold transition-colors', selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface hover:bg-surface-2');

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="relative">
        <Search className="absolute start-4 top-1/2 size-6 -translate-y-1/2 text-muted" />
        <Input
          ref={ref}
          autoFocus
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), submit())}
          placeholder={t('pos.search')}
          className="h-14 ps-14 pe-16 text-lg"
          autoComplete="off"
        />
        <kbd className="num absolute end-3 top-1/2 -translate-y-1/2 rounded bg-surface-2 px-2 py-1 text-xs text-muted">F2</kbd>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button className={chip(categoryId === null)} onClick={() => setCategoryId(null)}>
          {t('pos.all')}
        </button>
        {quick.length > 0 && (
          <button className={cn(chip(categoryId === 'quick'), categoryId !== 'quick' && 'border-accent/60 bg-accent/10')} onClick={() => setCategoryId('quick')}>
            <Zap className="me-1 inline size-4 text-accent" />
            {t('pos.quick')}
          </button>
        )}
        {categories.data?.map((c) => (
          <button key={c.id} className={chip(categoryId === c.id)} onClick={() => setCategoryId(c.id)}>
            {name(c)}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {products.isLoading ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 12 }, (_, i) => (
              <Skeleton key={i} className="h-36" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <EmptyState icon={<Search />} title={query ? t('pos.noResults', { q: query }) : t('products.empty')} />
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
            {shown.map((p) => (
              <button
                key={p.id}
                onClick={() => onPick(p)}
                className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-start shadow-sm transition hover:border-primary hover:shadow active:scale-[0.98]"
              >
                <div className="flex items-start gap-2">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Box className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="line-clamp-2 text-[15px] font-semibold leading-snug">{name(p)}</p>
                    <p className="num truncate text-xs text-muted">{[p.code, p.size, p.brand].filter(Boolean).join(' · ')}</p>
                  </div>
                </div>
                <StockBadge qty={p.stock} minStock={p.minStock} unit={p.unit} className="self-start" />
                <span className="num mt-auto text-xl font-bold text-primary">{formatMoney(tierPrice(p, tier))}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
ProductPanel.displayName = 'ProductPanel';
