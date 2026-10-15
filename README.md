# ICRMS

Internet Customer Records and Monthly Fee Collection System built with React,
Vite, TypeScript, and Supabase.

## Features

- Role-based Supabase authentication for administrators and fee-collecting staff.
- Customer, package, area, complaint, SMS, journal, and account management.
- Monthly fee schedules with partial payments, payment status, receipts, reversals,
  audit logs, and concurrency-safe collection RPCs.
- Administrators create employee login accounts from **Employees**. The browser
  never receives a service-role key.
- Admin-only customer data exports in CSV, XLSX, PDF, and JSON.
- Responsive mobile/tablet/desktop layout with lazy-loaded routes.
- PostgreSQL `health_check()` RPC and a GitHub Actions ping every three days.

## Requirements

- Node.js 20 or newer and npm.
- A Supabase project with email/password authentication enabled.
- Supabase CLI (only needed to apply migrations and deploy the Edge Function).

## Local setup

```sh
npm install
copy .env.local.example .env.local
npm run dev
```

Set these browser-safe variables in `.env.local`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

Never put `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` or any frontend build.

## Database setup

The database was redesigned so that inserts do not fail: the database now fills
in everything the app does not send (customer code, receipt number, due date,
creator, balances) and enforces the money rules itself, even for direct SQL.
See [`supabase/DATABASE.md`](supabase/DATABASE.md) for the full design.

### New project (empty Supabase)

Run the five files in `supabase/migrations` in order, either in the Supabase
SQL Editor or with the CLI:

```sh
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

### Project that already has the OLD schema (keeps all your data)

1. Take a backup first (Supabase Dashboard -> Database -> Backups).
2. Open the SQL Editor, paste the whole of `supabase/manual/rebuild_database.sql`
   and run it. It runs as one transaction: it moves the old tables (with data)
   into a schema called `old_backup`, builds the new schema, and copies the data
   back. If anything fails, nothing changes.
3. Sign out and back in, check the app, then optionally run
   `drop schema old_backup cascade;`.

If you use the CLI afterwards, mark the old migration versions as reverted so
the history matches: `supabase migration repair --status reverted 0000 0001 ... 0010`.
(`supabase/legacy_migrations` holds the old files for reference only.)

### Create the first administrator

Create an Auth user (Dashboard -> Authentication -> Users), then run:

```sql
insert into public.profiles (id, full_name, role)
values ('AUTH_USER_UUID', 'System Administrator', 'admin');
```

### Importing existing customers / payments with SQL

Plain inserts just work now (`customer_code`, `due_date`, `receipt_number`,
`customer_id` on a payment, ... are optional). When you load **historical** rows
that carry their own ids, wrap them like this so no extra journal / account /
audit rows are created, then fix the id counters:

```sql
begin;
select set_config('app.bulk_load', 'on', true);
-- insert into public.customers (...) / monthly_fees (...) / payments (...)
commit;
select public.fix_sequences();
select public.recompute_all_balances();
```

### Self-test

`supabase/manual/tests.sql` is an assertion script (87 checks covering
inserts, money rules, RLS for admin / staff / anon). Run it only on a throw-away
database: `psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/manual/tests.sql`.

## Employee management

Sign in as an administrator and open **Employees → Add staff account**. The
`create-staff` Edge Function validates the caller as an active administrator,
creates the Auth user, profile, and employee record transactionally, and accepts
no role from the browser. Deploy it with:

```sh
supabase functions deploy create-staff
```

Keep the service-role secret in Supabase Edge Function secrets only.

## Health check automation

Add these repository secrets in GitHub:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

`.github/workflows/supabase-health.yml` calls
`POST /rest/v1/rpc/health_check` every three days and can also be run manually.

## Backup and exports

Administrators can open **Backup & Export**. Optional search filtering is
applied after the RLS-protected, paginated customer query for CSV, XLSX, and
PDF. The **Full JSON Backup** includes every customer, monthly fee, and payment
record and intentionally ignores the search filter. CSV and JSON are plain
text exports; XLSX is a real workbook; PDF is a landscape table. Export files
are generated locally in the browser and are never sent to an external
service. Access is protected by the admin route and database RLS.

On **Collections**, the current-month customer table creates missing monthly
fee rows safely, shows paid/partial/unpaid/overdue status, and provides a
**Fee Successfully Received** state after the monthly balance reaches zero.
Both administrators and active staff can record payments; only administrators
can reverse them.

For a full database backup, use Supabase Dashboard → Database → Backups, or:

```sh
supabase db dump --linked --data-only > backup.sql
```

Store downloaded exports and SQL backups securely because they contain personal
customer data.

## Commands

```sh
npm run typecheck
npm run build
npm run dev
npm run preview
```

There is no production service-role credential in the frontend. Before
deployment, configure the Supabase URL/key in the hosting provider, deploy the
Edge Function, apply migrations, and verify RLS with both an admin and a staff
account.

## Project structure

```text
src/app             providers and route definitions
src/components      reusable UI, layout, and table components
src/features        domain pages (customers, fees, employees, backup, ...)
src/hooks            shared Supabase reference-data hooks
src/lib              Supabase client, validation, formatting, query helpers
src/types            database-facing TypeScript types
supabase/migrations  schema, triggers, views/RPCs, RLS, seed (5 ordered files)
supabase/manual      rebuild / restore scripts and the database self-test
supabase/functions   server-side operations requiring service-role access
.github/workflows    scheduled operational checks
```
