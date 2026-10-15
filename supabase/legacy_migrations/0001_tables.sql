-- ============================================================
-- 0001 — Tables, constraints, indexes
-- ============================================================
-- Order matters: referenced tables must exist before the
-- referencing table. Follows: profiles → areas → packages →
-- employees → customers → monthly_fees → payments → the rest.
-- ============================================================

-- ------------------------------------------------------------
-- PROFILES — application users linked 1:1 with auth.users
-- ------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  role        text not null default 'staff' check (role in ('admin','staff')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- AREAS — villages served
-- ------------------------------------------------------------
create table public.areas (
  id          bigint generated always as identity primary key,
  name        citext not null unique,
  description text,
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- PACKAGES — billing tiers (1MB, 2MB, 3MB, 4MB ...)
-- monthly_fee is what a customer on this package pays each month.
-- ------------------------------------------------------------
create table public.packages (
  id           bigint generated always as identity primary key,
  name         text not null unique,
  speed_label  text,
  monthly_fee  numeric(10,2) not null check (monthly_fee >= 0),
  description  text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ------------------------------------------------------------
-- EMPLOYEES — staff HR records (separate from profiles)
-- A staff member has an auth account (profiles) AND an HR
-- record (employees). profile_id links them. Can be null for
-- non-login field workers if the owner ever hires them.
-- ------------------------------------------------------------
create table public.employees (
  id              bigint generated always as identity primary key,
  profile_id      uuid unique references public.profiles(id) on delete set null,
  full_name       text not null,
  phone           text,
  role_title      text,
  area_id         bigint references public.areas(id) on delete set null,
  monthly_salary  numeric(10,2) check (monthly_salary is null or monthly_salary >= 0),
  is_active       boolean not null default true,
  joined_at       date not null default public.today_pk(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index employees_area_idx on public.employees (area_id);
create index employees_active_idx on public.employees (is_active);

-- ------------------------------------------------------------
-- CUSTOMERS
-- balance is a DERIVED value, recomputed by triggers.
-- opening_balance is what the customer owed before they joined
-- the digital system (transferred from paper register).
-- ------------------------------------------------------------
create table public.customers (
  id                bigint generated always as identity primary key,
  customer_code     text not null unique,
  username          text not null,
  phone             text not null,
  package_id        bigint not null references public.packages(id),
  area_id           bigint not null references public.areas(id),
  seller_id         bigint references public.employees(id) on delete set null,
  address           text,
  opening_balance   numeric(10,2) not null default 0 check (opening_balance >= 0),
  balance           numeric(10,2) not null default 0,
  service_status    text not null default 'on' check (service_status in ('on','off')),
  customer_status   text not null default 'active' check (customer_status in ('active','inactive')),
  cnic              text,
  father_name       text,
  notes             text,
  created_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index customers_area_idx          on public.customers (area_id);
create index customers_package_idx       on public.customers (package_id);
create index customers_seller_idx        on public.customers (seller_id);
create index customers_status_idx        on public.customers (customer_status);
create index customers_service_idx       on public.customers (service_status);
create index customers_phone_idx         on public.customers (phone);
create index customers_username_trgm_idx on public.customers using gin (username gin_trgm_ops);

-- ------------------------------------------------------------
-- MONTHLY_FEES — one invoice per customer per month
-- billing_month is always the 1st of the month.
-- amount_due is a snapshot; changing the package later does
-- not change past invoices.
-- ------------------------------------------------------------
create table public.monthly_fees (
  id             bigint generated always as identity primary key,
  customer_id    bigint not null references public.customers(id) on delete restrict,
  billing_month  date not null,
  amount_due     numeric(10,2) not null check (amount_due >= 0),
  due_date       date not null,
  package_id     bigint references public.packages(id),
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  constraint monthly_fees_unique_customer_month unique (customer_id, billing_month),
  constraint monthly_fees_first_of_month check (date_trunc('month', billing_month) = billing_month)
);

create index monthly_fees_customer_idx on public.monthly_fees (customer_id);
create index monthly_fees_month_idx    on public.monthly_fees (billing_month);
create index monthly_fees_due_idx      on public.monthly_fees (due_date);

-- ------------------------------------------------------------
-- PAYMENTS — never deleted; reversed via reversed_at
-- ------------------------------------------------------------
create table public.payments (
  id                bigint generated always as identity primary key,
  customer_id       bigint not null references public.customers(id) on delete restrict,
  monthly_fee_id    bigint not null references public.monthly_fees(id) on delete restrict,
  amount_paid       numeric(10,2) not null check (amount_paid > 0),
  payment_method    text not null check (payment_method in ('cash','bank_transfer','other')),
  payment_date      date not null default public.today_pk(),
  received_by       uuid not null references public.profiles(id),
  receipt_number    text not null unique,
  notes             text,
  reversed_at       timestamptz,
  reversed_by       uuid references public.profiles(id),
  reversal_reason   text,
  whatsapp_sent     boolean not null default false,
  whatsapp_sent_at  timestamptz,
  created_at        timestamptz not null default now(),
  constraint payments_reversal_consistent check (
    (reversed_at is null and reversed_by is null and reversal_reason is null)
    or
    (reversed_at is not null and reversed_by is not null and reversal_reason is not null)
  )
);

create index payments_customer_idx    on public.payments (customer_id);
create index payments_fee_idx         on public.payments (monthly_fee_id);
create index payments_date_idx        on public.payments (payment_date);
create index payments_received_by_idx on public.payments (received_by);
create index payments_reversed_idx    on public.payments (reversed_at) where reversed_at is null;

-- ------------------------------------------------------------
-- COMPLAINTS
-- ------------------------------------------------------------
create table public.complaints (
  id                bigint generated always as identity primary key,
  customer_id       bigint not null references public.customers(id) on delete restrict,
  complaint_text    text not null,
  category          text not null default 'other'
                     check (category in ('slow_speed','no_connection','billing','hardware','other')),
  status            text not null default 'open'
                     check (status in ('open','in_progress','resolved','closed')),
  assigned_to       uuid references public.profiles(id) on delete set null,
  resolution_notes  text,
  created_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  resolved_at       timestamptz
);

create index complaints_customer_idx on public.complaints (customer_id);
create index complaints_status_idx   on public.complaints (status);
create index complaints_assigned_idx on public.complaints (assigned_to);

-- ------------------------------------------------------------
-- JOURNAL_ENTRIES — daily cash book (income / expense)
-- ------------------------------------------------------------
create table public.journal_entries (
  id                    bigint generated always as identity primary key,
  entry_date            date not null default public.today_pk(),
  entry_type            text not null check (entry_type in ('income','expense')),
  category              text not null,
  amount                numeric(10,2) not null check (amount > 0),
  description           text,
  reference_payment_id  bigint references public.payments(id) on delete set null,
  created_by            uuid references public.profiles(id),
  created_at            timestamptz not null default now()
);

create index journal_entries_date_idx on public.journal_entries (entry_date);

-- ------------------------------------------------------------
-- ACCOUNTS — business cash box, bank accounts
-- ------------------------------------------------------------
create table public.accounts (
  id               bigint generated always as identity primary key,
  name             text not null unique,
  account_type     text not null check (account_type in ('cash','bank')),
  current_balance  numeric(12,2) not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

create table public.account_transactions (
  id                    bigint generated always as identity primary key,
  account_id            bigint not null references public.accounts(id) on delete restrict,
  transaction_type      text not null check (transaction_type in ('credit','debit')),
  amount                numeric(10,2) not null check (amount > 0),
  description           text,
  reference_payment_id  bigint references public.payments(id) on delete set null,
  created_by            uuid references public.profiles(id),
  created_at            timestamptz not null default now()
);

create index account_tx_account_idx on public.account_transactions (account_id);

-- ------------------------------------------------------------
-- SMS_TEMPLATES — message templates with {{placeholders}}
-- ------------------------------------------------------------
create table public.sms_templates (
  id             bigint generated always as identity primary key,
  name           text not null unique,
  template_text  text not null,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ------------------------------------------------------------
-- SMS_LOGS — history of every message generated
-- ------------------------------------------------------------
create table public.sms_logs (
  id                  bigint generated always as identity primary key,
  customer_id         bigint references public.customers(id) on delete set null,
  phone               text not null,
  message_text        text not null,
  status              text not null default 'pending'
                       check (status in ('pending','sent','failed')),
  provider            text not null default 'whatsapp_manual',
  error_message       text,
  sent_by             uuid references public.profiles(id) on delete set null,
  related_payment_id  bigint references public.payments(id) on delete set null,
  created_at          timestamptz not null default now(),
  sent_at             timestamptz
);

create index sms_logs_customer_idx on public.sms_logs (customer_id);
create index sms_logs_status_idx   on public.sms_logs (status);
create index sms_logs_payment_idx  on public.sms_logs (related_payment_id);
create index sms_logs_created_idx  on public.sms_logs (created_at desc);

-- ------------------------------------------------------------
-- COMPANY_LOGS — audit trail written only by triggers
-- ------------------------------------------------------------
create table public.company_logs (
  id           bigint generated always as identity primary key,
  actor_id     uuid references public.profiles(id) on delete set null,
  action       text not null,
  entity_type  text not null,
  entity_id    text,
  details      jsonb,
  created_at   timestamptz not null default now()
);

create index company_logs_actor_idx   on public.company_logs (actor_id);
create index company_logs_created_idx on public.company_logs (created_at desc);
create index company_logs_entity_idx  on public.company_logs (entity_type, entity_id);

-- ------------------------------------------------------------
-- Extra indexes used by RLS policies and common lookups.
-- ------------------------------------------------------------
create index if not exists complaints_created_by_idx on public.complaints (created_by);
create index if not exists sms_logs_sent_by_idx      on public.sms_logs (sent_by);
create index if not exists journal_ref_payment_idx   on public.journal_entries (reference_payment_id);
create index if not exists account_tx_payment_idx    on public.account_transactions (reference_payment_id);
