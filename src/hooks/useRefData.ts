import { useSb } from '@/lib/query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthContext'
import type { Area, Employee, EmployeeOption, Package } from '@/types/database'

// Reference data changes rarely: keep it for 5 minutes instead of refetching on every page.
const REF_STALE = 5 * 60_000

export const useAreas = () => useSb<Area[]>(['areas'], () => supabase.from('areas').select('*').order('name'), true, REF_STALE)
export const usePackages = () => useSb<Package[]>(['packages'], () => supabase.from('packages').select('*').order('monthly_fee'), true, REF_STALE)
/** Full HR records incl. salary. Admin only (the database refuses staff). */
export const useEmployees = () => useSb<Employee[]>(['employees'], () => supabase.from('employees').select('*, areas(name)').order('full_name'))
/** id + name only, safe for every signed-in user (dropdowns, seller names). */
export const useEmployeeOptions = () => useSb<EmployeeOption[]>(['employee-options'], () => supabase.from('employee_directory').select('id, full_name, is_active').order('full_name'), true, REF_STALE)
export const useIsAdmin = () => useAuth().profile?.role === 'admin'
