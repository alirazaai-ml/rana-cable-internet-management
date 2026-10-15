-- ============================================================
-- 0000 — Extensions
-- ============================================================
-- Must run first. Everything else depends on these types.
-- ============================================================

-- Case-insensitive text (for unique area / package names).
create extension if not exists "citext";

-- Fast fuzzy text search (customer name search).
create extension if not exists "pg_trgm";

-- Cryptographically secure random UUID generation (used for receipt numbers, tokens).
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- Business timezone helper.
-- Supabase runs in UTC, but the business (and the app) use
-- Asia/Karachi (UTC+5). Using current_date would make "today" and
-- "this month" wrong for the first 5 hours of every day/month.
-- Every date default, view and function uses this instead.
-- ------------------------------------------------------------
create or replace function public.today_pk()
returns date
language sql
stable
as $$ select (now() at time zone 'Asia/Karachi')::date $$;
