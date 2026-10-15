import { Link } from 'react-router-dom'
import { Banknote, UserPlus } from 'lucide-react'
import { Skeleton } from '@/components/ui'
import { ErrorState, Money, PageHeader, Stat } from '@/components/shared'
import { useSb } from '@/lib/query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthContext'

interface S { today_collections: number; month_collections: number; my_customers: number; area_outstanding: number; area_name: string | null }

export default function StaffDashboard() {
  const { profile } = useAuth()
  const { data, isLoading, error, refetch } = useSb<S>(['staff-stats'], () => supabase.rpc('staff_dashboard_stats'))
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />
  return (
    <div className="space-y-5">
      <PageHeader title={`Hello, ${profile?.full_name ?? ''}`} subtitle="Your collections at a glance" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Link to="/staff/collections" className="flex min-h-[56px] items-center justify-center gap-2 rounded-xl bg-green-600 text-base font-semibold text-white"><Banknote />Collections</Link>
        <Link to="/staff/customers" className="flex min-h-[56px] items-center justify-center gap-2 rounded-xl bg-brand-600 text-base font-semibold text-white"><UserPlus />Customers</Link>
      </div>
      {isLoading || !data ? <Skeleton className="h-40" /> : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Stat label="My collections today" tone="text-green-700"><Money value={data.today_collections} /></Stat>
          <Stat label="My collections this month" tone="text-green-700"><Money value={data.month_collections} /></Stat>
          <Stat label="My assigned customers">{data.my_customers}</Stat>
          <Stat label={`Outstanding${data.area_name ? ' in ' + data.area_name : ''}`} tone="text-red-700"><Money value={data.area_outstanding} /></Stat>
        </div>
      )}
    </div>
  )
}
