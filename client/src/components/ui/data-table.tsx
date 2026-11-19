import { useState, type ReactNode } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowUpDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/i18n';
import { Input } from './input';
import { Button } from './button';
import { Skeleton } from './misc';

const PAGE = 200;

interface DataTableProps<T> {
  data: T[] | undefined;
  columns: ColumnDef<T, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  loading?: boolean;
  /** Shows a search box that filters all text columns. */
  searchable?: boolean;
  toolbar?: ReactNode;
  empty: ReactNode;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
}

/** Clean list with sticky header, search, sorting and "show more" paging. */
export function DataTable<T>({ data, columns, loading, searchable, toolbar, empty, onRowClick, rowClassName }: DataTableProps<T>) {
  const { t } = useI18n();
  const [filter, setFilter] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [limit, setLimit] = useState(PAGE);
  const table = useReactTable({
    data: data ?? [],
    columns,
    state: { globalFilter: filter, sorting },
    onGlobalFilterChange: setFilter,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  const rows = table.getRowModel().rows;

  return (
    <div className="space-y-3">
      {(searchable || toolbar) && (
        <div className="flex flex-wrap items-center gap-2">
          {searchable && (
            <div className="relative min-w-64 flex-1">
              <Search className="absolute start-3 top-1/2 size-5 -translate-y-1/2 text-muted" />
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('common.search')} className="ps-10" />
            </div>
          )}
          {toolbar}
        </div>
      )}
      <div className="max-h-[calc(100vh-15rem)] overflow-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-start text-sm">
          <thead className="sticky top-0 z-10 bg-surface-2 text-muted">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} className="whitespace-nowrap px-3 py-3 text-start font-semibold">
                    {h.column.getCanSort() ? (
                      <button className="inline-flex items-center gap-1" onClick={h.column.getToggleSortingHandler()}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        <ArrowUpDown className="size-3.5" />
                      </button>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 6 }, (_, i) => (
                <tr key={i}>
                  <td colSpan={columns.length} className="px-3 py-2">
                    <Skeleton className="h-8 w-full" />
                  </td>
                </tr>
              ))}
            {!loading &&
              rows.slice(0, limit).map((row) => (
                <tr
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={cn('border-t border-border', onRowClick && 'cursor-pointer hover:bg-surface-2', rowClassName?.(row.original))}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2.5 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
        {!loading && rows.length === 0 && empty}
      </div>
      {!loading && rows.length > limit && (
        <Button variant="outline" className="w-full" onClick={() => setLimit((l) => l + PAGE)}>
          {rows.length - limit} more…
        </Button>
      )}
    </div>
  );
}
