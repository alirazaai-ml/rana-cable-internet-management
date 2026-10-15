-- ============================================================
-- Database self-test. Run on a THROW-AWAY database (it creates users,
-- customers and payments). Every line is an assertion; the script stops
-- at the first failure and prints "ALL TESTS PASSED" at the end.
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/manual/tests.sql
-- Assumes the migrations have been applied and Supabase's auth schema exists.
-- ============================================================
\set ON_ERROR_STOP on
\set admin '00000000-0000-0000-0000-0000000000a1'
\set staff '00000000-0000-0000-0000-0000000000b2'
\set staff2 '00000000-0000-0000-0000-0000000000c3'

create or replace function public._t_expect(p_sql text, p_pattern text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then
    if sqlerrm ilike '%' || p_pattern || '%' then return; end if;
    raise exception 'EXPECTED error like "%" but got "%" for: %', p_pattern, sqlerrm, p_sql;
  end;
  raise exception 'EXPECTED error like "%" but statement succeeded: %', p_pattern, p_sql;
end $$;
grant execute on function public._t_expect(text, text) to public;

insert into auth.users(id,email) values (:'admin','a@x'),(:'staff','s@x'),(:'staff2','s2@x');
insert into profiles(id,full_name,role) values (:'admin','Admin','admin'),(:'staff','Staff One','staff'),(:'staff2','Staff Two','staff');
insert into employees(profile_id,full_name,area_id) values (:'staff','Staff One',1);
\echo [seed] areas/packages/accounts present
do $$ begin
  assert (select count(*) from areas) = 6 and (select count(*) from packages) = 4 and (select count(*) from accounts) = 2, 'seed';
end $$;

-- ============ A. SQL-editor / import style inserts (trusted session) ============
\echo [A] minimal customer insert gets code, normalised phone, balance, and the current month fee
insert into customers(username, phone, package_id, area_id) values ('  Ali Raza ', '0300-1234567', 1, 1);
do $$ declare c record; begin
  select * into c from customers where phone = '03001234567';
  assert c.customer_code = 'CUS-00001', 'code ' || c.customer_code;
  assert c.username = 'Ali Raza', 'trim';
  assert c.balance = 1500, 'balance incl. first fee: ' || c.balance;
  assert (select count(*) from monthly_fees where customer_id = c.id) = 1, 'first fee';
end $$;

\echo [A] landline / foreign number is accepted (kept as digits), garbage is rejected
insert into customers(username, phone, package_id, area_id) values ('Landline', '042-3571234', 2, 2);
select public._t_expect($$insert into customers(username, phone, package_id, area_id) values ('Bad','123',1,1)$$, 'Invalid phone');
do $$ begin assert (select phone from customers where username='Landline') = '0423571234'; end $$;

\echo [A] advance-paying customer (negative opening balance) is accepted
insert into customers(username, phone, package_id, area_id, opening_balance) values ('Advance','03111111111',1,1,-500);
do $$ begin assert (select balance from customers where username='Advance') = 1000, 'neg opening + fee'; end $$;

\echo [A] import with explicit ids / codes, then fix_sequences, then normal insert works
begin;
select set_config('app.bulk_load','on',true);
insert into areas(id,name) values (100,'Imported Area');
insert into customers(id,customer_code,username,phone,package_id,area_id,opening_balance,join_date)
  values (500,'CUS-00500','Imported One','0322 2222222',1,100,2500,'2026-01-05');
commit;
do $$ begin assert (select count(*) from monthly_fees where customer_id=500)=0, 'bulk load must not auto-create fees';
            assert (select count(*) from company_logs where entity_id='500')=0, 'bulk load must not audit'; end $$;
select public.fix_sequences();
insert into areas(name) values ('After Import Area');
insert into customers(username,phone,package_id,area_id) values ('After Import','03333333333',1,100);
do $$ begin assert (select customer_code from customers where username='After Import') = 'CUS-00501', 'code after import'; end $$;

\echo [A] customer_code generator skips codes that already exist
insert into customers(customer_code,username,phone,package_id,area_id) values ('CUS-00600','Manual Code','03444444444',1,1);
select setval('customer_code_seq', 599);
insert into customers(username,phone,package_id,area_id) values ('Auto After Manual','03555555555',1,1);
do $$ begin assert (select customer_code from customers where username='Auto After Manual') = 'CUS-00601'; end $$;

\echo [A] fee insert with only customer + any date in month -> normalised, due date + amount defaulted
insert into monthly_fees(customer_id, billing_month) values (500, '2026-09-17');
do $$ declare f record; begin
  select * into f from monthly_fees where customer_id=500;
  assert f.billing_month = '2026-09-01' and f.due_date = '2026-09-10' and f.amount_due = 1500, 'fee defaults';
  assert (select balance from customers where id=500) = 4000, 'balance 2500 + 1500';
end $$;
select public._t_expect($$insert into monthly_fees(customer_id,billing_month) values (500,'2026-09-01')$$, 'duplicate');

\echo [A] direct payment insert: receipt, creator, journal, account, balance all automatic
insert into payments(monthly_fee_id, amount_paid) values ((select id from monthly_fees where customer_id=500), 1000);
do $$ declare p record; begin
  select * into p from payments order by id desc limit 1;
  assert p.receipt_number ~ '^RCP-2026-000001$' or p.receipt_number ~ '^RCP-20[0-9]{2}-000001$', 'receipt ' || p.receipt_number;
  assert p.customer_id = 500 and p.payment_method = 'cash', 'filled customer/method';
  assert (select balance from customers where id=500) = 3000, 'balance after payment';
  assert (select count(*) from journal_entries where reference_payment_id = p.id and entry_type='income') = 1, 'journal';
  assert (select current_balance from accounts where name='Cash Box') = 1000, 'cash box';
end $$;

\echo [A] money rules hold for direct SQL too
select public._t_expect($$insert into payments(monthly_fee_id, amount_paid) values ((select id from monthly_fees where customer_id=500), 501)$$, 'exceeds the remaining');
select public._t_expect($$insert into payments(customer_id, monthly_fee_id, amount_paid) values (1,(select id from monthly_fees where customer_id=500),10)$$, 'different customer');
select public._t_expect($$insert into payments(monthly_fee_id, amount_paid) values (999999, 10)$$, 'does not exist');
select public._t_expect($$delete from payments$$, 'cannot be deleted');
select public._t_expect($$insert into payments(monthly_fee_id, amount_paid) values ((select id from monthly_fees where customer_id=500), 0)$$, 'amount_paid');

\echo [A] historical payment import with bulk flag keeps given receipt and posts nothing extra
begin;
select set_config('app.bulk_load','on',true);
insert into payments(monthly_fee_id, amount_paid, receipt_number, payment_date, payment_method)
  values ((select id from monthly_fees where customer_id=500), 500, 'OLD-0001', '2026-09-20', 'bank_transfer');
commit;
do $$ begin
  assert (select count(*) from journal_entries where description like '%OLD-0001%') = 0, 'no journal on bulk';
  assert (select balance from customers where id=500) = 2500, 'balance still recomputed';
end $$;

-- ============ B. Admin through the API ============
set role authenticated; select set_config('request.jwt.claim.sub', :'admin', false), set_config('request.jwt.claim.role','authenticated',false);
\echo [B] admin: area / package / template / account inserts and duplicates
insert into areas(name, description) values ('Test Area', null);
select public._t_expect($$insert into areas(name) values ('test area ')$$, 'areas_name_uniq');
insert into packages(name,speed_label,monthly_fee,description,is_active) values ('5MB','5 Mbps',3500,null,true);
select public._t_expect($$insert into packages(name,monthly_fee) values ('5mb',1)$$, 'packages_name_uniq');
insert into sms_templates(name,template_text,is_active) values ('Reminder','Dear {{customer_name}}, please pay',true);
insert into accounts(name,account_type) values ('Petty Cash','cash');
select public._t_expect($$insert into accounts(name,account_type,current_balance) values ('Rich','cash',999)$$, 'row-level security');

\echo [B] admin: customer exactly as the form sends it (strings, nulls, seller)
insert into customers(username,phone,package_id,area_id,seller_id,address,cnic,father_name,notes,opening_balance,service_status,customer_status)
  values ('Form Customer','+92 300 7654321',1,1,1,'House 1','35202-1234567-1','Father',null,'1200.50','on','active');
do $$ declare c record; begin
  select * into c from customers where username='Form Customer';
  assert c.phone='03007654321' and c.opening_balance=1200.50 and c.created_by='00000000-0000-0000-0000-0000000000a1', 'form customer';
  assert c.balance = 2700.50, 'balance ' || c.balance;
end $$;

\echo [B] admin: complaint (spoofed created_by is overridden, resolved_at follows status)
insert into complaints(customer_id,category,complaint_text,created_by) values (1,'hardware','Router dead','00000000-0000-0000-0000-0000000000b2');
do $$ begin assert (select created_by from complaints order by id desc limit 1) = '00000000-0000-0000-0000-0000000000a1', 'creator stamped'; end $$;
update complaints set status='resolved', resolution_notes='Replaced' where category='hardware';
do $$ begin assert (select resolved_at from complaints where category='hardware') is not null, 'resolved_at set'; end $$;
update complaints set status='open', resolved_at=null where category='hardware';
do $$ begin assert (select resolved_at from complaints where category='hardware') is null, 'resolved_at cleared'; end $$;

\echo [B] admin: journal + manual account transaction
insert into journal_entries(entry_date,entry_type,category,amount,description,created_by) values ('2026-10-15','expense','Rent',1000,null,'00000000-0000-0000-0000-0000000000a1');
insert into account_transactions(account_id,transaction_type,amount,description,created_by) values (1,'debit',200,'Tea','00000000-0000-0000-0000-0000000000a1');
do $$ begin assert (select current_balance from accounts where id=1) = 800, 'acct balance'; end $$;

\echo [B] admin: ensure_monthly_fees idempotent, future month refused, record_payment + reverse
select public.ensure_monthly_fees(public.today_pk());
do $$ declare n int; begin n := public.ensure_monthly_fees(public.today_pk()); assert n = 0, 'idempotent'; end $$;
select public._t_expect($$select public.ensure_monthly_fees((public.today_pk() + interval '2 months')::date)$$, 'future month');
do $$ declare r jsonb; fid bigint; begin
  select monthly_fee_id into fid from fee_balances where customer_id = 1 and billing_month = date_trunc('month', public.today_pk()::timestamp)::date;
  r := public.record_payment(1, fid, 600, 'cash', 'first part');
  assert r->>'receipt_number' is not null and r->>'message' like '%600.00%' and r->>'message' like '%Remaining balance: Rs. 900.00%', 'rpc result ' || r::text;
  assert (select status from fee_balances where monthly_fee_id = fid) = 'unpaid' or (select status from fee_balances where monthly_fee_id = fid) in ('partial','overdue'), 'status';
  perform public.reverse_payment((r->>'payment_id')::bigint, 'wrong customer');
  assert (select total_paid from fee_balances where monthly_fee_id = fid) = 0, 'reversal restores fee';
  assert (select count(*) from journal_entries where category='Payment reversal') = 1, 'reversal journal';
  assert (select current_balance from accounts where id=1) = 800, 'reversal debits the account back';
end $$;
select public._t_expect($$select public.reverse_payment((select id from payments where reversed_at is not null and payment_date is not null order by id desc limit 1),'again')$$, 'already reversed');
select public._t_expect($$select public.reverse_payment((select id from payments order by id limit 1),'  ')$$, 'reason is required');

\echo [B] admin dashboards return the keys the UI reads
do $$ declare a jsonb := public.admin_dashboard_stats(); s jsonb := public.staff_dashboard_stats(); k text; begin
  foreach k in array array['total_customers','active_customers','inactive_customers','month_collections','outstanding_total','unpaid_count','partial_count','overdue_count','recent_payments','recent_customers','customers_per_area','collections_per_employee'] loop
    assert a ? k, 'admin key ' || k; end loop;
  foreach k in array array['today_collections','month_collections','my_customers','area_outstanding','area_name'] loop
    assert s ? k, 'staff key ' || k; end loop;
end $$;
do $$ begin assert (select count(*) from employee_directory) = 1 and (select count(*) from customer_fee_status) > 0 and (select count(*) from customer_balances) > 0; end $$;
select public._t_expect($$delete from journal_entries$$, 'permission denied');
select public._t_expect($$insert into payments(monthly_fee_id,amount_paid) values (1,1)$$, 'permission denied');
select public._t_expect($$insert into monthly_fees(customer_id,billing_month) values (1,'2020-01-01')$$, 'permission denied');

-- ============ C. Staff through the API ============
select set_config('request.jwt.claim.sub', :'staff', false);
\echo [C] staff: customer insert (hidden admin fields are ignored, not errors)
insert into customers(username,phone,package_id,area_id,seller_id,opening_balance,service_status,customer_status)
  values ('Staff Added','0311 5555555',1,1,1,99999,'off','inactive');
do $$ declare c record; begin
  select * into c from customers where username='Staff Added';
  assert c.opening_balance = 0 and c.service_status='on' and c.customer_status='active', 'staff defaults enforced';
  assert c.created_by = '00000000-0000-0000-0000-0000000000b2', 'creator';
  assert (select count(*) from monthly_fees where customer_id = c.id) = 1, 'fee auto-created for staff-added customer';
end $$;
\echo [C] staff: editing allowed fields works, protected fields are refused
update customers set address='New street', notes='hello' where username='Staff Added';
select public._t_expect($$update customers set package_id = 2 where username='Staff Added'$$, 'Staff cannot change');
select public._t_expect($$update customers set opening_balance = 5 where username='Staff Added'$$, 'Staff cannot change');
select public._t_expect($$update customers set customer_status = 'inactive' where username='Staff Added'$$, 'Staff cannot change');

\echo [C] staff: complaint + RPC payment, sees only own payments
insert into complaints(customer_id,category,complaint_text,created_by) values (1,'slow_speed','Very slow today',null);
do $$ declare r jsonb; fid bigint; begin
  select monthly_fee_id into fid from fee_balances where customer_id = (select id from customers where username='Staff Added') limit 1;
  r := public.record_payment((select id from customers where username='Staff Added'), fid, 1500, 'cash', null);
  assert (select count(*) from payments) = 1, 'staff sees only own payments';
  assert (select status from fee_balances where monthly_fee_id = fid) = 'paid', 'fee paid';
  assert (public.staff_dashboard_stats()->>'today_collections')::numeric = 1500, 'staff stats';
  perform public.mark_whatsapp_sent((r->>'sms_log_id')::bigint);
  assert (select whatsapp_sent from payments where id=(r->>'payment_id')::bigint), 'whatsapp flag';
end $$;
select public._t_expect($$select public.record_payment((select id from customers where username='Staff Added'), (select monthly_fee_id from fee_balances where customer_id=(select id from customers where username='Staff Added') limit 1), 10, 'cash', null)$$, 'fully paid');
select public._t_expect($$select public.record_payment(1, (select monthly_fee_id from fee_balances where customer_id=2 limit 1), 10, 'cash', null)$$, 'not found for this customer');
select public._t_expect($$select public.record_payment(2, (select monthly_fee_id from fee_balances where customer_id=2 limit 1), 10, 'visa', null)$$, 'Invalid payment method');

\echo [C] staff: blocked from admin-only things
select public._t_expect($$insert into payments(monthly_fee_id,amount_paid) values (1,1)$$, 'permission denied');
select public._t_expect($$insert into journal_entries(entry_type,category,amount) values ('income','x',1)$$, 'row-level security');
select public._t_expect($$select public.reverse_payment(1,'x')$$, 'Only an admin');
select public._t_expect($$select public.admin_dashboard_stats()$$, 'Admins only');
select public._t_expect($$select public.fix_sequences()$$, 'Admins only');
select public._t_expect($$insert into areas(name) values ('Staff Area')$$, 'row-level security');
do $$ declare n int; begin
  update profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000b2';
  get diagnostics n = row_count;
  assert n = 0, 'staff must not be able to promote themselves';
end $$;
do $$ begin
  assert (select count(*) from journal_entries) = 0 and (select count(*) from accounts) = 0 and (select count(*) from company_logs) = 0, 'admin tables hidden';
  assert (select count(*) from employees) = 1, 'staff sees only own employee row';
  assert (select count(*) from complaints) = 1, 'staff sees only own complaints';
  assert (select count(*) from sms_logs) = 1, 'staff sees only own sms logs';
end $$;

\echo [C] deactivated login loses everything
reset role;
update profiles set is_active = false where id = :'staff2';
set role authenticated; select set_config('request.jwt.claim.sub', :'staff2', false);
do $$ begin assert (select count(*) from customers) = 0 and (select count(*) from areas) = 0 and (select count(*) from fee_balances) = 0, 'inactive sees nothing'; end $$;
select public._t_expect($$insert into customers(username,phone,package_id,area_id) values ('X','03000000000',1,1)$$, 'row-level security');

-- ============ D. anon ============
reset role; set role anon; select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role','anon',false);
\echo [D] anon: nothing but health_check
select public._t_expect($$select count(*) from customers$$, 'permission denied');
select public._t_expect($$select count(*) from fee_balances$$, 'permission denied');
select public._t_expect($$select public.record_payment(1,1,1,'cash',null)$$, 'permission denied');
do $$ begin assert (public.health_check()->>'ok')::boolean; end $$;

-- ============ E. integrity: balances equal the recomputation ============
reset role; select set_config('request.jwt.claim.sub','',false), set_config('request.jwt.claim.role','',false);
\echo [E] stored balances equal a fresh recomputation; audit trail exists
create temp table _before as select id, balance from customers;
select public.recompute_all_balances();
do $$ begin
  assert not exists (select 1 from customers c join _before b using (id) where c.balance <> b.balance), 'balance drift';
  assert (select count(*) from company_logs) > 0, 'audit rows';
  assert (select count(*) from customers where customer_code is null) = 0;
end $$;

drop function public._t_expect(text, text);
\echo
\echo ALL TESTS PASSED
