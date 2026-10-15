-- ============================================================
-- 0006 — Row Level Security + grants
-- ============================================================
-- Default stance: NOTHING is allowed unless a policy or a grant
-- says so. The browser only holds the public anon key; every
-- request is judged by these rules.
--
--   admin  : everything, except deleting financial records
--   staff  : customers, complaints they handle, their own payments
--   anon   : nothing (only health_check())
--
-- Money-moving writes (payments, fees, receipts, SMS logs, audit
-- log) have NO insert/update policy: they only happen through the
-- SECURITY DEFINER functions in 0005 and the triggers in 0004.
-- Safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Enable RLS on every table
-- ------------------------------------------------------------
alter table public.profiles             enable row level security;
alter table public.areas                enable row level security;
alter table public.packages             enable row level security;
alter table public.employees            enable row level security;
alter table public.customers            enable row level security;
alter table public.monthly_fees         enable row level security;
alter table public.payments             enable row level security;
alter table public.complaints           enable row level security;
alter table public.journal_entries      enable row level security;
alter table public.accounts             enable row level security;
alter table public.account_transactions enable row level security;
alter table public.sms_templates        enable row level security;
alter table public.sms_logs             enable row level security;
alter table public.company_logs         enable row level security;

-- ------------------------------------------------------------
-- 2. Table privileges (RLS then narrows these per row)
-- ------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

grant select on all tables in schema public to authenticated;   -- tables + views

grant update         on public.profiles             to authenticated;
grant insert, update, delete on public.areas        to authenticated;
grant insert, update on public.packages             to authenticated;
grant update         on public.employees            to authenticated;
grant insert, update on public.customers            to authenticated;
grant insert, update on public.complaints           to authenticated;
grant insert         on public.journal_entries      to authenticated;
grant insert         on public.accounts             to authenticated;
grant insert         on public.account_transactions to authenticated;
grant insert, update on public.sms_templates        to authenticated;

-- ------------------------------------------------------------
-- 3. Policies  ( (select auth.uid()) is evaluated once per query )
-- ------------------------------------------------------------

-- profiles: see your own row (so the app can tell you are inactive); admin sees/edits all.
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_admin());
create policy profiles_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- areas / packages: everyone active reads (forms need them); admin writes.
drop policy if exists areas_select    on public.areas;
drop policy if exists areas_write     on public.areas;
drop policy if exists packages_select on public.packages;
drop policy if exists packages_write  on public.packages;
create policy areas_select on public.areas for select to authenticated using (public.is_active_user());
create policy areas_write  on public.areas for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy packages_select on public.packages for select to authenticated using (public.is_active_user());
create policy packages_write  on public.packages for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- employees: admin sees everything (salary!); a staff member sees only their own record.
-- Dropdowns use the salary-free view public.employee_directory instead.
drop policy if exists employees_select on public.employees;
drop policy if exists employees_update on public.employees;
create policy employees_select on public.employees for select to authenticated
  using (public.is_admin() or (profile_id = (select auth.uid()) and public.is_active_user()));
create policy employees_update on public.employees for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- customers: any active user reads / creates / edits (column limits are in 0004).
drop policy if exists customers_select on public.customers;
drop policy if exists customers_insert on public.customers;
drop policy if exists customers_update on public.customers;
create policy customers_select on public.customers for select to authenticated using (public.is_active_user());
create policy customers_insert on public.customers for insert to authenticated with check (public.is_active_user());
create policy customers_update on public.customers for update to authenticated
  using (public.is_active_user()) with check (public.is_active_user());

-- monthly_fees: read only (created by ensure_monthly_fees()).
drop policy if exists fees_select on public.monthly_fees;
create policy fees_select on public.monthly_fees for select to authenticated using (public.is_active_user());

-- payments: admin sees all; staff see the payments they collected. Writes: functions only.
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select to authenticated
  using (public.is_active_user() and (public.is_admin() or received_by = (select auth.uid())));

-- complaints: admin all; staff the ones they created or are assigned to.
drop policy if exists complaints_select on public.complaints;
drop policy if exists complaints_insert on public.complaints;
drop policy if exists complaints_update on public.complaints;
create policy complaints_select on public.complaints for select to authenticated
  using (public.is_active_user() and (public.is_admin()
         or created_by = (select auth.uid()) or assigned_to = (select auth.uid())));
create policy complaints_insert on public.complaints for insert to authenticated
  with check (public.is_active_user() and created_by = (select auth.uid()));
create policy complaints_update on public.complaints for update to authenticated
  using (public.is_active_user() and (public.is_admin() or assigned_to = (select auth.uid())))
  with check (public.is_active_user() and (public.is_admin() or assigned_to = (select auth.uid())));

-- journal / accounts: admin only.
drop policy if exists journal_select  on public.journal_entries;
drop policy if exists journal_insert  on public.journal_entries;
drop policy if exists accounts_select on public.accounts;
drop policy if exists accounts_insert on public.accounts;
drop policy if exists acctx_select    on public.account_transactions;
drop policy if exists acctx_insert    on public.account_transactions;
create policy journal_select on public.journal_entries for select to authenticated using (public.is_admin());
create policy journal_insert on public.journal_entries for insert to authenticated
  with check (public.is_admin() and created_by = (select auth.uid()));
create policy accounts_select on public.accounts for select to authenticated using (public.is_admin());
create policy accounts_insert on public.accounts for insert to authenticated
  with check (public.is_admin() and current_balance = 0);   -- balances only move via transactions
create policy acctx_select on public.account_transactions for select to authenticated using (public.is_admin());
create policy acctx_insert on public.account_transactions for insert to authenticated
  with check (public.is_admin() and created_by = (select auth.uid()));

-- sms_templates: admin only (record_payment reads them as definer).
drop policy if exists templates_select on public.sms_templates;
drop policy if exists templates_write  on public.sms_templates;
create policy templates_select on public.sms_templates for select to authenticated using (public.is_admin());
create policy templates_write  on public.sms_templates for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- sms_logs: admin all; staff the messages they generated. Writes: functions only.
drop policy if exists sms_logs_select on public.sms_logs;
create policy sms_logs_select on public.sms_logs for select to authenticated
  using (public.is_active_user() and (public.is_admin() or sent_by = (select auth.uid())));

-- company_logs: admin read-only. Written by triggers.
drop policy if exists logs_select on public.company_logs;
create policy logs_select on public.company_logs for select to authenticated using (public.is_admin());
