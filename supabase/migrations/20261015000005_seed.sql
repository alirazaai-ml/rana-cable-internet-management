-- ============================================================
-- 20261015000005 - SEED: starting areas, packages, template, accounts
-- Safe to re-run. Edit / add more from the app.
-- (Rows are inserted in a fixed order so ids are predictable:
--  package 1 = 1MB, area 1 = Village 1, account 1 = Cash Box.)
-- ============================================================
insert into public.areas (name)
select t.name from (values (1,'Village 1'),(2,'Village 2'),(3,'Village 3'),(4,'Village 4'),(5,'Village 5'),(6,'Village 6')) t(ord, name)
where not exists (select 1 from public.areas a where lower(btrim(a.name)) = lower(t.name))
order by t.ord;

insert into public.packages (name, speed_label, monthly_fee)
select t.name, t.speed, t.fee
from (values (1,'1MB','1 Mbps',1500.00),(2,'2MB','2 Mbps',2000.00),(3,'3MB','3 Mbps',2500.00),(4,'4MB','4 Mbps',3000.00)) t(ord, name, speed, fee)
where not exists (select 1 from public.packages p where lower(btrim(p.name)) = lower(t.name))
order by t.ord;

insert into public.sms_templates (name, template_text)
select 'Payment Received',
       E'Dear {{customer_name}},\n\n' ||
       E'We have received your payment of Rs. {{amount}} for {{month}}.\n' ||
       E'Receipt No: {{receipt_number}}\n' ||
       E'Remaining balance: Rs. {{remaining}}\n\n' ||
       E'Thank you,\n{{company_name}}'
where not exists (select 1 from public.sms_templates where lower(name) = 'payment received');

insert into public.accounts (name, account_type)
select t.name, t.type from (values (1,'Cash Box','cash'),(2,'Bank Account','bank')) t(ord, name, type)
where not exists (select 1 from public.accounts a where lower(btrim(a.name)) = lower(t.name))
order by t.ord;
