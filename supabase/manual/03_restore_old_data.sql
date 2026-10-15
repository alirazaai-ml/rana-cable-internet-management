-- ============================================================
-- STEP 3 of 3 - copy the data from old_backup into the new tables
-- Safe to run when old_backup does not exist (it just says so).
-- Runs in ONE transaction with automatic side-effects switched off
-- (app.bulk_load), so your journal, account balances and audit log are
-- copied exactly as they were - nothing is posted twice.
-- Afterwards: id counters are fixed and every balance is recomputed.
-- ============================================================
do $$
declare n bigint;
begin
  if to_regclass('old_backup.customers') is null then
    raise notice 'No old_backup schema found - nothing to restore.';
    return;
  end if;
  if exists (select 1 from public.customers) then
    raise notice 'public.customers already has rows - restore skipped to avoid duplicates.';
    return;
  end if;

  perform set_config('app.bulk_load', 'on', true);       -- transaction-local

  -- Seed rows (and their audit entries) from the migration are replaced by your real ones.
  truncate table public.company_logs;
  delete from public.sms_templates;
  delete from public.accounts;
  delete from public.packages;
  delete from public.areas;

  insert into public.profiles (id, full_name, role, is_active, created_at, updated_at)
    select id, full_name, role, is_active, created_at, updated_at from old_backup.profiles
    where id in (select id from auth.users);

  insert into public.areas (id, name, description, created_at)
    select id, name::text, description, created_at from old_backup.areas order by id;

  insert into public.packages (id, name, speed_label, monthly_fee, description, is_active, created_at, updated_at)
    select id, name, speed_label, monthly_fee, description, is_active, created_at, updated_at from old_backup.packages order by id;

  insert into public.employees (id, profile_id, full_name, phone, role_title, area_id, monthly_salary, is_active, joined_at, created_at, updated_at)
    select id, case when profile_id in (select id from public.profiles) then profile_id end,
           full_name, phone, role_title, area_id, monthly_salary, is_active, joined_at, created_at, updated_at
    from old_backup.employees order by id;

  insert into public.customers (id, customer_code, username, phone, package_id, area_id, seller_id, address,
                                opening_balance, balance, service_status, customer_status, cnic, father_name, notes,
                                join_date, created_by, created_at, updated_at)
    select c.id, c.customer_code, c.username, c.phone, c.package_id, c.area_id, c.seller_id, c.address,
           c.opening_balance, c.balance, c.service_status, c.customer_status, c.cnic, c.father_name, c.notes,
           least((c.created_at at time zone 'Asia/Karachi')::date,
                 coalesce((select min(f.billing_month) from old_backup.monthly_fees f where f.customer_id = c.id),
                          (c.created_at at time zone 'Asia/Karachi')::date)),
           case when c.created_by in (select id from public.profiles) then c.created_by end,
           c.created_at, c.updated_at
    from old_backup.customers c order by c.id;

  insert into public.monthly_fees (id, customer_id, billing_month, amount_due, due_date, package_id, created_by, created_at)
    select id, customer_id, billing_month, amount_due, due_date, package_id,
           case when created_by in (select id from public.profiles) then created_by end, created_at
    from old_backup.monthly_fees order by id;

  insert into public.payments (id, customer_id, monthly_fee_id, amount_paid, payment_method, payment_date, received_by,
                               receipt_number, notes, reversed_at, reversed_by, reversal_reason, whatsapp_sent,
                               whatsapp_sent_at, created_at)
    select id, customer_id, monthly_fee_id, amount_paid, payment_method, payment_date,
           case when received_by in (select id from public.profiles) then received_by end,
           receipt_number, notes, reversed_at,
           case when reversed_by in (select id from public.profiles) then reversed_by end,
           reversal_reason, whatsapp_sent, whatsapp_sent_at, created_at
    from old_backup.payments order by id;

  insert into public.accounts (id, name, account_type, current_balance, is_active, created_at)
    select id, name, account_type, current_balance, is_active, created_at from old_backup.accounts order by id;

  insert into public.account_transactions (id, account_id, transaction_type, amount, description, reference_payment_id, created_by, created_at)
    select id, account_id, transaction_type, amount, description, reference_payment_id,
           case when created_by in (select id from public.profiles) then created_by end, created_at
    from old_backup.account_transactions order by id;

  insert into public.journal_entries (id, entry_date, entry_type, category, amount, description, reference_payment_id, created_by, created_at)
    select id, entry_date, entry_type, category, amount, description, reference_payment_id,
           case when created_by in (select id from public.profiles) then created_by end, created_at
    from old_backup.journal_entries order by id;

  insert into public.complaints (id, customer_id, complaint_text, category, status, assigned_to, resolution_notes, created_by, created_at, resolved_at)
    select id, customer_id, complaint_text, category, status,
           case when assigned_to in (select id from public.profiles) then assigned_to end,
           resolution_notes,
           case when created_by in (select id from public.profiles) then created_by end,
           created_at, resolved_at
    from old_backup.complaints order by id;

  insert into public.sms_templates (id, name, template_text, is_active, created_at, updated_at)
    select id, name, template_text, is_active, created_at, updated_at from old_backup.sms_templates order by id;

  insert into public.sms_logs (id, customer_id, phone, message_text, status, provider, error_message, sent_by, related_payment_id, created_at, sent_at)
    select id, customer_id, phone, message_text, status, provider, error_message,
           case when sent_by in (select id from public.profiles) then sent_by end,
           related_payment_id, created_at, sent_at
    from old_backup.sms_logs order by id;

  insert into public.company_logs (id, actor_id, action, entity_type, entity_id, details, created_at)
    select id, case when actor_id in (select id from public.profiles) then actor_id end,
           action, entity_type, entity_id, details, created_at
    from old_backup.company_logs order by id;

  perform public.fix_sequences();
  select public.recompute_all_balances() into n;

  raise notice 'Restore finished: % customers, % fees, % payments, % complaints.',
    (select count(*) from public.customers), (select count(*) from public.monthly_fees),
    (select count(*) from public.payments),  (select count(*) from public.complaints);
  raise notice 'Check the app, then you may run:  drop schema old_backup cascade;';
end $$;
