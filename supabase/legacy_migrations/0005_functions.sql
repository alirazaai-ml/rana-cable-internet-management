-- ============================================================
-- 0005 — Business functions
-- ============================================================
-- record_payment, reverse_payment, ensure_monthly_fees,
-- mark_whatsapp_sent, generate_receipt_number,
-- admin_dashboard_stats, staff_dashboard_stats, health_check.
-- All SECURITY DEFINER (except health_check) so they can write to
-- protected tables. Each one re-checks the caller itself.
-- ============================================================

-- ------------------------------------------------------------
-- Receipt numbers: RCP-YYYY-NNNNNN, sequential per year.
-- A transaction-level advisory lock serialises concurrent callers so
-- two simultaneous payments (on different invoices) can never be
-- handed the same number.
-- ------------------------------------------------------------
create or replace function public.generate_receipt_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year text := to_char(public.today_pk(), 'YYYY');
  v_next int;
begin
  perform pg_advisory_xact_lock(hashtext('icrms.receipt_number'));

  select coalesce(max(
    nullif(regexp_replace(receipt_number, '^RCP-\d{4}-', ''), '')::int
  ), 0) + 1
  into v_next
  from public.payments
  where receipt_number like 'RCP-' || v_year || '-%';

  return 'RCP-' || v_year || '-' || lpad(v_next::text, 6, '0');
end $$;

-- ------------------------------------------------------------
-- ensure_monthly_fees — creates one invoice per active customer
-- for the given month. Idempotent: re-running creates nothing.
-- Future months are refused so nobody can pre-bill customers.
-- ------------------------------------------------------------
create or replace function public.ensure_monthly_fees(p_month date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_due   date := (date_trunc('month', p_month) + interval '9 days')::date;
  v_count integer := 0;
begin
  if not public.is_active_user() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if v_month > date_trunc('month', public.today_pk())::date then
    raise exception 'Cannot create fees for a future month' using errcode = '22023';
  end if;

  insert into public.monthly_fees (customer_id, billing_month, amount_due, due_date, package_id, created_by)
  select
    c.id, v_month, p.monthly_fee, v_due, c.package_id, auth.uid()
  from public.customers c
  join public.packages p on p.id = c.package_id
  where c.customer_status = 'active'
  on conflict (customer_id, billing_month) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ------------------------------------------------------------
-- record_payment — the ONLY way a payment is created.
-- Locks the invoice row so two simultaneous payments cannot
-- overpay. Writes payment, receipt, WhatsApp message log, the
-- journal income entry and the account credit, all in one
-- transaction.
-- Returns JSON with payment_id, receipt_number, sms_log_id,
-- message, phone.
-- ------------------------------------------------------------
create or replace function public.record_payment(
  p_customer_id    bigint,
  p_monthly_fee_id bigint,
  p_amount         numeric,
  p_method         text,
  p_notes          text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fee        record;
  v_customer   record;
  v_paid       numeric;
  v_remaining  numeric;
  v_receipt    text;
  v_payment_id bigint;
  v_template   text;
  v_message    text;
  v_sms_id     bigint;
  v_account_id bigint;
begin
  if not public.is_active_user() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than zero' using errcode = '22023';
  end if;
  if p_method is null or p_method not in ('cash', 'bank_transfer', 'other') then
    raise exception 'Invalid payment method' using errcode = '22023';
  end if;

  -- Lock the invoice row for the duration of the transaction.
  select * into v_fee
  from public.monthly_fees
  where id = p_monthly_fee_id and customer_id = p_customer_id
  for update;

  if not found then
    raise exception 'Invoice not found for this customer' using errcode = 'P0002';
  end if;

  -- Compute remaining at this instant, inside the lock.
  select coalesce(sum(amount_paid), 0) into v_paid
  from public.payments
  where monthly_fee_id = p_monthly_fee_id and reversed_at is null;

  v_remaining := v_fee.amount_due - v_paid;

  if v_remaining <= 0 then
    raise exception 'This fee is already fully paid' using errcode = '22023';
  end if;
  if p_amount > v_remaining then
    raise exception 'Payment exceeds the remaining balance (Rs. %)', v_remaining
      using errcode = '22023';
  end if;

  select id, username, phone, area_id into v_customer
  from public.customers where id = p_customer_id;

  v_receipt := public.generate_receipt_number();

  insert into public.payments (
    customer_id, monthly_fee_id, amount_paid, payment_method,
    payment_date, received_by, receipt_number, notes
  ) values (
    p_customer_id, p_monthly_fee_id, p_amount, p_method,
    public.today_pk(), auth.uid(), v_receipt, nullif(btrim(p_notes), '')
  ) returning id into v_payment_id;

  -- Cash book + account: income for the business.
  insert into public.journal_entries (
    entry_date, entry_type, category, amount, description, reference_payment_id, created_by
  ) values (
    public.today_pk(), 'income', 'Fee collection', p_amount,
    'Receipt ' || v_receipt || ' - ' || v_customer.username, v_payment_id, auth.uid()
  );

  select id into v_account_id
  from public.accounts
  where is_active and account_type = case when p_method = 'bank_transfer' then 'bank' else 'cash' end
  order by id limit 1;

  if v_account_id is not null then
    insert into public.account_transactions (
      account_id, transaction_type, amount, description, reference_payment_id, created_by
    ) values (
      v_account_id, 'credit', p_amount, 'Receipt ' || v_receipt, v_payment_id, auth.uid()
    );
  end if;

  -- Render the active "Payment Received" template.
  select template_text into v_template
  from public.sms_templates
  where name = 'Payment Received' and is_active = true
  limit 1;

  if v_template is not null then
    v_message := v_template;
    v_message := replace(v_message, '{{customer_name}}',   v_customer.username);
    v_message := replace(v_message, '{{amount}}',          to_char(p_amount, 'FM999999990.00'));
    v_message := replace(v_message, '{{month}}',           to_char(v_fee.billing_month, 'FMMonth YYYY'));
    v_message := replace(v_message, '{{remaining}}',       to_char(v_remaining - p_amount, 'FM999999990.00'));
    v_message := replace(v_message, '{{balance}}',
      to_char((select balance from public.customers where id = p_customer_id), 'FM999999990.00'));
    v_message := replace(v_message, '{{receipt_number}}',  v_receipt);
    v_message := replace(v_message, '{{company_name}}',    public.company_name());

    insert into public.sms_logs (
      customer_id, phone, message_text, status, provider,
      sent_by, related_payment_id
    ) values (
      p_customer_id, v_customer.phone, v_message, 'pending', 'whatsapp_manual',
      auth.uid(), v_payment_id
    ) returning id into v_sms_id;
  end if;

  return jsonb_build_object(
    'payment_id',     v_payment_id,
    'receipt_number', v_receipt,
    'sms_log_id',     v_sms_id,
    'message',        v_message,
    'phone',          v_customer.phone
  );
end $$;

-- ------------------------------------------------------------
-- reverse_payment — admin only. Sets reversed_at so the
-- payment is excluded from all sums. Never deletes. Posts the
-- opposite journal entry and account debit.
-- ------------------------------------------------------------
create or replace function public.reverse_payment(p_payment_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay        record;
  v_account_id bigint;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can reverse a payment' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reversal reason is required' using errcode = '22023';
  end if;

  update public.payments
  set reversed_at = now(), reversed_by = auth.uid(), reversal_reason = btrim(p_reason)
  where id = p_payment_id and reversed_at is null
  returning * into v_pay;

  if not found then
    raise exception 'Payment not found or already reversed' using errcode = 'P0002';
  end if;

  insert into public.journal_entries (
    entry_date, entry_type, category, amount, description, reference_payment_id, created_by
  ) values (
    public.today_pk(), 'expense', 'Payment reversal', v_pay.amount_paid,
    'Reversed receipt ' || v_pay.receipt_number || ': ' || btrim(p_reason), v_pay.id, auth.uid()
  );

  select account_id into v_account_id
  from public.account_transactions
  where reference_payment_id = v_pay.id and transaction_type = 'credit'
  order by id limit 1;

  if v_account_id is not null then
    insert into public.account_transactions (
      account_id, transaction_type, amount, description, reference_payment_id, created_by
    ) values (
      v_account_id, 'debit', v_pay.amount_paid, 'Reversal of ' || v_pay.receipt_number, v_pay.id, auth.uid()
    );
  end if;
end $$;

-- ------------------------------------------------------------
-- mark_whatsapp_sent — called when staff confirms the message
-- was sent from WhatsApp. Staff can only mark their own messages.
-- ------------------------------------------------------------
create or replace function public.mark_whatsapp_sent(p_sms_log_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_payment_id bigint;
begin
  if not public.is_active_user() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  update public.sms_logs
  set status = 'sent', sent_at = now()
  where id = p_sms_log_id and (sent_by = auth.uid() or public.is_admin())
  returning related_payment_id into v_payment_id;

  if not found then
    raise exception 'Message not found' using errcode = 'P0002';
  end if;

  update public.payments
  set whatsapp_sent = true, whatsapp_sent_at = now()
  where id = v_payment_id;
end $$;

-- ------------------------------------------------------------
-- admin_dashboard_stats — one round trip for the admin home page.
-- ------------------------------------------------------------
create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_month date := date_trunc('month', public.today_pk())::date;
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'total_customers',    (select count(*) from public.customers),
    'active_customers',   (select count(*) from public.customers where customer_status = 'active'),
    'inactive_customers', (select count(*) from public.customers where customer_status = 'inactive'),
    'month_collections',  coalesce((select sum(amount_paid) from public.payments
                                    where reversed_at is null and payment_date >= v_month), 0),
    'outstanding_total',  coalesce((select sum(balance) from public.customers where balance > 0), 0),
    'unpaid_count',       (select count(*) from public.fee_balances where billing_month = v_month and status = 'unpaid'),
    'partial_count',      (select count(*) from public.fee_balances where billing_month = v_month and status = 'partial'),
    'overdue_count',      (select count(*) from public.fee_balances where billing_month = v_month and status = 'overdue'),
    'recent_payments',    coalesce((
      select jsonb_agg(x) from (
        select p.id, p.amount_paid, p.payment_date, p.receipt_number, c.username as customer_name
        from public.payments p join public.customers c on c.id = p.customer_id
        where p.reversed_at is null
        order by p.created_at desc limit 5
      ) x), '[]'::jsonb),
    'recent_customers',   coalesce((
      select jsonb_agg(x) from (
        select id, customer_code, username, created_at
        from public.customers order by created_at desc, id desc limit 5
      ) x), '[]'::jsonb),
    'customers_per_area', coalesce((
      select jsonb_agg(x) from (
        select a.name::text as name, count(c.id) as count
        from public.areas a left join public.customers c on c.area_id = a.id
        group by a.id, a.name order by a.name
      ) x), '[]'::jsonb),
    'collections_per_employee', coalesce((
      select jsonb_agg(x) from (
        select pr.full_name as name, sum(p.amount_paid) as total
        from public.payments p join public.profiles pr on pr.id = p.received_by
        where p.reversed_at is null and p.payment_date >= v_month
        group by pr.id, pr.full_name order by total desc
      ) x), '[]'::jsonb)
  );
end $$;

-- ------------------------------------------------------------
-- staff_dashboard_stats — the logged-in staff member's numbers.
-- ------------------------------------------------------------
create or replace function public.staff_dashboard_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := public.today_pk();
  v_month date := date_trunc('month', public.today_pk())::date;
  v_emp   record;
begin
  if not public.is_active_user() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select e.id, e.area_id, a.name::text as area_name into v_emp
  from public.employees e left join public.areas a on a.id = e.area_id
  where e.profile_id = auth.uid();

  return jsonb_build_object(
    'today_collections', coalesce((select sum(amount_paid) from public.payments
                                   where received_by = auth.uid() and reversed_at is null and payment_date = v_today), 0),
    'month_collections', coalesce((select sum(amount_paid) from public.payments
                                   where received_by = auth.uid() and reversed_at is null and payment_date >= v_month), 0),
    'my_customers',      (select count(*) from public.customers where seller_id = v_emp.id),
    'area_outstanding',  coalesce((select sum(balance) from public.customers
                                   where area_id = v_emp.area_id and balance > 0), 0),
    'area_name',         v_emp.area_name
  );
end $$;

-- ------------------------------------------------------------
-- health_check — cheap public ping (keeps a free-tier project awake
-- via the scheduled GitHub Action). Reveals nothing.
-- ------------------------------------------------------------
create or replace function public.health_check()
returns jsonb
language sql
stable
as $$ select jsonb_build_object('ok', true) $$;

-- ------------------------------------------------------------
-- Grants — only authenticated users may call these.
-- (Postgres grants EXECUTE to PUBLIC by default; remove that.)
-- ------------------------------------------------------------
revoke all on function public.generate_receipt_number()                       from public, anon, authenticated;
revoke all on function public.recompute_customer_balance(bigint)              from public, anon, authenticated;
revoke all on function public.ensure_monthly_fees(date)                       from public, anon;
revoke all on function public.record_payment(bigint,bigint,numeric,text,text) from public, anon;
revoke all on function public.reverse_payment(bigint,text)                    from public, anon;
revoke all on function public.mark_whatsapp_sent(bigint)                      from public, anon;
revoke all on function public.admin_dashboard_stats()                         from public, anon;
revoke all on function public.staff_dashboard_stats()                         from public, anon;
revoke all on function public.health_check()                                  from public;

grant execute on function public.ensure_monthly_fees(date)                       to authenticated;
grant execute on function public.record_payment(bigint,bigint,numeric,text,text) to authenticated;
grant execute on function public.reverse_payment(bigint,text)                    to authenticated;
grant execute on function public.mark_whatsapp_sent(bigint)                      to authenticated;
grant execute on function public.admin_dashboard_stats()                         to authenticated;
grant execute on function public.staff_dashboard_stats()                         to authenticated;
grant execute on function public.health_check()                                  to anon, authenticated;
