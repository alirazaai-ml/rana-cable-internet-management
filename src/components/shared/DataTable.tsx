import { useDeferredValue, useMemo, useState, type ReactNode } from 'react'
import {
  flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel,
  useReactTable, type ColumnDef, type SortingState,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { Button, Input, Skeleton } from '@/components/ui'
import { EmptyState, ErrorState } from './index'

/**
 * Generic table: search, sort, pagination, loading skeleton, empty + error states.
 * Filtering/sorting is done in the browser, which is fine for ~1200 customers and keeps the
 * code simple. (Payments/logs are date-limited on the server before they get here.)
 */
// Lower-cased searchable text per row, built once (not on every keystroke).
const textCache = new WeakMap<object, string>()
function rowText(o: object): string {
  let t = textCache.get(o)
  if (t === undefined) { t = JSON.stringify(o).toLowerCase(); textCache.set(o, t) }
  return t
}

export function DataTable<T>({ columns, data, isLoading, error, onRetry, toolbar, searchPlaceholder = 'Search...', pageSize = 20, emptyTitle = 'Nothing here yet', emptyHint, onRowClick }: {
  columns: ColumnDef<T, any>[]; data: T[] | undefined; isLoading?: boolean; error?: unknown; onRetry?: () => void
  toolbar?: ReactNode; searchPlaceholder?: string; pageSize?: number; emptyTitle?: string; emptyHint?: string
  onRowClick?: (row: T) => void
}) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [filter, setFilter] = useState('')
  const deferredFilter = useDeferredValue(filter) // typing stays instant even with thousands of rows
  const rows = useMemo(() => data ?? [], [data])
  const table = useReactTable({
    data: rows, columns, state: { sorting, globalFilter: deferredFilter },
    onSortingChange: setSorting, onGlobalFilterChange: setFilter,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(), getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
    globalFilterFn: (row, _id, value) => rowText(row.original as object).includes(String(value).trim().toLowerCase()),
  })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
          <Input className="pl-9" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={searchPlaceholder} aria-label="Search" />
        </div>
        {toolbar}
      </div>

      {error ? <ErrorState error={error} onRetry={onRetry} /> : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th key={h.id} className="whitespace-nowrap px-3 py-2.5 font-medium">
                      {h.isPlaceholder ? null : h.column.getCanSort() ? (
                        <button className="inline-flex items-center gap-1 hover:text-slate-900" onClick={h.column.getToggleSortingHandler()}>
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {h.column.getIsSorted() === 'asc' && <ArrowUp className="h-3 w-3" />}
                          {h.column.getIsSorted() === 'desc' && <ArrowDown className="h-3 w-3" />}
                        </button>
                      ) : flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading && Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}><td colSpan={columns.length} className="px-3 py-3"><Skeleton className="h-5 w-full" /></td></tr>
              ))}
              {!isLoading && table.getRowModel().rows.map((row) => (
                <tr key={row.id} className={onRowClick ? 'cursor-pointer hover:bg-slate-50' : 'hover:bg-slate-50/60'} onClick={() => onRowClick?.(row.original)}>
                  {row.getVisibleCells().map((c) => <td key={c.id} className="px-3 py-2.5 align-middle">{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          {!isLoading && table.getFilteredRowModel().rows.length === 0 && <EmptyState title={deferredFilter ? 'No matches' : emptyTitle} hint={deferredFilter ? 'Try a different search.' : emptyHint} />}
        </div>
      )}

      {!error && (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span aria-live="polite">{table.getFilteredRowModel().rows.length} record(s)</span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
            <span>Page {table.getState().pagination.pageIndex + 1} of {Math.max(table.getPageCount(), 1)}</span>
            <Button variant="secondary" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}
    </div>
  )
}
