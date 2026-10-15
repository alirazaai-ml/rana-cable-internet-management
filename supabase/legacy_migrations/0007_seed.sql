-- ============================================================
-- 0007 — Seed data
-- ============================================================
-- Areas, packages, SMS template. Safe to re-run.
-- ============================================================

insert into public.areas (name) values
  ('Village 1'), ('Village 2'), ('Village 3'),
  ('Village 4'), ('Village 5'), ('Village 6')
on conflict (name) do nothing;

insert into public.packages (name, speed_label, monthly_fee) values
  ('1MB', '1 Mbps', 1500.00),
  ('2MB', '2 Mbps', 2000.00),
  ('3MB', '3 Mbps', 2500.00),
  ('4MB', '4 Mbps', 3000.00)
on conflict (name) do nothing;

insert into public.sms_templates (name, template_text) values
  (
    'Payment Received',
    E'Dear {{customer_name}},\n\n' ||
    E'We have received your payment of Rs. {{amount}} for {{month}}.\n' ||
    E'Receipt No: {{receipt_number}}\n' ||
    E'Remaining balance: Rs. {{remaining}}\n\n' ||
    E'Thank you,\n{{company_name}}'
  )
on conflict (name) do nothing;

-- A cash box and a bank account so collections can post to an account.
-- Rename / add more from the Accounts page.
insert into public.accounts (name, account_type) values
  ('Cash Box', 'cash'),
  ('Bank Account', 'bank')
on conflict (name) do nothing;
