-- ============================================================
-- 0008 — Dashboard RPCs
-- ============================================================
-- Returns a single JSON object with all dashboard values.
-- SECURITY DEFINER so it can read across tables regardless of
-- the caller's column-level permissions. Both functions verify
-- the caller's role at the top.
-- ============================================================

-- ------------------------------------------------------------
-- admin_dashboard_stats()
-- ------------------------------------------------------------
create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_month_start date := date_trunc('month', current_date)::date;
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can view this dashboard' using errcode = '42501';
  end if;

  select jsonb_build_object(
    -- ---- Counters ----
    'total_customers',    (select count(*) from public.customers),
    'active_customers',   (select count(*) from public.customers where customer_status = 'active'),
    'inactive_customers', (select count(*) from public.customers where customer_status = 'inactive'),

    -- ---- Money (this month) ----
    'month_collections', coalesce((
      select sum(amount_paid) from public.payments
      where reversed_at is null
        and payment_date >= v_month_start
        and payment_date <  v_month_start + interval '1 month'
    ), 0),

    -- ---- Outstanding across all customers ----
    'outstanding_total', coalesce((
      select sum(balance) from public.customers where balance > 0
    ), 0),

    -- ---- Invoice status counts for the current month ----
    'unpaid_count',  (
      select count(*) from public.fee_balances
      where billing_month = v_month_start and status = 'unpaid'
    ),
    'partial_count', (
      select count(*) from public.fee_balances
      where billing_month = v_month_start and status = 'partial'
    ),
    'overdue_count', (
      select count(*) from public.fee_balances
      where billing_month = v_month_start and status = 'overdue'
    ),

    -- ---- Recent payments ----
    'recent_payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',             p.id,
        'amount_paid',    p.amount_paid,
        'payment_date',   p.payment_date,
        'receipt_number', p.receipt_number,
        'customer_name',  c.username
      ) order by p.created_at desc)
      from (
        select * from public.payments
        where reversed_at is null
        order by created_at desc
        limit 10
      ) p
      join public.customers c on c.id = p.customer_id
    ), '[]'::jsonb),

    -- ---- Recent registrations ----
    'recent_customers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',            c.id,
        'customer_code', c.customer_code,
        'username',      c.username,
        'created_at',    c.created_at
      ) order by c.created_at desc)
      from (
        select * from public.customers
        order by created_at desc
        limit 10
      ) c
    ), '[]'::jsonb),

    -- ---- Customers per area ----
    'customers_per_area', coalesce((
      select jsonb_agg(jsonb_build_object('name', a.name, 'count', cnt) order by a.name)
      from (
        select a.id, a.name, count(c.id)::int as cnt
        from public.areas a
        left join public.customers c on c.area_id = a.id
        group by a.id, a.name
      ) a
    ), '[]'::jsonb),

    -- ---- Collections per employee (this month) ----
    'collections_per_employee', coalesce((
      select jsonb_agg(jsonb_build_object('name', full_name, 'total', total) order by full_name)
      from (
        select pr.full_name, sum(p.amount_paid)::numeric as total
        from public.payments p
        join public.profiles pr on pr.id = p.received_by
        where p.reversed_at is null
          and p.payment_date >= v_month_start
          and p.payment_date <  v_month_start + interval '1 month'
        group by pr.full_name
      ) x
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;

-- ------------------------------------------------------------
-- staff_dashboard_stats() — for the staff panel
-- ------------------------------------------------------------
create or replace function public.staff_dashboard_stats()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_uid         uuid := auth.uid();
  v_month_start date := date_trunc('month', current_date)::date;
begin
  if not public.is_active_user() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'total_customers',   (select count(*) from public.customers where customer_status = 'active'),

    'my_customers',      (select count(*) from public.customers
                          where seller_id = (select id from public.employees where profile_id = v_uid limit 1)),

    'my_month_collections', coalesce((
      select sum(amount_paid) from public.payments
      where reversed_at is null
        and received_by = v_uid
        and payment_date >= v_month_start
        and payment_date <  v_month_start + interval '1 month'
    ), 0),

    'my_today_collections', coalesce((
      select sum(amount_paid) from public.payments
      where reversed_at is null
        and received_by = v_uid
        and payment_date = current_date
    ), 0),

    'outstanding_total', coalesce((
      select sum(balance) from public.customers where balance > 0
    ), 0),

    'recent_payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',             p.id,
        'amount_paid',    p.amount_paid,
        'payment_date',   p.payment_date,
        'receipt_number', p.receipt_number,
        'customer_name',  c.username
      ) order by p.created_at desc)
      from (
        select * from public.payments
        where reversed_at is null and received_by = v_uid
        order by created_at desc
        limit 10
      ) p
      join public.customers c on c.id = p.customer_id
    ), '[]'::jsonb)
  );
end $$;

-- ------------------------------------------------------------
-- Grants
-- ------------------------------------------------------------
revoke all on function public.admin_dashboard_stats() from public, anon;
revoke all on function public.staff_dashboard_stats() from public, anon;
grant execute on function public.admin_dashboard_stats() to authenticated;
grant execute on function public.staff_dashboard_stats() to authenticated;