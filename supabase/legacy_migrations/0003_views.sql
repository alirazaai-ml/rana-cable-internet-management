-- ============================================================
-- 0003 — Views
-- ============================================================
-- fee_balances: per-invoice paid / remaining / status.
-- customer_fee_status: one row per active customer with their
--   current-month invoice. This is what the Collection page reads.
-- customer_balances: one row per customer with total outstanding.
-- employee_directory: id + name only (no salary) for dropdowns.
--
-- SECURITY NOTE
-- These views intentionally run with the privileges of their owner
-- (the default), so that a staff member sees the correct paid /
-- remaining totals even though RLS limits them to their own payment
-- rows. Access is protected two ways: every view filters on
-- public.is_active_user() (which reads the caller's JWT), and
-- anon has no grant on them (see 0006_rls.sql).
-- ============================================================

-- ------------------------------------------------------------
-- fee_balances — the authoritative per-invoice calculation.
-- Reversed payments are excluded from every sum.
-- Status precedence: paid > overdue > partial > unpaid.
-- ------------------------------------------------------------
create or replace view public.fee_balances as
select
  mf.id                                   as monthly_fee_id,
  mf.customer_id,
  mf.billing_month,
  mf.amount_due,
  mf.due_date,
  coalesce(sum(p.amount_paid) filter (where p.reversed_at is null), 0)::numeric(10,2)
                                          as total_paid,
  (mf.amount_due
    - coalesce(sum(p.amount_paid) filter (where p.reversed_at is null), 0))::numeric(10,2)
                                          as remaining,
  case
    when mf.amount_due - coalesce(sum(p.amount_paid) filter (where p.reversed_at is null), 0) <= 0
      then 'paid'
    when mf.due_date < public.today_pk()
      then 'overdue'
    when coalesce(sum(p.amount_paid) filter (where p.reversed_at is null), 0) > 0
      then 'partial'
    else 'unpaid'
  end                                     as status
from public.monthly_fees mf
left join public.payments p on p.monthly_fee_id = mf.id
where public.is_active_user()
group by mf.id, mf.customer_id, mf.billing_month, mf.amount_due, mf.due_date;

-- ------------------------------------------------------------
-- customer_fee_status — one row per active customer for the
-- current month. Uses left join so a customer with no invoice
-- yet still appears (with monthly_fee_id = null).
-- ------------------------------------------------------------
create or replace view public.customer_fee_status as
select
  c.id                as customer_id,
  c.customer_code,
  c.username,
  c.phone,
  c.area_id,
  c.package_id,
  c.customer_status,
  c.service_status,
  c.balance,
  fb.monthly_fee_id,
  fb.billing_month,
  fb.amount_due,
  coalesce(fb.total_paid, 0)::numeric(10,2) as total_paid,
  coalesce(fb.remaining, 0)::numeric(10,2)  as remaining,
  fb.status
from public.customers c
left join public.fee_balances fb
  on fb.customer_id = c.id
  and fb.billing_month = date_trunc('month', public.today_pk())::date
where c.customer_status = 'active'
  and public.is_active_user();

-- ------------------------------------------------------------
-- customer_balances — total outstanding per customer, across
-- all unpaid invoices plus opening balance.
-- ------------------------------------------------------------
create or replace view public.customer_balances as
select
  c.id            as customer_id,
  c.customer_code,
  c.username,
  c.phone,
  c.area_id,
  c.opening_balance,
  coalesce(sum(fb.remaining) filter (where fb.remaining > 0), 0)::numeric(10,2) as unpaid_invoices,
  (c.opening_balance + coalesce(sum(fb.remaining) filter (where fb.remaining > 0), 0))::numeric(10,2)
                  as total_outstanding
from public.customers c
left join public.fee_balances fb on fb.customer_id = c.id
where public.is_active_user()
group by c.id, c.customer_code, c.username, c.phone, c.area_id, c.opening_balance;

-- ------------------------------------------------------------
-- employee_directory — safe subset of employees for dropdowns
-- (customer "seller", etc.). No salary, phone or login link.
-- The employees table itself is admin-only (salary is private).
-- ------------------------------------------------------------
create or replace view public.employee_directory as
select e.id, e.full_name, e.area_id, e.is_active
from public.employees e
where public.is_active_user();
