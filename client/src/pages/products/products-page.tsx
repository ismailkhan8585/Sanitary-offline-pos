import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Download, FileSpreadsheet, Package, Percent, Plus, Tags, Upload } from 'lucide-react';
import { useI18n, useLocalName } from '@/i18n';
import { useCan } from '@/hooks/use-auth';
import { useCategories, useProducts } from '@/hooks/use-products';
import { downloadUrl } from '@/lib/api';
import type { Product } from '@/lib/types';
import { formatMoney } from '@shared/money';
import { stockLevel } from '@shared/units';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { EmptyState, PageHeader, Switch } from '@/components/ui/misc';
import { DataTable } from '@/components/ui/data-table';
import { StockBadge } from '@/components/stock-badge';
import { ProductForm } from './product-form';
import { ImportDialog } from './import-dialog';
import { PriceUpdateDialog } from './price-update-dialog';
import { CategoriesSheet } from './categories-sheet';

export function ProductsPage() {
  const { t, unitLabel } = useI18n();
  const name = useLocalName();
  const can = useCan();
  const canWrite = can('product.write');
  const products = useProducts();
  const categories = useCategories();
  const [categoryId, setCategoryId] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [dialog, setDialog] = useState<'import' | 'price' | 'categories' | null>(null);

  const rows = useMemo(
    () =>
      (products.data ?? []).filter(
        (p) => (!categoryId || p.categoryId === Number(categoryId)) && (!lowOnly || stockLevel(p.stock, p.minStock) !== 'ok'),
      ),
    [products.data, categoryId, lowOnly],
  );

  const columns: ColumnDef<Product>[] = [
    { accessorKey: 'code', header: t('products.code'), cell: (c) => <span className="num text-muted">{c.row.original.code}</span> },
    {
      id: 'name',
      accessorFn: (p) => `${p.nameEn} ${p.nameUr} ${p.aliases} ${p.barcode ?? ''}`,
      header: t('common.name'),
      cell: (c) => (
        <div>
          <p className="font-semibold">{name(c.row.original)}</p>
          <p className="text-xs text-muted">{[c.row.original.brand, c.row.original.size, c.row.original.color].filter(Boolean).join(' · ')}</p>
        </div>
      ),
    },
    { accessorKey: 'categoryName', header: t('products.category'), cell: (c) => c.row.original.categoryName ?? '—' },
    {
      accessorKey: 'stock',
      header: t('products.stock'),
      cell: (c) => <StockBadge qty={c.row.original.stock} minStock={c.row.original.minStock} unit={c.row.original.unit} />,
    },
    {
      accessorKey: 'retailPrice',
      header: t('products.retailPrice'),
      cell: (c) => (
        <span className="num font-semibold">
          {formatMoney(c.row.original.retailPrice)}
          <span className="text-xs font-normal text-muted"> / {unitLabel(c.row.original.unit)}</span>
        </span>
      ),
    },
    ...(can('cost.view')
      ? [{ accessorKey: 'costPrice', header: t('products.costPrice'), cell: (c) => <span className="num text-muted">{formatMoney(c.row.original.costPrice ?? 0)}</span> } as ColumnDef<Product>]
      : []),
  ];

  return (
    <div>
      <PageHeader
        title={t('products.title')}
        actions={
          canWrite && (
            <>
              <Button variant="outline" onClick={() => setDialog('categories')}>
                <Tags /> {t('products.categories')}
              </Button>
              <Button variant="outline" onClick={() => setDialog('price')}>
                <Percent /> {t('products.priceUpdate')}
              </Button>
              <Button variant="outline" onClick={() => setDialog('import')}>
                <Upload /> {t('products.import')}
              </Button>
              <Button variant="outline" asChild>
                <a href={downloadUrl('/products/export.xlsx')} download>
                  <Download /> {t('products.export')}
                </a>
              </Button>
              <Button onClick={() => setEditing('new')}>
                <Plus /> {t('products.add')}
              </Button>
            </>
          )
        }
      />
      <DataTable
        data={rows}
        loading={products.isLoading}
        columns={columns}
        searchable
        onRowClick={canWrite ? setEditing : undefined}
        rowClassName={(p) => (p.active ? '' : 'opacity-50')}
        toolbar={
          <>
            <NativeSelect value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-56">
              <option value="">{t('products.allCategories')}</option>
              {categories.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {name(c)}
                </option>
              ))}
            </NativeSelect>
            <label className="flex h-11 items-center gap-2 rounded-md border border-border bg-surface px-3">
              <Switch checked={lowOnly} onCheckedChange={setLowOnly} />
              {t('products.lowOnly')}
            </label>
          </>
        }
        empty={
          <EmptyState
            icon={<Package />}
            title={t('products.empty')}
            action={
              canWrite && (
                <Button onClick={() => setDialog('import')}>
                  <FileSpreadsheet /> {t('products.import')}
                </Button>
              )
            }
          />
        }
      />
      {editing && <ProductForm product={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {dialog === 'import' && <ImportDialog onClose={() => setDialog(null)} />}
      {dialog === 'price' && <PriceUpdateDialog onClose={() => setDialog(null)} />}
      {dialog === 'categories' && <CategoriesSheet onClose={() => setDialog(null)} />}
    </div>
  );
}
