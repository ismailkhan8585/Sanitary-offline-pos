import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ClipboardCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n, useLocalName } from '@/i18n';
import { useCategories, useProducts, useSearchIndex } from '@/hooks/use-products';
import { formatQty } from '@shared/money';
import { searchProducts } from '@shared/search';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';

export function StockCountPage() {
  const { t, errorText, unitLabel } = useI18n();
  const name = useLocalName();
  const qc = useQueryClient();
  const products = useProducts();
  const index = useSearchIndex(products.data);
  const categories = useCategories();
  const [categoryId, setCategoryId] = useState('');
  const [query, setQuery] = useState('');
  const [counted, setCounted] = useState<Record<number, string>>({});

  const rows = useMemo(() => {
    const inCategory = (products.data ?? []).filter((p) => p.active && (!categoryId || p.categoryId === Number(categoryId)));
    return query.trim() ? searchProducts(inCategory, query, 500, index) : inCategory;
  }, [products.data, categoryId, query, index]);

  const changes = Object.entries(counted)
    .filter(([, v]) => v !== '')
    .map(([id, v]) => ({ productId: Number(id), countedQty: Number(v) }))
    .filter((c) => c.countedQty !== products.data?.find((p) => p.id === c.productId)?.stock);

  const save = useMutation({
    mutationFn: () => api<{ changed: number }>('/stock/count', 'POST', { items: changes }),
    onSuccess: (r) => {
      toast.success(t('count.saved', { count: r.changed }));
      setCounted({});
      qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (e) => toast.error(errorText(e)),
  });

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={t('count.title')}
        actions={
          <Button size="lg" disabled={changes.length === 0 || save.isPending} onClick={() => save.mutate()}>
            <ClipboardCheck /> {t('count.save')} ({changes.length})
          </Button>
        }
      />
      <p className="mb-3 text-muted">{t('count.help')}</p>
      <div className="mb-3 flex flex-wrap gap-2">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('common.search')} className="max-w-sm" />
        <NativeSelect value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-56">
          <option value="">{t('products.allCategories')}</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {name(c)}
            </option>
          ))}
        </NativeSelect>
      </div>
      {products.isLoading ? (
        <Skeleton className="h-96" />
      ) : rows.length === 0 ? (
        <EmptyState icon={<ClipboardCheck />} title={t('products.empty')} />
      ) : (
        <Card className="divide-y divide-border">
          <div className="grid grid-cols-[1fr_8rem_9rem_7rem] gap-3 px-4 py-2 text-sm font-semibold text-muted">
            <span>{t('common.name')}</span>
            <span>{t('count.system')}</span>
            <span>{t('count.counted')}</span>
            <span>{t('count.difference')}</span>
          </div>
          {rows.slice(0, 300).map((p) => {
            const value = counted[p.id] ?? '';
            const diff = value === '' ? 0 : Number(value) - p.stock;
            return (
              <div key={p.id} className="grid grid-cols-[1fr_8rem_9rem_7rem] items-center gap-3 px-4 py-2">
                <div>
                  <p className="font-semibold">{name(p)}</p>
                  <p className="num text-xs text-muted">{p.code}</p>
                </div>
                <span className="num">
                  {formatQty(p.stock)} {unitLabel(p.unit)}
                </span>
                <Input type="number" step="any" min="0" className="num" value={value} onChange={(e) => setCounted((c) => ({ ...c, [p.id]: e.target.value }))} />
                <span className={cn('num font-semibold', diff < 0 && 'text-danger', diff > 0 && 'text-success')}>
                  {diff === 0 ? '—' : `${diff > 0 ? '+' : ''}${formatQty(diff)}`}
                </span>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
