  // Supabase Edge Function: create-staff
  // Why an Edge Function? Creating auth users needs the service_role key, which must NEVER
  // reach the browser. The key lives only in this function's runtime (injected automatically).
  //
  // Security: we verify the CALLER's JWT, then check in the database that the caller is an
  // active admin. Nothing the browser says about roles is trusted.
  //
  // Debug tip: open https://<project-ref>.supabase.co/functions/v1/create-staff in a browser.
  // If you see {"ok":true,...} (or a 401 about JWT) the function IS deployed; "NOT_FOUND" means it is not.
  import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version, x-region',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  }
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  Deno.serve(async (req) => {
    // Browser sends this CORS "preflight" first. If it fails, the browser reports only
    // "Failed to send a request to the Edge Function", so it must always answer 204 here.
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (req.method === 'GET') return json({ ok: true, function: 'create-staff' })
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

    try {
      const url = Deno.env.get('SUPABASE_URL')!
      const anon = Deno.env.get('SUPABASE_ANON_KEY')!
      const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      if (!url || !anon || !service) return json({ error: 'Function environment is missing Supabase keys' }, 500)

      // 1. Who is calling? (this client acts AS the caller)
      const authHeader = req.headers.get('Authorization') ?? ''
      const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
      const { data: userData, error: userErr } = await caller.auth.getUser()
      if (userErr || !userData.user) return json({ error: 'Not signed in' }, 401)

      const admin = createClient(url, service, { auth: { persistSession: false } })
      const { data: prof } = await admin.from('profiles').select('role,is_active').eq('id', userData.user.id).single()
      if (!prof || prof.role !== 'admin' || !prof.is_active) return json({ error: 'Admins only' }, 403)

      // 2. Validate input
      // deno-lint-ignore no-explicit-any
      let body: any
      try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
      const email = String(body.email ?? '').trim().toLowerCase()
      const password = String(body.password ?? '')
      const fullName = String(body.full_name ?? '').trim()
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Valid email required' }, 400)
      if (password.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400)
      if (fullName.length < 2) return json({ error: 'Full name required' }, 400)

      // 3. Create auth user (staff ONLY - admins are bootstrapped via SQL)
      const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
      if (cErr || !created.user) return json({ error: cErr?.message ?? 'Could not create user' }, 400)
      const uid = created.user.id

      const { error: pErr } = await admin.from('profiles').insert({ id: uid, full_name: fullName, role: 'staff', is_active: true })
      if (pErr) { await admin.auth.admin.deleteUser(uid); return json({ error: pErr.message }, 400) }

      const { error: eErr } = await admin.from('employees').insert({
        profile_id: uid, full_name: fullName, phone: body.phone || null, role_title: body.role_title || 'Field Collector',
        area_id: body.area_id || null, monthly_salary: body.monthly_salary ?? null,
      })
      if (eErr) { await admin.auth.admin.deleteUser(uid); return json({ error: eErr.message }, 400) }

      await admin.from('company_logs').insert({
        actor_id: userData.user.id, action: 'staff.created', entity_type: 'profiles', entity_id: uid, details: { email, full_name: fullName },
      })
      return json({ id: uid })
    } catch (e) {
      return json({ error: `Unexpected error: ${e instanceof Error ? e.message : String(e)}` }, 500)
    }
  })
