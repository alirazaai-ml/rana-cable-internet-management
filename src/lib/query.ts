import { useQuery, type QueryKey } from '@tanstack/react-query'
import { supabase } from './supabase'

/** Throw Supabase errors so react-query can show them. */
export async function unwrap<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(error.message)
  return data as T
}

export function useSb<T>(key: QueryKey, fn: () => PromiseLike<{ data: T | null; error: { message: string } | null }>, enabled = true, staleTime?: number) {
  return useQuery({ queryKey: key, queryFn: () => unwrap<T>(fn()), enabled, ...(staleTime !== undefined ? { staleTime } : {}) })
}

export { errMsg } from './utils'

export { supabase }

/** Insert (id undefined) or update a row. Returns an error message or null. */
export async function saveRow(table: string, id: number | undefined, row: Record<string, unknown>): Promise<string | null> {
  const res = id ? await supabase.from(table).update(row).eq('id', id) : await supabase.from(table).insert(row)
  return res.error ? res.error.message : null
}
