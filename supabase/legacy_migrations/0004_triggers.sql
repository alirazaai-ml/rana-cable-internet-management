-- ============================================================
-- 0004 — Triggers
-- ============================================================
-- updated_at maintenance, customer.balance recomputation,
-- customer_code + phone normalisation, account balances,
-- column-level protection for staff, audit logging.
--
-- "Trusted session" = the SQL editor / migrations (postgres,
-- supabase_admin) or the service role. Those bypass the
-- application guards below; every browser user goes through them.
-- ============================================================

create or replace function public.is_trusted_session()
returns boolean
language sql
stable
as $$ select current_user in ('postgres', 'supabase_admin', 'service_role') $$;

-- ------------------------------------------------------------
-- updated_at
-- ------------------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_profiles_updated  on public.profiles;
drop trigger if exists trg_packages_updated  on public.packages;
drop trigger if exists trg_employees_updated on public.employees;
drop trigger if exists trg_customers_updated on public.customers;
drop trigger if exists trg_templates_updated on public.sms_templates;
create trigger trg_profiles_updated  before update on public.profiles  for each row execute function public.tg_set_updated_at();
create trigger trg_packages_updated  before update on public.packages  for each row execute function public.tg_set_updated_at();
create trigger trg_employees_updated before update on public.employees for each row execute function public.tg_set_updated_at();
create trigger trg_customers_updated before update on public.customers for each row execute function public.tg_set_updated_at();
create trigger trg_templates_updated before update on public.sms_templates for each row execute function public.tg_set_updated_at();

-- ------------------------------------------------------------
-- Recompute customers.balance whenever invoices or payments
-- change. Balance = opening_balance + sum of unpaid remaining.
-- Reads the base tables directly (not the fee_balances view) so
-- it gives the same answer for every caller, including cron / SQL
-- editor sessions that have no JWT.
-- ------------------------------------------------------------
create or replace function public.recompute_customer_balance(p_customer_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.customers c
  set balance = c.opening_balance + coalesce((
    select sum(greatest(f.amount_due - coalesce(pp.paid, 0), 0))
    from public.monthly_fees f
    left join lateral (
      select sum(p.amount_paid) as paid
      from public.payments p
      where p.monthly_fee_id = f.id and p.reversed_at is null
    ) pp on true
    where f.customer_id = c.id
  ), 0)
  where c.id = p_customer_id;
end $$;

create or replace function public.tg_fees_recompute_balance()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.recompute_customer_balance(coalesce(new.customer_id, old.customer_id));
  return coalesce(new, old);
end $$;

create or replace function public.tg_payments_recompute_balance()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.recompute_customer_balance(coalesce(new.customer_id, old.customer_id));
  return coalesce(new, old);
end $$;

drop trigger if exists trg_fees_balance     on public.monthly_fees;
drop trigger if exists trg_payments_balance on public.payments;
create trigger trg_fees_balance
  after insert or update or delete on public.monthly_fees
  for each row execute function public.tg_fees_recompute_balance();
create trigger trg_payments_balance
  after insert or update or delete on public.payments
  for each row execute function public.tg_payments_recompute_balance();

-- ------------------------------------------------------------
-- Customer codes (CUS-00001), created_by, phone normalisation.
-- The browser never sends customer_code; the database owns it.
-- ------------------------------------------------------------
create sequence if not exists public.customer_code_seq;

-- Never hand out a number that already exists (safe to re-run: only moves forward).
do $$
declare v_max bigint; v_cur bigint;
begin
  select coalesce(max(nullif(regexp_replace(customer_code, '\D', '', 'g'), '')::bigint), 0)
    into v_max from public.customers;
  select case when is_called then last_value else 0 end into v_cur from public.customer_code_seq;
  if v_max > v_cur then perform setval('public.customer_code_seq', v_max, true); end if;
end $$;

create or replace function public.tg_customers_prepare()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_phone text;
begin
  v_phone := public.normalize_phone(new.phone);
  if v_phone is null then
    raise exception 'Invalid phone number. Use a Pakistani mobile like 0300 1234567.' using errcode = '22023';
  end if;
  new.phone := v_phone;
  new.username := btrim(new.username);

  if tg_op = 'INSERT' then
    -- Staff (browser sessions that are not admin) cannot start a customer with
    -- money owing or a non-default status. SQL editor / service role are unaffected.
    if auth.role() = 'authenticated' and not public.is_admin() then
      new.opening_balance := 0;
      new.service_status  := 'on';
      new.customer_status := 'active';
    end if;
    if new.customer_code is null or btrim(new.customer_code) = '' then
      new.customer_code := 'CUS-' || lpad(nextval('public.customer_code_seq')::text, 5, '0');
    end if;
    if new.created_by is null then new.created_by := auth.uid(); end if;
    new.balance := new.opening_balance;
  else
    -- identity columns are immutable
    new.customer_code := old.customer_code;
    new.created_by    := old.created_by;
    -- editing the opening balance moves the running balance by the same amount
    if new.opening_balance is distinct from old.opening_balance then
      new.balance := old.balance - old.opening_balance + new.opening_balance;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_customers_prepare on public.customers;
create trigger trg_customers_prepare
  before insert or update on public.customers
  for each row execute function public.tg_customers_prepare();

create or replace function public.tg_employees_prepare()
returns trigger language plpgsql as $$
begin
  if new.phone is not null and btrim(new.phone) <> '' then
    new.phone := public.normalize_phone(new.phone);
    if new.phone is null then
      raise exception 'Invalid phone number.' using errcode = '22023';
    end if;
  else
    new.phone := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_employees_prepare on public.employees;
create trigger trg_employees_prepare
  before insert or update on public.employees
  for each row execute function public.tg_employees_prepare();

-- ------------------------------------------------------------
-- Column protection: staff cannot change financial or status
-- fields on customers, even if they bypass the UI. RLS is
-- row-level only; this is column-level.
-- ------------------------------------------------------------
create or replace function public.tg_customers_protect_columns()
returns trigger
language plpgsql
as $$
begin
  if public.is_trusted_session() or public.is_admin() then return new; end if;
  if new.balance          is distinct from old.balance
     or new.opening_balance is distinct from old.opening_balance
     or new.service_status is distinct from old.service_status
     or new.customer_status is distinct from old.customer_status
     or new.package_id     is distinct from old.package_id
     or new.area_id        is distinct from old.area_id
  then
    raise exception 'Staff cannot change balance, opening balance, service status, customer status, package or area'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_customers_protect on public.customers;
create trigger trg_customers_protect
  before update on public.customers
  for each row execute function public.tg_customers_protect_columns();

-- Staff may only work a complaint (status / notes), not re-point it.
create or replace function public.tg_complaints_protect_columns()
returns trigger
language plpgsql
as $$
begin
  if public.is_trusted_session() or public.is_admin() then return new; end if;
  if new.customer_id     is distinct from old.customer_id
     or new.complaint_text is distinct from old.complaint_text
     or new.category       is distinct from old.category
     or new.assigned_to    is distinct from old.assigned_to
     or new.created_by     is distinct from old.created_by
  then
    raise exception 'Staff can only change the status and resolution notes of a complaint'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_complaints_protect on public.complaints;
create trigger trg_complaints_protect
  before update on public.complaints
  for each row execute function public.tg_complaints_protect_columns();

-- An admin cannot lock themselves out (demote / deactivate self).
create or replace function public.tg_profiles_guard()
returns trigger
language plpgsql
as $$
begin
  if public.is_trusted_session() then return new; end if;
  if auth.uid() = old.id and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
    raise exception 'You cannot change your own role or active status' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_profiles_guard on public.profiles;
create trigger trg_profiles_guard
  before update on public.profiles
  for each row execute function public.tg_profiles_guard();

-- ------------------------------------------------------------
-- Account balances follow account_transactions (credit +, debit -).
-- ------------------------------------------------------------
create or replace function public.tg_account_tx_apply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.accounts
  set current_balance = current_balance
        + case when new.transaction_type = 'credit' then new.amount else -new.amount end
  where id = new.account_id;
  return new;
end $$;

drop trigger if exists trg_account_tx_apply on public.account_transactions;
create trigger trg_account_tx_apply
  after insert on public.account_transactions
  for each row execute function public.tg_account_tx_apply();

-- ------------------------------------------------------------
-- Block DELETE on financial tables entirely.
-- ------------------------------------------------------------
create or replace function public.tg_block_delete()
returns trigger language plpgsql as $$
begin
  raise exception 'Rows in % cannot be deleted. Reverse or deactivate instead.', tg_table_name
    using errcode = '42501';
end $$;

drop trigger if exists trg_payments_no_delete on public.payments;
drop trigger if exists trg_fees_no_delete     on public.monthly_fees;
drop trigger if exists trg_journal_no_delete  on public.journal_entries;
drop trigger if exists trg_audit_no_delete    on public.company_logs;
drop trigger if exists trg_acctx_no_delete    on public.account_transactions;
create trigger trg_payments_no_delete     before delete on public.payments     for each row execute function public.tg_block_delete();
create trigger trg_fees_no_delete         before delete on public.monthly_fees for each row execute function public.tg_block_delete();
create trigger trg_journal_no_delete      before delete on public.journal_entries for each row execute function public.tg_block_delete();
create trigger trg_audit_no_delete        before delete on public.company_logs for each row execute function public.tg_block_delete();
create trigger trg_acctx_no_delete        before delete on public.account_transactions for each row execute function public.tg_block_delete();

-- ------------------------------------------------------------
-- Audit log helper + triggers for key tables.
-- ------------------------------------------------------------
create or replace function public.tg_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_action text := lower(tg_op);
  v_entity_id text;
  v_details jsonb;
begin
  if tg_op = 'INSERT' then
    v_entity_id := (to_jsonb(new) ->> 'id');
    v_details := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_entity_id := (to_jsonb(new) ->> 'id');
    v_details := jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new));
  else
    v_entity_id := (to_jsonb(old) ->> 'id');
    v_details := to_jsonb(old);
  end if;

  insert into public.company_logs (actor_id, action, entity_type, entity_id, details)
  values (v_actor, tg_table_name || '.' || v_action, tg_table_name, v_entity_id, v_details);
  return coalesce(new, old);
end $$;

drop trigger if exists trg_audit_customers  on public.customers;
drop trigger if exists trg_audit_payments   on public.payments;
drop trigger if exists trg_audit_fees       on public.monthly_fees;
drop trigger if exists trg_audit_profiles   on public.profiles;
drop trigger if exists trg_audit_employees  on public.employees;
drop trigger if exists trg_audit_packages   on public.packages;
drop trigger if exists trg_audit_areas      on public.areas;
drop trigger if exists trg_audit_complaints on public.complaints;
drop trigger if exists trg_audit_templates  on public.sms_templates;
drop trigger if exists trg_audit_journal    on public.journal_entries;
drop trigger if exists trg_audit_accounts   on public.accounts;
create trigger trg_audit_customers  after insert on public.customers for each row execute function public.tg_audit();
-- Balance is recomputed automatically after every payment; don't log that as an edit.
drop trigger if exists trg_audit_customers_upd on public.customers;
create trigger trg_audit_customers_upd after update on public.customers for each row
  when ((to_jsonb(new) - 'balance' - 'updated_at') is distinct from (to_jsonb(old) - 'balance' - 'updated_at'))
  execute function public.tg_audit();
create trigger trg_audit_payments   after insert or update on public.payments     for each row execute function public.tg_audit();
create trigger trg_audit_fees       after insert or update on public.monthly_fees for each row execute function public.tg_audit();
create trigger trg_audit_profiles   after insert or update on public.profiles     for each row execute function public.tg_audit();
create trigger trg_audit_employees  after insert or update on public.employees    for each row execute function public.tg_audit();
create trigger trg_audit_packages   after insert or update on public.packages     for each row execute function public.tg_audit();
create trigger trg_audit_areas      after insert or update or delete on public.areas for each row execute function public.tg_audit();
create trigger trg_audit_complaints after insert or update on public.complaints   for each row execute function public.tg_audit();
create trigger trg_audit_templates  after insert or update on public.sms_templates for each row execute function public.tg_audit();
create trigger trg_audit_journal    after insert on public.journal_entries        for each row execute function public.tg_audit();
create trigger trg_audit_accounts   after insert on public.accounts               for each row execute function public.tg_audit();
