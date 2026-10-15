import { type ReactNode } from 'react'
import { Inbox } from 'lucide-react'
import { cn, errMsg } from '@/lib/utils'
import { formatMoney, titleCase } from '@/lib/format'
import { Button, Dialog } from '@/components/ui'

export function Money({ value, className }: { value: number | string | null | undefined; className?: string }) {
  return <span className={cn('tabular-nums', className)}>{formatMoney(value)}</span>
}

const colors: Record<string, string> = {
  paid: 'bg-green-100 text-green-800', partial: 'bg-amber-100 text-amber-800', unpaid: 'bg-slate-100 text-slate-700',
  overdue: 'bg-red-100 text-red-800', active: 'bg-blue-100 text-blue-800', inactive: 'bg-slate-100 text-slate-600',
  on: 'bg-green-100 text-green-800', off: 'bg-red-100 text-red-800',
  open: 'bg-red-100 text-red-800', in_progress: 'bg-amber-100 text-amber-800', resolved: 'bg-green-100 text-green-800', closed: 'bg-slate-100 text-slate-600',
  pending: 'bg-amber-100 text-amber-800', sent: 'bg-green-100 text-green-800', failed: 'bg-red-100 text-red-800',
  income: 'bg-green-100 text-green-800', expense: 'bg-red-100 text-red-800', credit: 'bg-green-100 text-green-800', debit: 'bg-red-100 text-red-800',
  reversed: 'bg-red-100 text-red-800',
}
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <span className={cn('inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium', colors[status] ?? 'bg-slate-100 text-slate-700')}>{label ?? titleCase(status)}</span>
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-xl font-bold sm:text-2xl">{title}</h1>{subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}</div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center text-slate-500">
      <Inbox className="h-10 w-10" /><p className="font-medium text-slate-700">{title}</p>{hint && <p className="text-sm">{hint}</p>}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p className="font-medium">Something went wrong</p>
      <p>{errMsg(error)}</p>
      {onRetry && <Button variant="secondary" size="sm" className="mt-2" onClick={onRetry}>Try again</Button>}
    </div>
  )
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', danger, loading, confirmDisabled, onConfirm, onCancel }: {
  open: boolean; title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; loading?: boolean; confirmDisabled?: boolean
  onConfirm: () => void; onCancel: () => void
}) {
  return (
    <Dialog open={open} onClose={onCancel} title={title}>
      <div className="mb-5 text-sm text-slate-700">{message}</div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} loading={loading} disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Dialog>
  )
}

export function Stat({ label, children, tone = 'text-slate-900' }: { label: string; children: ReactNode; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn('mt-1 text-2xl font-bold tabular-nums', tone)}>{children}</p>
    </div>
  )
}

/** Standard Cancel / Save footer for dialog forms. */
export function FormActions({ onCancel, saving, submitLabel = 'Save' }: { onCancel: () => void; saving?: boolean; submitLabel?: string }) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      <Button type="submit" loading={saving}>{submitLabel}</Button>
    </div>
  )
}
