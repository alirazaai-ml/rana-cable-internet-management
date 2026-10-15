import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Set when the build has no Supabase settings; App shows a clear screen instead of a blank page. */
export const configError: string | null =
  !url || !anon || !/^https:\/\//.test(url)
    ? 'Missing or invalid VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.local.example to .env.local (or set them in your hosting provider) and rebuild.'
    : null

// Only the public anon key is ever used in the browser. Security comes from RLS.
// (placeholder values keep the module importable so the error screen can render)
export const supabase = createClient(url || 'https://missing.invalid', anon || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
})
