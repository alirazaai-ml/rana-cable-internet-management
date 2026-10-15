-- ============================================================
-- 20261015000004 - SECURITY: grants + row level security
-- ============================================================
--   admin : everything except deleting financial records
--   staff : customers, complaints they handle, their own payments
--   anon  : nothing (only health_check())
-- Money tables (monthly_fees, payments, sms_logs, company_logs) have no
-- browser write access: they change only through triggers and RPCs.
-- Safe to re-run.
-- ============================================================

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

-- Table privileges (RLS then narrows them per row)
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

grant select on all tables in schema public to authenticated;     -- tables + views

grant update                 on public.profiles             to authenticated;
grant insert, update, delete on public.areas                to authenticated;
grant insert, update         on public.packages             to authenticated;
grant insert, update         on public.employees            to authenticated;
grant insert, update         on public.customers            to authenticated;
grant insert, update         on public.complaints           to authenticated;
grant insert                 on public.journal_entries      to authenticated;
grant insert                 on public.accounts             to authenticated;
grant update (name, is_active) on public.accounts           to authenticated;
grant insert                 on public.account_transactions to authenticated;
grant insert, update         on public.sms_templates        to authenticated;

-- Function privileges: remove the default "everyone", grant what is needed.
revoke all on all functions in schema public from public, anon;
grant execute on function public.is_admin(), public.is_active_user(), public.is_trusted_session(),
                          public.is_bulk_load(), public.is_trusted_caller(), public.today_pk(), public.company_name(),
                          public.normalize_phone(text)                          to authenticated;
grant execute on function public.ensure_monthly_fees(date),
                          public.record_payment(bigint, bigint, numeric, text, text),
                          public.reverse_payment(bigint, text),
                          public.mark_whatsapp_sent(bigint),
                          public.admin_dashboard_stats(),
                          public.staff_dashboard_stats(),
                          public.fix_sequences(),
                          public.recompute_all_balances()                       to authenticated;
grant execute on function public.health_check()                                 to anon, authenticated;

-- ---------------- policies ----------------
-- profiles: your own row, or everything for an admin
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_admin());
create policy profiles_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- areas / packages: any active user reads, admin writes
create policy areas_select on public.areas for select to authenticated using (public.is_active_user());
create policy areas_write  on public.areas for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy packages_select on public.packages for select to authenticated using (public.is_active_user());
create policy packages_write  on public.packages for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- employees: admin sees all (salary!); staff see only their own row
create policy employees_select on public.employees for select to authenticated
  using (public.is_admin() or (profile_id = (select auth.uid()) and public.is_active_user()));
create policy employees_insert on public.employees for insert to authenticated with check (public.is_admin());
create policy employees_update on public.employees for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- customers: any active user (column limits are enforced by triggers)
create policy customers_select on public.customers for select to authenticated using (public.is_active_user());
create policy customers_insert on public.customers for insert to authenticated with check (public.is_active_user());
create policy customers_update on public.customers for update to authenticated
  using (public.is_active_user()) with check (public.is_active_user());

-- monthly_fees: read only
create policy fees_select on public.monthly_fees for select to authenticated using (public.is_active_user());

-- payments: admin sees all; staff see what they collected
create policy payments_select on public.payments for select to authenticated
  using (public.is_active_user() and (public.is_admin() or received_by = (select auth.uid())));

-- complaints: admin all; staff the ones they created or are assigned to
create policy complaints_select on public.complaints for select to authenticated
  using (public.is_active_user() and (public.is_admin()
         or created_by = (select auth.uid()) or assigned_to = (select auth.uid())));
create policy complaints_insert on public.complaints for insert to authenticated
  with check (public.is_active_user());                       -- created_by is stamped by trigger
create policy complaints_update on public.complaints for update to authenticated
  using (public.is_active_user() and (public.is_admin() or assigned_to = (select auth.uid()) or created_by = (select auth.uid())))
  with check (public.is_active_user() and (public.is_admin() or assigned_to = (select auth.uid()) or created_by = (select auth.uid())));

-- journal / accounts: admin only
create policy journal_select  on public.journal_entries      for select to authenticated using (public.is_admin());
create policy journal_insert  on public.journal_entries      for insert to authenticated with check (public.is_admin());
create policy accounts_select on public.accounts             for select to authenticated using (public.is_admin());
create policy accounts_insert on public.accounts             for insert to authenticated with check (public.is_admin() and current_balance = 0);
create policy accounts_update on public.accounts             for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy acctx_select    on public.account_transactions for select to authenticated using (public.is_admin());
create policy acctx_insert    on public.account_transactions for insert to authenticated with check (public.is_admin());

-- sms templates: admin only (record_payment reads them as definer)
create policy templates_select on public.sms_templates for select to authenticated using (public.is_admin());
create policy templates_write  on public.sms_templates for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- sms logs: admin all; staff their own. Writes: functions only
create policy sms_logs_select on public.sms_logs for select to authenticated
  using (public.is_active_user() and (public.is_admin() or sent_by = (select auth.uid())));

-- audit log: admin read-only
create policy logs_select on public.company_logs for select to authenticated using (public.is_admin());

-- Make PostgREST pick up the new objects immediately.
notify pgrst, 'reload schema';
