import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
export const cn = (...i: ClassValue[]) => twMerge(clsx(i))

/** Readable message from anything thrown: string, Error, Supabase/PostgREST error object, etc. */
export function errMsg(e: unknown): string {
  if (e == null) return 'Unknown error'
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  if (typeof e === 'object') {
    const o = e as Record<string, unknown>
    for (const k of ['message', 'error', 'details', 'hint']) if (typeof o[k] === 'string' && o[k]) return o[k] as string
    try { const s = JSON.stringify(o); return s === '{}' ? 'Unknown error' : s } catch { return 'Unknown error' }
  }
  return String(e)
}
