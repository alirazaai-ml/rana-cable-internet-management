import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Link } from 'react-router-dom'
import { Banknote, Users, UserPlus, AlertTriangle, Wallet } from 'lucide-react'
import { Card, Skeleton } from '@/components/ui'
import { ErrorState, Money, PageHeader, Stat } from '@/components/shared'
import { useSb } from '@/lib/query'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/format'

interface Stats {
  total_customers: number; active_customers: number; inactive_customers: number
  month_collections: number; outstanding_total: number; unpaid_count: number; partial_count: number; overdue_count: number
  recent_payments: { id: number; amount_paid: number; payment_date: string; receipt_number: string; customer_name: string }[]
  recent_customers: { id: number; customer_code: string; username: string; created_at: string }[]
  customers_per_area: { name: string; count: number }[]
  collections_per_employee: { name: string; total: number }[]
}

export default function AdminDashboard() {
  const { data, isLoading, error, refetch } = useSb<Stats>(['admin-stats'], () => supabase.rpc('admin_dashboard_stats'))
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />
  if (isLoading || !data) return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" subtitle="Overview of customers and collections" />
      <div className="flex flex-wrap gap-2">
        <Link to="/admin/customers" className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white"><UserPlus className="h-4 w-4" />Add customer</Link>
        <Link to="/admin/collections" className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-green-600 px-4 text-sm font-medium text-white"><Banknote className="h-4 w-4" />Collections</Link>
        <Link to="/admin/complaints" className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border bg-white px-4 text-sm font-medium"><AlertTriangle className="h-4 w-4" />Complaints</Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total customers">{data.total_customers}</Stat>
        <Stat label="Active" tone="text-blue-700">{data.active_customers}</Stat>
        <Stat label="Inactive" tone="text-slate-500">{data.inactive_customers}</Stat>
        <Stat label="This month collected" tone="text-green-700"><Money value={data.month_collections} /></Stat>
        <Stat label="Outstanding balance" tone="text-red-700"><Money value={data.outstanding_total} /></Stat>
        <Stat label="Unpaid fees">{data.unpaid_count}</Stat>
        <Stat label="Partial fees" tone="text-amber-600">{data.partial_count}</Stat>
        <Stat label="Overdue fees" tone="text-red-700">{data.overdue_count}</Stat>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4"><h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-800"><Users className="h-4 w-4" />Customers per area</h2>
          <div className="h-64"><ResponsiveContainer><BarChart data={data.customers_per_area}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" fontSize={12} /><YAxis allowDecimals={false} fontSize={12} /><Tooltip /><Bar dataKey="count" fill="#2563eb" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></Card>
        <Card className="p-4"><h2 className="mb-3 flex items-center gap-2 font-semibold"><Wallet className="h-4 w-4" />Collections per employee (this month)</h2>
          {data.collections_per_employee.length === 0 ? <p className="py-10 text-center text-sm text-slate-500">No collections this month yet.</p> :
            <div className="h-64"><ResponsiveContainer><BarChart data={data.collections_per_employee}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" fontSize={12} /><YAxis fontSize={12} /><Tooltip formatter={(v: number) => `Rs. ${v.toLocaleString()}`} /><Bar dataKey="total" fill="#16a34a" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>}</Card>
        <Card className="p-4"><h2 className="mb-3 font-semibold">Recent payments</h2>
          <ul className="divide-y text-sm">{data.recent_payments.length === 0 && <li className="py-3 text-slate-500">None yet.</li>}
            {data.recent_payments.map((p) => <li key={p.id} className="flex justify-between gap-2 py-2"><span>{p.customer_name}<span className="block text-xs text-slate-500">{p.receipt_number} - {formatDate(p.payment_date)}</span></span><Money value={p.amount_paid} className="font-medium text-green-700" /></li>)}</ul></Card>
        <Card className="p-4"><h2 className="mb-3 font-semibold">Recent registrations</h2>
          <ul className="divide-y text-sm">{data.recent_customers.length === 0 && <li className="py-3 text-slate-500">None yet.</li>}
            {data.recent_customers.map((c) => <li key={c.id} className="flex justify-between gap-2 py-2"><span>{c.username}</span><span className="text-xs text-slate-500">{c.customer_code} - {formatDate(c.created_at)}</span></li>)}</ul></Card>
      </div>
    </div>
  )
}
