-- ============================================================
-- 20261015000002 - LOGIC: triggers and internal functions
-- ============================================================
-- Rule: the database fills in everything the app should not have
-- to send (codes, receipt numbers, due dates, creators, balances),
-- and enforces the money rules even for direct SQL inserts.
-- ============================================================

-- ------------------------------------------------------------
-- updated_at
-- ------------------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger trg_profiles_updated  before update on public.profiles      for each row execute function public.tg_set_updated_at();
create trigger trg_packages_updated  before update on public.packages      for each row execute function public.tg_set_updated_at();
create trigger trg_employees_updated before update on public.employees     for each row execute function public.tg_set_updated_at();
create trigger trg_customers_updated before update on public.customers     for each row execute function public.tg_set_updated_at();
create trigger trg_templates_updated before update on public.sms_templates for each row execute function public.tg_set_updated_at();

-- ------------------------------------------------------------
-- Stamp "created_by" with the logged-in user. Browser sessions cannot
-- spoof it; SQL imports may supply their own value (or leave it null).
-- ------------------------------------------------------------
create or replace function public.tg_stamp_creator()
returns trigger language plpgsql as $$
begin
  if auth.role() = 'authenticated' or new.created_by is null then
    new.created_by := coalesce(auth.uid(), new.created_by);
  end if;
  return new;
end $$;

create trigger trg_complaints_stamp before insert on public.complaints          for each row execute function public.tg_stamp_creator();
create trigger trg_journal_stamp    before insert on public.journal_entries     for each row execute function public.tg_stamp_creator();
create trigger trg_acctx_stamp      before insert on public.account_transactions for each row execute function public.tg_stamp_creator();
create trigger trg_fees_stamp       before insert on public.monthly_fees        for each row execute function public.tg_stamp_creator();

-- ------------------------------------------------------------
-- Customer balance = opening_balance + everything still unpaid.
-- Always recomputed from the base tables, so it cannot drift.
-- ------------------------------------------------------------
create or replace function public.recompute_customer_balance(p_customer_id bigint)
returns void language plpgsql security definer set search_path = public
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

create or replace function public.recompute_all_balances()
returns integer language plpgsql security definer set search_path = public
as $$
declare r record; n integer := 0;
begin
  if not (public.is_trusted_caller() or public.is_admin()) then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  for r in select id from public.customers loop
    perform public.recompute_customer_balance(r.id); n := n + 1;
  end loop;
  return n;
end $$;

-- ------------------------------------------------------------
-- CUSTOMERS
-- ------------------------------------------------------------
create sequence if not exists public.customer_code_seq;

create or replace function public.tg_customers_prepare()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_phone text; v_code text;
begin
  new.username := btrim(new.username);

  if tg_op = 'INSERT' or new.phone is distinct from old.phone then
    v_phone := public.normalize_phone(new.phone);
    if v_phone is null then
      raise exception 'Invalid phone number "%". Enter 7-15 digits, e.g. 0300 1234567.', new.phone using errcode = '22023';
    end if;
    new.phone := v_phone;
  end if;

  if tg_op = 'INSERT' then
    -- Staff (browser, non-admin) cannot start a customer with money owing or a custom status.
    if auth.role() = 'authenticated' and not public.is_admin() then
      new.opening_balance := 0;
      new.service_status  := 'on';
      new.customer_status := 'active';
    end if;

    -- Generate a code that is guaranteed unused (safe after imports with their own codes).
    if new.customer_code is null or btrim(new.customer_code) = '' then
      loop
        v_code := 'CUS-' || lpad(nextval('public.customer_code_seq')::text, 5, '0');
        exit when not exists (select 1 from public.customers where customer_code = v_code);
      end loop;
      new.customer_code := v_code;
    else
      new.customer_code := btrim(new.customer_code);
    end if;

    new.created_by := coalesce(case when auth.role() = 'authenticated' then auth.uid() end, new.created_by, auth.uid());
    new.balance := new.opening_balance;       -- the fee triggers will add unpaid fees
  else
    new.customer_code := old.customer_code;   -- immutable
    new.created_by    := old.created_by;      -- immutable
    if new.opening_balance is distinct from old.opening_balance then
      new.balance := old.balance - old.opening_balance + new.opening_balance;
    end if;
  end if;
  return new;
end $$;

create trigger trg_customers_prepare before insert or update on public.customers
  for each row execute function public.tg_customers_prepare();

-- Staff may not touch money / status / plan columns, even via the raw API.
create or replace function public.tg_customers_protect_columns()
returns trigger language plpgsql as $$
begin
  if public.is_trusted_session() or public.is_admin() then return new; end if;
  if new.balance          is distinct from old.balance
     or new.opening_balance is distinct from old.opening_balance
     or new.service_status  is distinct from old.service_status
     or new.customer_status is distinct from old.customer_status
     or new.package_id      is distinct from old.package_id
     or new.area_id         is distinct from old.area_id
     or new.join_date       is distinct from old.join_date
  then
    raise exception 'Staff cannot change balance, opening balance, service status, customer status, package, area or join date'
      using errcode = '42501';
  end if;
  return new;
end $$;

create trigger trg_customers_protect before update on public.customers
  for each row execute function public.tg_customers_protect_columns();

-- A new (or re-activated) customer gets this month's fee straight away,
-- so they show up on the Collections page without waiting for a refresh.
create or replace function public.tg_customers_first_fee()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if public.is_bulk_load() or new.customer_status <> 'active' then return null; end if;
  if tg_op = 'UPDATE' and old.customer_status = 'active' then return null; end if;
  insert into public.monthly_fees (customer_id, billing_month, package_id)
  values (new.id, date_trunc('month', public.today_pk()::timestamp)::date, new.package_id)
  on conflict (customer_id, billing_month) do nothing;
  return null;
end $$;

create trigger trg_customers_first_fee after insert or update of customer_status on public.customers
  for each row execute function public.tg_customers_first_fee();

-- ------------------------------------------------------------
-- EMPLOYEES
-- ------------------------------------------------------------
create or replace function public.tg_employees_prepare()
returns trigger language plpgsql as $$
begin
  new.full_name := btrim(new.full_name);
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

create trigger trg_employees_prepare before insert or update on public.employees
  for each row execute function public.tg_employees_prepare();

-- An admin cannot lock themselves out.
create or replace function public.tg_profiles_guard()
returns trigger language plpgsql as $$
begin
  if public.is_trusted_session() then return new; end if;
  if auth.uid() = old.id and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
    raise exception 'You cannot change your own role or active status' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger trg_profiles_guard before update on public.profiles
  for each row execute function public.tg_profiles_guard();

-- ------------------------------------------------------------
-- MONTHLY FEES - fill defaults so a plain insert just works
-- ------------------------------------------------------------
create or replace function public.tg_fees_prepare()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_pkg bigint;
begin
  new.billing_month := date_trunc('month', new.billing_month::timestamp)::date;

  if new.package_id is null then
    select package_id into new.package_id from public.customers where id = new.customer_id;
  end if;
  if new.amount_due is null then
    select monthly_fee into new.amount_due from public.packages where id = new.package_id;
  end if;
  if new.amount_due is null then
    raise exception 'Cannot work out the fee amount: give amount_due or a package' using errcode = '22023';
  end if;
  if new.due_date is null then
    new.due_date := new.billing_month + 9;     -- the 10th
  end if;
  return new;
end $$;

create trigger trg_fees_prepare before insert on public.monthly_fees
  for each row execute function public.tg_fees_prepare();

create or replace function public.tg_fees_after()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recompute_customer_balance(old.customer_id);
  else
    perform public.recompute_customer_balance(new.customer_id);
  end if;
  return null;
end $$;

create trigger trg_fees_after after insert or update or delete on public.monthly_fees
  for each row execute function public.tg_fees_after();

-- ------------------------------------------------------------
-- RECEIPT NUMBERS: RCP-YYYY-NNNNNN. An advisory lock serialises
-- concurrent payments so two cannot get the same number.
-- ------------------------------------------------------------
create or replace function public.generate_receipt_number()
returns text language plpgsql security definer set search_path = public
as $$
declare v_year text := to_char(public.today_pk(), 'YYYY'); v_next bigint; v_rcp text;
begin
  perform pg_advisory_xact_lock(hashtext('icrms.receipt_number'));
  select coalesce(max(substr(receipt_number, 10)::bigint), 0) + 1 into v_next
  from public.payments
  where receipt_number ~ ('^RCP-' || v_year || '-[0-9]+$');
  loop
    v_rcp := 'RCP-' || v_year || '-' || lpad(v_next::text, 6, '0');
    exit when not exists (select 1 from public.payments where receipt_number = v_rcp);
    v_next := v_next + 1;
  end loop;
  return v_rcp;
end $$;

-- ------------------------------------------------------------
-- PAYMENTS - one place enforces every money rule, for any insert path
-- ------------------------------------------------------------
create or replace function public.tg_payments_prepare()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_fee_customer bigint; v_due numeric; v_paid numeric;
begin
  -- Lock the fee so two simultaneous payments cannot overpay it.
  select customer_id, amount_due into v_fee_customer, v_due
  from public.monthly_fees where id = new.monthly_fee_id for update;
  if not found then
    raise exception 'Monthly fee % does not exist', new.monthly_fee_id using errcode = 'P0002';
  end if;

  if new.customer_id is null then
    new.customer_id := v_fee_customer;
  elsif new.customer_id <> v_fee_customer then
    raise exception 'This fee belongs to a different customer' using errcode = '22023';
  end if;

  if new.reversed_at is null then
    select coalesce(sum(amount_paid), 0) into v_paid
    from public.payments where monthly_fee_id = new.monthly_fee_id and reversed_at is null;
    if v_due - v_paid <= 0 then
      raise exception 'This fee is already fully paid' using errcode = '22023';
    end if;
    if new.amount_paid > v_due - v_paid then
      raise exception 'Payment exceeds the remaining balance (Rs. %)', (v_due - v_paid) using errcode = '22023';
    end if;
  end if;

  if auth.role() = 'authenticated' then
    new.received_by := auth.uid();
  elsif new.received_by is null then
    new.received_by := auth.uid();
  end if;

  if new.receipt_number is null or btrim(new.receipt_number) = '' then
    new.receipt_number := public.generate_receipt_number();
  end if;
  new.notes := nullif(btrim(new.notes), '');
  return new;
end $$;

create trigger trg_payments_prepare before insert on public.payments
  for each row execute function public.tg_payments_prepare();

-- After a payment: refresh the balance, post the cash book + account entry,
-- and post the opposite entries when it is reversed.
create or replace function public.tg_payments_after()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_account bigint; v_name text; v_type text;
begin
  perform public.recompute_customer_balance(new.customer_id);
  if public.is_bulk_load() then return null; end if;

  if tg_op = 'INSERT' and new.reversed_at is null then
    select username into v_name from public.customers where id = new.customer_id;
    insert into public.journal_entries (entry_date, entry_type, category, amount, description, reference_payment_id, created_by)
    values (new.payment_date, 'income', 'Fee collection', new.amount_paid,
            'Receipt ' || new.receipt_number || ' - ' || coalesce(v_name, ''), new.id, new.received_by);

    v_type := case when new.payment_method = 'bank_transfer' then 'bank' else 'cash' end;
    select id into v_account from public.accounts where is_active and account_type = v_type order by id limit 1;
    if v_account is not null then
      insert into public.account_transactions (account_id, transaction_type, amount, description, reference_payment_id, created_by)
      values (v_account, 'credit', new.amount_paid, 'Receipt ' || new.receipt_number, new.id, new.received_by);
    end if;

  elsif tg_op = 'UPDATE' and old.reversed_at is null and new.reversed_at is not null then
    insert into public.journal_entries (entry_date, entry_type, category, amount, description, reference_payment_id, created_by)
    values (public.today_pk(), 'expense', 'Payment reversal', new.amount_paid,
            'Reversed receipt ' || new.receipt_number || ': ' || coalesce(new.reversal_reason, ''), new.id, new.reversed_by);

    select account_id into v_account from public.account_transactions
    where reference_payment_id = new.id and transaction_type = 'credit' order by id limit 1;
    if v_account is not null then
      insert into public.account_transactions (account_id, transaction_type, amount, description, reference_payment_id, created_by)
      values (v_account, 'debit', new.amount_paid, 'Reversal of ' || new.receipt_number, new.id, new.reversed_by);
    end if;
  end if;
  return null;
end $$;

create trigger trg_payments_after after insert or update on public.payments
  for each row execute function public.tg_payments_after();

-- ------------------------------------------------------------
-- ACCOUNT balances follow transactions (credit +, debit -)
-- ------------------------------------------------------------
create or replace function public.tg_account_tx_apply()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if public.is_bulk_load() then return null; end if;
  update public.accounts
  set current_balance = current_balance + case when new.transaction_type = 'credit' then new.amount else -new.amount end
  where id = new.account_id;
  return null;
end $$;

create trigger trg_account_tx_apply after insert on public.account_transactions
  for each row execute function public.tg_account_tx_apply();

-- ------------------------------------------------------------
-- COMPLAINTS: resolved_at follows status; staff can only work a complaint
-- ------------------------------------------------------------
create or replace function public.tg_complaints_prepare()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and not (public.is_trusted_session() or public.is_admin()) then
    if new.customer_id    is distinct from old.customer_id
       or new.complaint_text is distinct from old.complaint_text
       or new.category       is distinct from old.category
       or new.assigned_to    is distinct from old.assigned_to
       or new.created_by     is distinct from old.created_by
    then
      raise exception 'Staff can only change the status and resolution notes of a complaint' using errcode = '42501';
    end if;
  end if;

  if new.status in ('resolved','closed') then
    new.resolved_at := coalesce(new.resolved_at, now());
  else
    new.resolved_at := null;
  end if;
  return new;
end $$;

create trigger trg_complaints_prepare before insert or update on public.complaints
  for each row execute function public.tg_complaints_prepare();

-- ------------------------------------------------------------
-- Financial records cannot be deleted
-- ------------------------------------------------------------
create or replace function public.tg_block_delete()
returns trigger language plpgsql as $$
begin
  raise exception 'Rows in % cannot be deleted. Reverse or deactivate instead.', tg_table_name using errcode = '42501';
end $$;

create trigger trg_payments_no_delete before delete on public.payments             for each row execute function public.tg_block_delete();
create trigger trg_fees_no_delete     before delete on public.monthly_fees         for each row execute function public.tg_block_delete();
create trigger trg_journal_no_delete  before delete on public.journal_entries      for each row execute function public.tg_block_delete();
create trigger trg_acctx_no_delete    before delete on public.account_transactions for each row execute function public.tg_block_delete();
create trigger trg_audit_no_delete    before delete on public.company_logs         for each row execute function public.tg_block_delete();

-- ------------------------------------------------------------
-- Audit trail. It must NEVER be the reason a real insert fails,
-- so any problem here is downgraded to a warning.
-- ------------------------------------------------------------
create or replace function public.tg_audit()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_row jsonb; v_details jsonb;
begin
  if public.is_bulk_load() then return null; end if;
  begin
    v_row := to_jsonb(case when tg_op = 'DELETE' then old else new end);
    v_details := case when tg_op = 'UPDATE'
                      then jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new))
                      else v_row end;
    insert into public.company_logs (actor_id, action, entity_type, entity_id, details)
    values (case when exists (select 1 from public.profiles where id = auth.uid()) then auth.uid() end,
            tg_table_name || '.' || lower(tg_op), tg_table_name, v_row ->> 'id', v_details);
  exception when others then
    raise warning 'audit log skipped: %', sqlerrm;
  end;
  return null;
end $$;

create trigger trg_audit_customers_ins after insert on public.customers for each row execute function public.tg_audit();
create trigger trg_audit_customers_upd after update on public.customers for each row
  when ((to_jsonb(new) - 'balance' - 'updated_at') is distinct from (to_jsonb(old) - 'balance' - 'updated_at'))
  execute function public.tg_audit();
create trigger trg_audit_payments   after insert or update on public.payments      for each row execute function public.tg_audit();
create trigger trg_audit_profiles   after insert or update on public.profiles      for each row execute function public.tg_audit();
create trigger trg_audit_employees  after insert or update on public.employees     for each row execute function public.tg_audit();
create trigger trg_audit_packages   after insert or update on public.packages      for each row execute function public.tg_audit();
create trigger trg_audit_areas      after insert or update or delete on public.areas for each row execute function public.tg_audit();
create trigger trg_audit_complaints after insert or update on public.complaints    for each row execute function public.tg_audit();
create trigger trg_audit_templates  after insert or update on public.sms_templates for each row execute function public.tg_audit();
create trigger trg_audit_journal    after insert on public.journal_entries          for each row execute function public.tg_audit();
create trigger trg_audit_accounts   after insert or update on public.accounts       for each row execute function public.tg_audit();
