// Small shadcn-style primitives (hand written so the project has no CLI setup step).
import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { Loader2, X } from 'lucide-react'
import { cn, errMsg } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success'
const variants: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700',
  secondary: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  success: 'bg-green-600 text-white hover:bg-green-700',
  ghost: 'text-slate-700 shadow-none hover:bg-slate-100',
}
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean; size?: 'sm' | 'md' }>(
  ({ className, variant = 'primary', loading, size = 'md', children, disabled, ...p }, ref) => (
    <button ref={ref} type={p.type ?? 'button'} disabled={disabled || loading}
      className={cn('inline-flex items-center justify-center gap-2 rounded-lg font-medium shadow-sm transition active:scale-[.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100',
        size === 'md' ? 'min-h-[44px] px-4 text-sm' : 'min-h-[34px] px-3 text-xs', variants[variant], className)} {...p}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}{children}
    </button>
  ))
Button.displayName = 'Button'

const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 min-h-[44px] text-slate-900 placeholder:text-slate-400 transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:bg-slate-100'
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} className={cn(field, className)} {...p} />)
Input.displayName = 'Input'
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => <select ref={ref} className={cn(field, className)} {...p} />)
Select.displayName = 'Select'
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => <textarea ref={ref} className={cn(field, 'py-2', className)} rows={3} {...p} />)
Textarea.displayName = 'Textarea'

export function Field({ label, error, children, hint }: { label: string; error?: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-slate-500">{hint}</span>}
      {error && <span className="block text-xs text-red-600" role="alert">{error}</span>}
    </label>
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('rounded-xl border border-slate-200 bg-white shadow-sm', className)}>{children}</div>
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-slate-200', className)} />
}

export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const panel = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden' // stop the page scrolling behind the dialog
    // focus the first field (or the panel) so keyboard / screen-reader users land inside
    const first = panel.current?.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea, button:not([aria-label="Close"])')
    ;(first ?? panel.current)?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCloseRef.current(); return }
      if (e.key !== 'Tab' || !panel.current) return
      // keep Tab inside the dialog
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      if (items.length === 0) return
      const firstEl = items[0], lastEl = items[items.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus() }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      previouslyFocused?.focus?.()
    }
  }, [open])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
        className={cn('max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl outline-none sm:rounded-2xl', wide ? 'sm:max-w-2xl' : 'sm:max-w-md')}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** Simple toast system (no dependency). */
type ToastItem = { id: number; kind: 'ok' | 'err'; text: string }
let toasts: ToastItem[] = []
const listeners = new Set<(t: ToastItem[]) => void>()
const emit = () => listeners.forEach((l) => l(toasts))

export const toast = {
  ok: (text: string) => push('ok', text),
  /** Accepts anything — a string, an Error, or a Supabase error object. */
  err: (text: unknown) => push('err', errMsg(text)),
}

function push(kind: 'ok' | 'err', text: string) {
  const id = Date.now() + Math.random()
  toasts = [...toasts, { id, kind, text }]
  emit()
  setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); emit() }, kind === 'err' ? 8000 : 4500)
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([])
  useEffect(() => { listeners.add(setItems); return () => { listeners.delete(setItems) } }, [])
  return (
    <div className="fixed right-3 top-3 z-[60] flex w-[calc(100%-1.5rem)] max-w-sm flex-col gap-2" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} role={t.kind === 'err' ? 'alert' : 'status'} className={cn('rounded-lg px-4 py-3 text-sm text-white shadow-lg', t.kind === 'ok' ? 'bg-green-600' : 'bg-red-600')}>{t.text}</div>
      ))}
    </div>
  )
}