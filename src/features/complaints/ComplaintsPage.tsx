import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { Pencil, Plus } from 'lucide-react'
import { Button, Dialog, Field, Input, Select, Textarea, toast } from '@/components/ui'
import { PageHeader, StatusBadge } from '@/components/shared'
import { DataTable } from '@/components/shared/DataTable'
import { supabase, useSb, errMsg } from '@/lib/query'
import { complaintSchema } from '@/lib/validation/schemas'
import { useIsAdmin } from '@/hooks/useRefData'
import { useAuth } from '@/features/auth/AuthContext'
import { formatDateTime, titleCase } from '@/lib/format'
import type { Complaint } from '@/types/database'
import type { z } from 'zod'

type F = z.infer<typeof complaintSchema>
const STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const

export default function ComplaintsPage() {
  const isAdmin = useIsAdmin()
  const { profile } = useAuth()
  const qc = useQueryClient()
  const { data, isLoading, error, refetch } = useSb<Complaint[]>(['complaints'], () =>
    supabase.from('complaints').select('*, customers(username, customer_code), assignee:profiles!assigned_to(full_name)').order('created_at', { ascending: false }).limit(2000))
  const customers = useSb<{ id: number; username: string; customer_code: string }[]>(['customer-names'], () => supabase.from('customers').select('id, username, customer_code').order('username').limit(5000))
  const staff = useSb<{ id: string; full_name: string }[]>(['staff-profiles'], () => supabase.from('profiles').select('id, full_name').eq('is_active', true).order('full_name'), isAdmin)
  const [status, setStatus] = useState('')
  const [createOpen, setCreateOpen] = useState(false); const [edit, setEdit] = useState<Complaint | null>(null)
  const [q, setQ] = useState('')

  const cf = useForm<F>({ resolver: zodResolver(complaintSchema) as never, defaultValues: { category: 'other', complaint_text: '' } })
  async function create(v: F) {
    const { error: e } = await supabase.from('complaints').insert({ customer_id: v.customer_id, category: v.category, complaint_text: v.complaint_text, created_by: profile!.id })
    if (e) return toast.err(e.message)
    toast.ok('Complaint recorded'); cf.reset(); setCreateOpen(false); await qc.invalidateQueries({ queryKey: ['complaints'] })
  }

  const [eStatus, setEStatus] = useState<Complaint['status']>('open'); const [eAssign, setEAssign] = useState(''); const [eNotes, setENotes] = useState('')
  function openEdit(c: Complaint) { setEdit(c); setEStatus(c.status); setEAssign(c.assigned_to ?? ''); setENotes(c.resolution_notes ?? '') }
  async function saveEdit() {
    const done = eStatus === 'resolved' || eStatus === 'closed'
    const upd: Record<string, unknown> = { status: eStatus, resolution_notes: eNotes || null, resolved_at: done ? (edit!.resolved_at ?? new Date().toISOString()) : null }
    if (isAdmin) upd.assigned_to = eAssign || null
    const { error: e } = await supabase.from('complaints').update(upd).eq('id', edit!.id)
    if (e) return toast.err(errMsg(e))
    toast.ok('Complaint updated'); setEdit(null); await qc.invalidateQueries({ queryKey: ['complaints'] })
  }

  const rows = useMemo(() => (data ?? []).filter((c) => !status || c.status === status), [data, status])
  const matches = useMemo(() => { const s = q.toLowerCase(); return (customers.data ?? []).filter((c) => !s || (c.username + c.customer_code).toLowerCase().includes(s)).slice(0, 40) }, [customers.data, q])

  const columns = useMemo<ColumnDef<Complaint>[]>(() => [
    { accessorKey: 'created_at', header: 'Date', cell: ({ getValue }) => formatDateTime(getValue<string>()) },
    { id: 'customer', header: 'Customer', accessorFn: (r) => r.customers?.username ?? '', cell: ({ row }) => <div><div className="font-medium">{row.original.customers?.username}</div><div className="text-xs text-slate-500">{row.original.customers?.customer_code}</div></div> },
    { accessorKey: 'category', header: 'Category', cell: ({ getValue }) => titleCase(getValue<string>()) },
    { accessorKey: 'complaint_text', header: 'Complaint', cell: ({ getValue }) => <span className="line-clamp-2 max-w-xs">{getValue<string>()}</span> },
    { id: 'assignee', header: 'Assigned to', accessorFn: (r) => r.assignee?.full_name ?? (r.assigned_to ? (r.assigned_to === profile?.id ? 'Me' : 'Assigned') : '-') },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} /> },
    { id: 'a', header: '', enableSorting: false, cell: ({ row }) => (isAdmin || row.original.assigned_to === profile?.id) ? <Button variant="ghost" size="sm" aria-label="Update" onClick={() => openEdit(row.original)}><Pencil className="h-4 w-4" /></Button> : null },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [isAdmin, profile?.id])

  return (
    <div>
      <PageHeader title="Complaints" subtitle={isAdmin ? 'All complaints' : 'Complaints you created or that are assigned to you'} actions={<Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" />New complaint</Button>} />
      <DataTable columns={columns} data={rows} isLoading={isLoading} error={error} onRetry={() => void refetch()} searchPlaceholder="Search complaints..." emptyTitle="No complaints"
        toolbar={<Select className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>} />

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="New complaint">
        <form onSubmit={cf.handleSubmit(create)} className="space-y-3">
          <Field label="Find customer"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type name or code" /></Field>
          <Field label="Customer *" error={cf.formState.errors.customer_id?.message}><Select size={4} className="h-auto" {...cf.register('customer_id')}>{matches.map((c) => <option key={c.id} value={c.id}>{c.username} ({c.customer_code})</option>)}</Select></Field>
          <Field label="Category"><Select {...cf.register('category')}><option value="slow_speed">Slow speed</option><option value="no_connection">No connection</option><option value="billing">Billing</option><option value="hardware">Hardware</option><option value="other">Other</option></Select></Field>
          <Field label="Problem *" error={cf.formState.errors.complaint_text?.message}><Textarea {...cf.register('complaint_text')} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button><Button type="submit" loading={cf.formState.isSubmitting}>Save</Button></div>
        </form>
      </Dialog>

      <Dialog open={!!edit} onClose={() => setEdit(null)} title="Update complaint">
        <p className="mb-3 rounded bg-slate-50 p-2 text-sm">{edit?.complaint_text}</p>
        <div className="space-y-3">
          {isAdmin && <Field label="Assign to"><Select value={eAssign} onChange={(e) => setEAssign(e.target.value)}><option value="">Unassigned</option>{(staff.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</Select></Field>}
          <Field label="Status"><Select value={eStatus} onChange={(e) => setEStatus(e.target.value as Complaint['status'])}>{STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select></Field>
          <Field label="Resolution notes"><Textarea value={eNotes} onChange={(e) => setENotes(e.target.value)} /></Field>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={() => void saveEdit()}>Save</Button></div>
        </div>
      </Dialog>
    </div>
  )
}
