import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Input, Select } from '@/components/ui'
import { PageHeader, StatusBadge } from '@/components/shared'
import { DataTable } from '@/components/shared/DataTable'
import { supabase, useSb } from '@/lib/query'
import { formatDateTime } from '@/lib/format'
import type { SmsLog } from '@/types/database'

export default function SmsLogsPage() {
  const [status, setStatus] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const { data, isLoading, error, refetch } = useSb<SmsLog[]>(['sms-logs'], () => supabase.from('sms_logs').select('*, customers(username)').order('created_at', { ascending: false }).limit(3000))
  const rows = useMemo(() => (data ?? []).filter((r) => (!status || r.status === status) && (!from || r.created_at.slice(0, 10) >= from) && (!to || r.created_at.slice(0, 10) <= to)), [data, status, from, to])
  const columns = useMemo<ColumnDef<SmsLog>[]>(() => [
    { accessorKey: 'created_at', header: 'Created', cell: ({ getValue }) => formatDateTime(getValue<string>()) },
    { id: 'customer', header: 'Customer', accessorFn: (r) => r.customers?.username ?? '-' },
    { accessorKey: 'phone', header: 'Phone' },
    { accessorKey: 'message_text', header: 'Message', cell: ({ getValue }) => <span className="line-clamp-2 max-w-md">{getValue<string>()}</span> },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} /> },
    { accessorKey: 'sent_at', header: 'Sent', cell: ({ getValue }) => formatDateTime(getValue<string | null>()) },
  ], [])
  return (
    <div>
      <PageHeader title="SMS / WhatsApp Logs" subtitle="Every message prepared by the system" />
      <DataTable columns={columns} data={rows} isLoading={isLoading} error={error} onRetry={() => void refetch()} searchPlaceholder="Search customer, phone, text..." emptyTitle="No messages yet"
        toolbar={<><Select className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option><option value="pending">Pending</option><option value="sent">Sent</option><option value="failed">Failed</option></Select>
          <Input type="date" className="w-auto" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" /><Input type="date" className="w-auto" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" /></>} />
    </div>
  )
}
