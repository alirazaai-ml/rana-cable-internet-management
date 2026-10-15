-- ============================================================
-- 0002 — Helper functions
-- ============================================================
-- All SECURITY DEFINER with a fixed search_path so they
-- cannot be hijacked by a malicious caller.
-- These are the ONLY functions that read public.profiles
-- for authorization decisions.
-- ============================================================

-- Returns true if the current auth user is an active admin.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public, auth
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active = true
  );
$$;

-- Returns true if the current auth user is any active user.
create or replace function public.is_active_user()
returns boolean
language sql
security definer
stable
set search_path = public, auth
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true
  );
$$;

-- The company name used in WhatsApp messages. Edit this one
-- place to rebrand; every message picks it up.
create or replace function public.company_name()
returns text
language sql
immutable
as $$ select 'Rana Cable Internet'::text $$;

-- Normalise a Pakistani mobile number to 03XXXXXXXXX (mirrors
-- normalizePhone() in src/lib/format.ts). Returns NULL if invalid.
create or replace function public.normalize_phone(p text)
returns text
language plpgsql
immutable
as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if d like '0092%' then d := substr(d, 5);
  elsif d like '92%' and length(d) = 12 then d := substr(d, 3);
  end if;
  if length(d) = 10 and d like '3%' then d := '0' || d; end if;
  if d ~ '^03[0-9]{9}$' then return d; end if;
  return null;
end $$;

-- Revoke from everyone, then grant only to authenticated.
-- Anonymous (logged-out) sessions must never call these.
revoke all on function public.is_admin()         from public, anon;
revoke all on function public.is_active_user()   from public, anon;
grant execute on function public.is_admin()       to authenticated;
grant execute on function public.is_active_user() to authenticated;