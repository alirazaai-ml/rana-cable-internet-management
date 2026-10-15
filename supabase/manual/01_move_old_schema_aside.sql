-- ============================================================
-- STEP 1 of 3 (only for a project that already has the OLD schema)
-- Moves the old tables - with all their data - into a schema called
-- "old_backup" and removes the old views / functions / triggers /
-- policies, so the new schema can be created cleanly.
-- Nothing is deleted. On a brand-new project this script does nothing.
-- ============================================================
do $$
declare
  t text; f record;
  tables text[] := array['profiles','areas','packages','employees','customers','monthly_fees','payments',
                         'complaints','journal_entries','accounts','account_transactions',
                         'sms_templates','sms_logs','company_logs'];
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'customers' and column_name = 'join_date') then
    raise exception 'The new database schema is already installed - nothing to rebuild.';
  end if;

  -- Views first (they depend on the tables and functions).
  drop view if exists public.customer_fee_status cascade;
  drop view if exists public.customer_balances   cascade;
  drop view if exists public.fee_balances        cascade;
  drop view if exists public.employee_directory  cascade;

  -- The old functions (this also removes the triggers and RLS policies that use them).
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
      and p.proname in ('today_pk','is_admin','is_active_user','is_trusted_session','is_trusted_caller','is_bulk_load',
        'company_name','normalize_phone','recompute_customer_balance','recompute_all_balances','generate_receipt_number',
        'ensure_monthly_fees','record_payment','reverse_payment','mark_whatsapp_sent','admin_dashboard_stats',
        'staff_dashboard_stats','health_check','fix_sequences')
         or (p.pronamespace = 'public'::regnamespace and p.proname like 'tg\_%')
  loop
    execute 'drop function ' || f.sig || ' cascade';
  end loop;
  drop sequence if exists public.customer_code_seq;

  -- Move the tables (with their data, indexes and constraints).
  create schema if not exists old_backup;
  foreach t in array tables loop
    if to_regclass('public.' || t) is not null then
      if to_regclass('old_backup.' || t) is not null then
        raise notice 'old_backup.% already exists - leaving public.% alone', t, t;
      else
        execute format('alter table public.%I set schema old_backup', t);
        raise notice 'moved public.% to old_backup.%', t, t;
      end if;
    end if;
  end loop;
end $$;
