-- ============================================================
-- 0009 - Dashboard RPC compatibility repair
-- ============================================================
-- Reasserts the zero-argument dashboard RPCs and their frontend
-- response contract. This is intentionally a new migration rather
-- than an edit to an earlier migration so existing environments
-- retain a valid migration history.
-- ============================================================

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
    'total_customers', (select count(*) from public.customers),
    'active_customers', (select count(*) from public.customers where customer_status = 'active'),
    'inactive_customers', (select count(*) from public.customers where customer_status = 'inactive'),
    'month_collections', coalesce((select sum(amount_paid) from public.payments
                                   where reversed_at is null and payment_date >= v_month), 0),
    'outstanding_total', coalesce((select sum(balance) from public.customers where balance > 0), 0),
    'unpaid_count', (select count(*) from public.fee_balances
                     where billing_month = v_month and status = 'unpaid'),
    'partial_count', (select count(*) from public.fee_balances
                      where billing_month = v_month and status = 'partial'),
    'overdue_count', (select count(*) from public.fee_balances
                      where billing_month = v_month and status = 'overdue'),
    'recent_payments', coalesce((
      select jsonb_agg(x) from (
        select p.id, p.amount_paid, p.payment_date, p.receipt_number, c.username as customer_name
        from public.payments p
        join public.customers c on c.id = p.customer_id
        where p.reversed_at is null
        order by p.created_at desc
        limit 5
      ) x
    ), '[]'::jsonb),
    'recent_customers', coalesce((
      select jsonb_agg(x) from (
        select id, customer_code, username, created_at
        from public.customers
        order by created_at desc, id desc
        limit 5
      ) x
    ), '[]'::jsonb),
    'customers_per_area', coalesce((
      select jsonb_agg(x) from (
        select a.name::text as name, count(c.id) as count
        from public.areas a
        left join public.customers c on c.area_id = a.id
        group by a.id, a.name
        order by a.name
      ) x
    ), '[]'::jsonb),
    'collections_per_employee', coalesce((
      select jsonb_agg(x) from (
        select pr.full_name as name, sum(p.amount_paid) as total
        from public.payments p
        join public.profiles pr on pr.id = p.received_by
        where p.reversed_at is null and p.payment_date >= v_month
        group by pr.id, pr.full_name
        order by total desc
      ) x
    ), '[]'::jsonb)
  );
end
$$;

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
  v_emp record;
begin
  if not public.is_active_user() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select e.id, e.area_id, a.name::text as area_name
  into v_emp
  from public.employees e
  left join public.areas a on a.id = e.area_id
  where e.profile_id = auth.uid();

  return jsonb_build_object(
    'today_collections', coalesce((select sum(amount_paid) from public.payments
                                   where received_by = auth.uid()
                                     and reversed_at is null
                                     and payment_date = v_today), 0),
    'month_collections', coalesce((select sum(amount_paid) from public.payments
                                   where received_by = auth.uid()
                                     and reversed_at is null
                                     and payment_date >= v_month), 0),
    'my_customers', (select count(*) from public.customers where seller_id = v_emp.id),
    'area_outstanding', coalesce((select sum(balance) from public.customers
                                  where area_id = v_emp.area_id and balance > 0), 0),
    'area_name', v_emp.area_name
  );
end
$$;

revoke all on function public.admin_dashboard_stats() from public, anon;
revoke all on function public.staff_dashboard_stats() from public, anon;
grant execute on function public.admin_dashboard_stats() to authenticated;
grant execute on function public.staff_dashboard_stats() to authenticated;

-- PostgREST can retain an old routine schema until it is notified.
notify pgrst, 'reload schema';
