-- ============================================================
-- 20261015000003 - API: views + RPC functions used by the app
-- ============================================================
-- Views run with the owner's rights on purpose (so a staff member sees
-- correct paid/remaining totals although RLS only lets them read their
-- own payments). Each view therefore filters on is_active_user() itself;
-- the SQL editor / service role (trusted session) can read them too.
-- ============================================================

-- Per-fee paid / remaining / status. Reversed payments are ignored.
-- Status precedence: paid > overdue > partial > unpaid.
create or replace view public.fee_balances as
select
  mf.id                                   as monthly_fee_id,
  mf.customer_id,
  mf.billing_month,
  mf.amount_due,
  mf.due_date,
  coalesce(sum(p.amount_paid) filter (where p.reversed_at is null), 0)::numeric(12,2) as total_paid,
  (mf.amount_due - coalesce(sum(p.amount_paid) filter (where p.reversed_at is null), 0))::numeric(12,2) as remaining,
  case
    when mf.amount_due - coalesce(sum(p.amount_paid) filter (where p.reversed_at is null), 0) <= 0 then 'paid'
    when mf.due_date < public.today_pk() then 'overdue'
    when coalesce(sum(p.amount_paid) filter (where p.reversed_at is null), 0) > 0 then 'partial'
    else 'unpaid'
  end                                     as status
from public.monthly_fees mf
left join public.payments p on p.monthly_fee_id = mf.id
where public.is_active_user() or public.is_trusted_session()
group by mf.id, mf.customer_id, mf.billing_month, mf.amount_due, mf.due_date;

-- One row per active customer with the current month's fee (Collections page).
create or replace view public.customer_fee_status as
select
  c.id as customer_id, c.customer_code, c.username, c.phone, c.area_id, c.package_id,
  c.customer_status, c.service_status, c.balance,
  fb.monthly_fee_id, fb.billing_month, fb.amount_due,
  coalesce(fb.total_paid, 0)::numeric(12,2) as total_paid,
  coalesce(fb.remaining, 0)::numeric(12,2)  as remaining,
  fb.status
from public.customers c
left join public.fee_balances fb
  on fb.customer_id = c.id
 and fb.billing_month = date_trunc('month', public.today_pk()::timestamp)::date
where c.customer_status = 'active'
  and (public.is_active_user() or public.is_trusted_session());

-- Total outstanding per customer (opening balance + unpaid fees).
create or replace view public.customer_balances as
select
  c.id as customer_id, c.customer_code, c.username, c.phone, c.area_id, c.opening_balance,
  coalesce(sum(fb.remaining) filter (where fb.remaining > 0), 0)::numeric(12,2) as unpaid_invoices,
  (c.opening_balance + coalesce(sum(fb.remaining) filter (where fb.remaining > 0), 0))::numeric(12,2) as total_outstanding
from public.customers c
left join public.fee_balances fb on fb.customer_id = c.id
where public.is_active_user() or public.is_trusted_session()
group by c.id, c.customer_code, c.username, c.phone, c.area_id, c.opening_balance;

-- Salary-free employee list for dropdowns.
create or replace view public.employee_directory as
select e.id, e.full_name, e.area_id, e.is_active, e.profile_id, e.role_title, e.joined_at
from public.employees e
where public.is_active_user() or public.is_trusted_session();

-- ------------------------------------------------------------
-- ensure_monthly_fees(month): one fee per active customer. Idempotent.
-- Customers are only billed from their join month onward.
-- ------------------------------------------------------------
create or replace function public.ensure_monthly_fees(p_month date)
returns integer language plpgsql security definer set search_path = public
as $$
declare
  v_month date := date_trunc('month', p_month::timestamp)::date;
  v_end   date := (date_trunc('month', p_month::timestamp) + interval '1 month - 1 day')::date;
  v_count integer;
begin
  if not (public.is_active_user() or public.is_trusted_caller()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if v_month > date_trunc('month', public.today_pk()::timestamp)::date then
    raise exception 'Cannot create fees for a future month' using errcode = '22023';
  end if;

  insert into public.monthly_fees (customer_id, billing_month, package_id)
  select c.id, v_month, c.package_id
  from public.customers c
  where c.customer_status = 'active' and c.join_date <= v_end
  on conflict (customer_id, billing_month) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ------------------------------------------------------------
-- record_payment - used by the Collections screen.
-- The money rules live in the payments trigger; this adds the
-- WhatsApp message log and returns what the screen needs.
-- ------------------------------------------------------------
create or replace function public.record_payment(
  p_customer_id    bigint,
  p_monthly_fee_id bigint,
  p_amount         numeric,
  p_method         text,
  p_notes          text default null
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_fee      record;
  v_customer record;
  v_pay      record;
  v_after    numeric;
  v_template text;
  v_message  text;
  v_sms_id   bigint;
begin
  if not public.is_active_user() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than zero' using errcode = '22023';
  end if;
  if p_method is null or p_method not in ('cash','bank_transfer','other') then
    raise exception 'Invalid payment method' using errcode = '22023';
  end if;

  select * into v_fee from public.monthly_fees where id = p_monthly_fee_id and customer_id = p_customer_id;
  if not found then
    raise exception 'Monthly fee not found for this customer' using errcode = 'P0002';
  end if;

  insert into public.payments (customer_id, monthly_fee_id, amount_paid, payment_method, notes)
  values (p_customer_id, p_monthly_fee_id, p_amount, p_method, p_notes)
  returning id, receipt_number into v_pay;

  select id, username, phone, balance into v_customer from public.customers where id = p_customer_id;

  select v_fee.amount_due - coalesce(sum(amount_paid), 0) into v_after
  from public.payments where monthly_fee_id = p_monthly_fee_id and reversed_at is null;

  select template_text into v_template
  from public.sms_templates where lower(name) = 'payment received' and is_active limit 1;

  if v_template is not null then
    v_message := v_template;
    v_message := replace(v_message, '{{customer_name}}',  v_customer.username);
    v_message := replace(v_message, '{{amount}}',         to_char(p_amount, 'FM999999990.00'));
    v_message := replace(v_message, '{{month}}',          to_char(v_fee.billing_month, 'FMMonth YYYY'));
    v_message := replace(v_message, '{{remaining}}',      to_char(v_after, 'FM999999990.00'));
    v_message := replace(v_message, '{{balance}}',        to_char(v_customer.balance, 'FM999999990.00'));
    v_message := replace(v_message, '{{receipt_number}}', v_pay.receipt_number);
    v_message := replace(v_message, '{{company_name}}',   public.company_name());

    insert into public.sms_logs (customer_id, phone, message_text, status, provider, sent_by, related_payment_id)
    values (p_customer_id, v_customer.phone, v_message, 'pending', 'whatsapp_manual', auth.uid(), v_pay.id)
    returning id into v_sms_id;
  end if;

  return jsonb_build_object(
    'payment_id', v_pay.id, 'receipt_number', v_pay.receipt_number,
    'sms_log_id', v_sms_id, 'message', v_message, 'phone', v_customer.phone);
end $$;

-- reverse_payment - admin only. The trigger posts the opposite journal / account entries.
create or replace function public.reverse_payment(p_payment_id bigint, p_reason text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can reverse a payment' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reversal reason is required' using errcode = '22023';
  end if;

  update public.payments
  set reversed_at = now(), reversed_by = auth.uid(), reversal_reason = btrim(p_reason)
  where id = p_payment_id and reversed_at is null;

  if not found then
    raise exception 'Payment not found or already reversed' using errcode = 'P0002';
  end if;
end $$;

-- mark_whatsapp_sent - staff confirm a message went out.
create or replace function public.mark_whatsapp_sent(p_sms_log_id bigint)
returns void language plpgsql security definer set search_path = public
as $$
declare v_payment_id bigint;
begin
  if not public.is_active_user() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  update public.sms_logs set status = 'sent', sent_at = now()
  where id = p_sms_log_id and (sent_by = auth.uid() or public.is_admin())
  returning related_payment_id into v_payment_id;

  if not found then
    raise exception 'Message not found' using errcode = 'P0002';
  end if;

  update public.payments set whatsapp_sent = true, whatsapp_sent_at = now() where id = v_payment_id;
end $$;

-- ------------------------------------------------------------
-- Dashboards (one round trip each)
-- ------------------------------------------------------------
create or replace function public.admin_dashboard_stats()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare v_month date := date_trunc('month', public.today_pk()::timestamp)::date;
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
        where p.reversed_at is null order by p.created_at desc, p.id desc limit 5) x), '[]'::jsonb),
    'recent_customers',   coalesce((
      select jsonb_agg(x) from (
        select id, customer_code, username, created_at
        from public.customers order by created_at desc, id desc limit 5) x), '[]'::jsonb),
    'customers_per_area', coalesce((
      select jsonb_agg(x) from (
        select a.name as name, count(c.id) as count
        from public.areas a left join public.customers c on c.area_id = a.id
        group by a.id, a.name order by a.name) x), '[]'::jsonb),
    'collections_per_employee', coalesce((
      select jsonb_agg(x) from (
        select pr.full_name as name, sum(p.amount_paid) as total
        from public.payments p join public.profiles pr on pr.id = p.received_by
        where p.reversed_at is null and p.payment_date >= v_month
        group by pr.id, pr.full_name order by total desc) x), '[]'::jsonb)
  );
end $$;

create or replace function public.staff_dashboard_stats()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v_today date := public.today_pk();
  v_month date := date_trunc('month', public.today_pk()::timestamp)::date;
  v_emp_id bigint; v_area_id bigint; v_area_name text;
begin
  if not public.is_active_user() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select e.id, e.area_id, a.name into v_emp_id, v_area_id, v_area_name
  from public.employees e left join public.areas a on a.id = e.area_id
  where e.profile_id = auth.uid();

  return jsonb_build_object(
    'today_collections', coalesce((select sum(amount_paid) from public.payments
                                   where received_by = auth.uid() and reversed_at is null and payment_date = v_today), 0),
    'month_collections', coalesce((select sum(amount_paid) from public.payments
                                   where received_by = auth.uid() and reversed_at is null and payment_date >= v_month), 0),
    'my_customers',      (select count(*) from public.customers where seller_id = v_emp_id),
    'area_outstanding',  coalesce((select sum(balance) from public.customers
                                   where area_id = v_area_id and balance > 0), 0),
    'area_name',         v_area_name
  );
end $$;

-- ------------------------------------------------------------
-- Maintenance helpers (admin / SQL editor)
-- ------------------------------------------------------------
-- After importing rows that carry their own ids, move every id counter
-- past the highest existing id so new rows never collide.
create or replace function public.fix_sequences()
returns text language plpgsql security definer set search_path = public
as $$
declare r record; v_max bigint; v_n integer := 0;
begin
  if not (public.is_trusted_caller() or public.is_admin()) then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  for r in
    select c.table_name, c.column_name, pg_get_serial_sequence('public.' || quote_ident(c.table_name), c.column_name) as seq
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.is_identity = 'YES'
  loop
    continue when r.seq is null;
    execute format('select coalesce(max(%I), 0) from public.%I', r.column_name, r.table_name) into v_max;
    perform setval(r.seq, greatest(v_max, 1), v_max > 0);
    v_n := v_n + 1;
  end loop;

  select coalesce(max(nullif(regexp_replace(customer_code, '\D', '', 'g'), '')::bigint), 0) into v_max from public.customers;
  perform setval('public.customer_code_seq', greatest(v_max, 1), v_max > 0);
  return v_n || ' id sequences and the customer code sequence were synchronised';
end $$;

-- Cheap ping that keeps a free-tier project awake.
create or replace function public.health_check()
returns jsonb language sql stable
as $$ select jsonb_build_object('ok', true) $$;
