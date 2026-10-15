import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { Pencil, Plus, Power } from 'lucide-react'
import { Button, Select, toast } from '@/components/ui'
import { ConfirmDialog, Money, PageHeader, StatusBadge } from '@/components/shared'
import { DataTable } from '@/components/shared/DataTable'
import { useSb, supabase, errMsg } from '@/lib/query'
import { useAreas, useEmployeeOptions, useIsAdmin, usePackages } from '@/hooks/useRefData'
import type { Customer } from '@/types/database'
import CustomerFormDialog from './CustomerForm'

export default function CustomersPage() {
  const isAdmin = useIsAdmin()
  const qc = useQueryClient()
  const { data, isLoading, error, refetch } = useSb<Customer[]>(['customers'], () =>
    supabase.from('customers').select('*, areas(name), packages(name, monthly_fee)').order('customer_code').limit(5000))
  const areas = useAreas().data ?? []
  const packages = usePackages().data ?? []
  const sellerOptions = useEmployeeOptions().data
  const sellers = useMemo(() => new Map((sellerOptions ?? []).map((e) => [e.id, e.full_name])), [sellerOptions])
  const [area, setArea] = useState(''); const [pkg, setPkg] = useState(''); const [status, setStatus] = useState('')
  const [edit, setEdit] = useState<Customer | null>(null); const [open, setOpen] = useState(false)
  const [toggle, setToggle] = useState<Customer | null>(null); const [busy, setBusy] = useState(false)

  const rows = useMemo(() => (data ?? []).filter((c) =>
    (!area || c.area_id === +area) && (!pkg || c.package_id === +pkg) && (!status || c.customer_status === status)), [data, area, pkg, status])

  const columns = useMemo<ColumnDef<Customer>[]>(() => [
    { accessorKey: 'customer_code', header: 'Code' },
    { accessorKey: 'username', header: 'Customer', cell: ({ row }) => <div><div className="font-medium">{row.original.username}</div><div className="text-xs text-slate-500">{row.original.phone}</div></div> },
    { id: 'area', header: 'Area', accessorFn: (r) => r.areas?.name ?? '' },
    { id: 'package', header: 'Package', accessorFn: (r) => r.packages?.name ?? '' },
    { id: 'seller', header: 'Seller', accessorFn: (r) => (r.seller_id != null ? sellers.get(r.seller_id) : undefined) ?? '-' },
    { accessorKey: 'balance', header: 'Balance', cell: ({ getValue }) => <Money value={getValue<number>()} className={getValue<number>() > 0 ? 'font-medium text-red-700' : ''} /> },
    { accessorKey: 'service_status', header: 'Service', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} label={getValue<string>() === 'on' ? 'On' : 'Off'} /> },
    { accessorKey: 'customer_status', header: 'Status', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} /> },
    { id: 'actions', header: '', enableSorting: false, cell: ({ row }) => (
      <div className="flex gap-1">
        <Button variant="ghost" size="sm" aria-label="Edit" onClick={() => { setEdit(row.original); setOpen(true) }}><Pencil className="h-4 w-4" /></Button>
        {isAdmin && <Button variant="ghost" size="sm" aria-label="Toggle active" onClick={() => setToggle(row.original)}><Power className="h-4 w-4" /></Button>}
      </div>) },
  ], [isAdmin, sellers])

  async function doToggle() {
    if (!toggle) return
    setBusy(true)
    const next = toggle.customer_status === 'active' ? 'inactive' : 'active'
    const { error: e } = await supabase.from('customers').update({ customer_status: next, ...(next === 'inactive' ? { service_status: 'off' } : {}) }).eq('id', toggle.id)
    setBusy(false)
    if (e) return toast.err(errMsg(e))
    toast.ok(`Customer ${next === 'active' ? 'reactivated' : 'deactivated'}`)
    setToggle(null); await qc.invalidateQueries({ queryKey: ['customers'] })
  }

  return (
    <div>
      <PageHeader title="Customers" actions={<Button onClick={() => { setEdit(null); setOpen(true) }}><Plus className="h-4 w-4" />Add customer</Button>} />
      <DataTable columns={columns} data={rows} isLoading={isLoading} error={error} onRetry={() => void refetch()}
        searchPlaceholder="Search name, phone, code..." emptyTitle="No customers yet" emptyHint="Add your first customer."
        toolbar={<>
          <Select className="w-auto" value={area} onChange={(e) => setArea(e.target.value)} aria-label="Area"><option value="">All areas</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
          <Select className="w-auto" value={pkg} onChange={(e) => setPkg(e.target.value)} aria-label="Package"><option value="">All packages</option>{packages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          <Select className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Any status</option><option value="active">Active</option><option value="inactive">Inactive</option></Select>
        </>} />
      <CustomerFormDialog open={open} onClose={() => setOpen(false)} customer={edit} />
      <ConfirmDialog open={!!toggle} danger={toggle?.customer_status === 'active'} loading={busy} onCancel={() => setToggle(null)} onConfirm={() => void doToggle()}
        title={toggle?.customer_status === 'active' ? 'Deactivate customer?' : 'Reactivate customer?'} confirmLabel={toggle?.customer_status === 'active' ? 'Deactivate' : 'Reactivate'}
        message={toggle?.customer_status === 'active' ? `${toggle?.username} will be marked inactive and service switched off. Payment history is kept; customers are never deleted.` : `${toggle?.username} will be marked active again.`} />
    </div>
  )
}
