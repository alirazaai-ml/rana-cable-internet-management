import { useState } from 'react'
import { CheckCircle2, CircleAlert, Loader2, XCircle } from 'lucide-react'
import { Button, Card } from '@/components/ui'
import { PageHeader } from '@/components/shared'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthContext'

type Res = { name: string; state: 'ok' | 'warn' | 'fail'; detail: string }

/** Connection self-test: tells you exactly which part of the setup is missing. */
async function runChecks(role: 'admin' | 'staff'): Promise<Res[]> {
  const out: Res[] = []
  const url = import.meta.env.VITE_SUPABASE_URL as string
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string

  out.push({ name: 'Environment variables', state: url?.startsWith('https://') && anon ? 'ok' : 'fail',
    detail: url ? `Project: ${url.replace('https://', '')}` : 'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing (.env.local or Cloudflare variables)' })

  const { data: s } = await supabase.auth.getSession()
  out.push({ name: 'Signed-in session', state: s.session ? 'ok' : 'fail', detail: s.session ? `Signed in as ${s.session.user.email}` : 'No session - sign in again' })

  const a = await supabase.from('areas').select('id').limit(1)
  out.push({ name: 'Database tables + RLS', state: a.error ? 'fail' : 'ok',
    detail: a.error ? `${a.error.message} - apply the migrations in supabase/migrations (0000 to 0009)` : 'Tables are reachable' })

  const f = await supabase.rpc('staff_dashboard_stats')
  out.push({ name: 'Database functions (0009)', state: f.error ? 'fail' : 'ok', detail: f.error ? `${f.error.message} - apply migration 0009_dashboard_rpc_compatibility.sql and refresh the PostgREST schema cache` : 'Business functions installed' })

  if (role === 'admin') {
    try {
      const r = await fetch(`${url}/functions/v1/create-staff`, { method: 'GET', headers: { apikey: anon, Authorization: `Bearer ${anon}` } })
      if (r.ok) out.push({ name: 'Edge Function create-staff', state: 'ok', detail: 'Deployed and reachable' })
      else if (r.status === 404) out.push({ name: 'Edge Function create-staff', state: 'warn', detail: 'NOT deployed. Deploy it before adding employees (see README).' })
      else out.push({ name: 'Edge Function create-staff', state: 'warn', detail: `Reachable but answered HTTP ${r.status}` })
    } catch {
      out.push({ name: 'Edge Function create-staff', state: 'warn', detail: 'Request blocked/failed: function not deployed, CORS, ad-blocker or no internet.' })
    }
  }
  return out
}

export default function AboutPage() {
  const { profile } = useAuth()
  const [res, setRes] = useState<Res[] | null>(null); const [busy, setBusy] = useState(false)
  async function check() { setBusy(true); setRes(await runChecks(profile?.role ?? 'staff')); setBusy(false) }
  const Icon = { ok: <CheckCircle2 className="h-5 w-5 text-green-600" />, warn: <CircleAlert className="h-5 w-5 text-amber-500" />, fail: <XCircle className="h-5 w-5 text-red-600" /> }
  return (
    <div className="space-y-4">
      <PageHeader title="About" />
      <Card className="max-w-xl space-y-2 p-5 text-sm">
        <p className="text-lg font-semibold">Rana Cable & Internet</p>
        <p>Version 1.0.0</p>
        <p>A record-keeping and billing tool for a local internet service provider. It does not manage routers, bandwidth or network equipment. "Packages" are billing tiers only.</p>
        <p className="text-slate-500">Built with React, TypeScript, Supabase and Cloudflare Pages. Currency: PKR. Timezone: Asia/Karachi.</p>
      </Card>
      <Card className="max-w-xl space-y-3 p-5 text-sm">
        <div className="flex items-center justify-between"><p className="font-semibold">Connection check</p>
          <Button size="sm" variant="secondary" onClick={() => void check()} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Run check</Button></div>
        {res?.map((r) => (
          <div key={r.name} className="flex gap-3">{Icon[r.state]}<div><p className="font-medium">{r.name}</p><p className="text-xs text-slate-600">{r.detail}</p></div></div>
        ))}
        {!res && <p className="text-xs text-slate-500">Tests the database, installed functions and the create-staff Edge Function.</p>}
      </Card>
    </div>
  )
}
