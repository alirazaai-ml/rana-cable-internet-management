-- ============================================================
-- 0009 — employee_directory view
-- ============================================================
-- A safe, non-sensitive view of employees for dropdowns.
-- Excludes salary, CNIC, notes — anything HR-only.
-- Used by useEmployeeOptions() in the frontend.
-- ============================================================

create or replace view public.employee_directory as
select
  id,
  profile_id,
  full_name,
  role_title,
  area_id,
  is_active,
  joined_at
from public.employees;