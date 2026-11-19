import { useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useI18n, useLocalName } from '@/i18n';
import { useProducts, useSearchIndex } from '@/hooks/use-products';
import type { Product } from '@/lib/types';
import { searchProducts } from '@shared/search';
import { formatQty } from '@shared/money';
import { beep } from '@/lib/beep';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

/** Search box with a result list; Enter takes the exact barcode/code match or the top result. */
export function ProductSearch({ onPick, autoFocus, className }: { onPick: (p: Product) => void; autoFocus?: boolean; className?: string }) {
  const { t, unitLabel } = useI18n();
  const name = useLocalName();
  const products = useProducts();
  const index = useSearchIndex(products.data);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => (q.trim() ? searchProducts((products.data ?? []).filter((p) => p.active), q, 12, index) : []), [products.data, q, index]);

  const pick = (p: Product | undefined) => {
    if (!p) return beep(false);
    beep(true);
    onPick(p);
    setQ('');
    setActive(0);
    input.current?.focus();
  };

  return (
    <div className={cn('relative', className)}>
      <Search className="absolute start-3 top-1/2 size-5 -translate-y-1/2 text-muted" />
      <Input
        ref={input}
        autoFocus={autoFocus}
        value={q}
        onChange={(e) => (setQ(e.target.value), setActive(0))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, results.length - 1));
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
          else if (e.key === 'Enter') {
            e.preventDefault();
            const exact = results.find((p) => p.barcode === q.trim() || p.code.toLowerCase() === q.trim().toLowerCase());
            pick(exact ?? results[active]);
          } else return;
          e.preventDefault();
        }}
        placeholder={t('pos.search')}
        className="h-12 ps-10"
        autoComplete="off"
      />
      {results.length > 0 && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg">
          {results.map((p, i) => (
            <button
              key={p.id}
              onMouseDown={(e) => (e.preventDefault(), pick(p))}
              className={cn('flex min-h-12 w-full items-center justify-between gap-3 px-3 py-2 text-start', i === active ? 'bg-primary/10' : 'hover:bg-surface-2')}
            >
              <span>
                <span className="font-semibold">{name(p)}</span> <span className="num text-xs text-muted">{p.code}</span>
              </span>
              <span className="num text-sm text-muted">
                {formatQty(p.stock)} {unitLabel(p.unit)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
