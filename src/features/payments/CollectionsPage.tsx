import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { CheckCircle2, MessageCircle, Search, Undo2 } from 'lucide-react'
import { Button, Card, Field, Input, Select, Skeleton, Textarea, toast } from '@/components/ui'
import { ConfirmDialog, ErrorState, Money, PageHeader, StatusBadge } from '@/components/shared'
import { DataTable } from '@/components/shared/DataTable'
import { supabase, useSb, errMsg } from '@/lib/query'
import { currentMonthStart, formatDate, formatMoney, formatMonth, todayKarachi } from '@/lib/format'
import { useAreas, useIsAdmin } from '@/hooks/useRefData'
import type { Payment } from '@/types/database'
import PaymentFormDialog from './PaymentForm'
import WhatsAppDialog, { type WaPayload } from './WhatsAppDialog'

type Row = Payment & { received?: { full_name: string } | null }
type CustomerFee = {
  customer_id: number; customer_code: string; username: string; phone: string
  area_id: number; customer_status: string; monthly_fee_id: number | null
  billing_month: string | null; amount_due: number | null; total_paid: number
  remaining: number; status: 'paid' | 'partial' | 'unpaid' | 'overdue' | null; balance: number
}

const CUSTOMER_ROWS_SHOWN = 100 // painting thousands of rows makes phones crawl; search narrows it down

export default function CollectionsPage() {
  const isAdmin = useIsAdmin()
  const qc = useQueryClient()
  const areas = useAreas().data ?? []
  const [from, setFrom] = useState(currentMonthStart()); const [to, setTo] = useState(todayKarachi())
  const [area, setArea] = useState(''); const [emp, setEmp] = useState('')
  const [payOpen, setPayOpen] = useState(false); const [wa, setWa] = useState<WaPayload | null>(null)
  const [presetCustomerId, setPresetCustomerId] = useState<number | undefined>()
  const [rev, setRev] = useState<Row | null>(null); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false)

  // Date-limited on the server so the table never grows without bound.
  const { data, isLoading, error, refetch } = useSb<Row[]>(['payments', from, to], () =>
    supabase.from('payments').select('*, customers(username, customer_code, phone, area_id, areas(name)), monthly_fees(billing_month), received:profiles!received_by(full_name)')
      .gte('payment_date', from).lte('payment_date', to).order('created_at', { ascending: false }).limit(3000))
  // Creates this month's fee rows once (idempotent). Cached for the session: it only needs to run once a month.
  const feeSetup = useSb<number>(['ensure-fees', currentMonthStart()], () =>
    supabase.rpc('ensure_monthly_fees', { p_month: currentMonthStart() }), true, 6 * 60 * 60_000)
  // Load customers once setup has finished, even if it failed (they can still be shown and the error is displayed).
  const customerFees = useSb<CustomerFee[]>(['customer-fees', currentMonthStart()], () =>
    supabase.from('customer_fee_status').select('*').order('username').limit(5000), !feeSetup.isLoading)
  const [custSearch, setCustSearch] = useState(''); const [custStatus, setCustStatus] = useState('')

  const employees = useMemo(() => Array.from(new Map((data ?? []).map((p) => [p.received_by, p.received?.full_name ?? '?'])).entries()), [data])
  const rows = useMemo(() => (data ?? []).filter((p) =>
    (!area || (p.customers as unknown as { area_id: number })?.area_id === +area) && (!emp || p.received_by === emp)), [data, area, emp])
  const total = rows.filter((r) => !r.reversed_at).reduce((s, r) => s + Number(r.amount_paid), 0)
  const matchedCustomers = useMemo(() => {
    const q = custSearch.trim().toLowerCase()
    return (customerFees.data ?? []).filter((c) =>
      (!area || c.area_id === +area) && (!custStatus || (c.status ?? 'unpaid') === custStatus) &&
      (!q || `${c.username} ${c.customer_code} ${c.phone}`.toLowerCase().includes(q)))
  }, [customerFees.data, area, custSearch, custStatus])
  const visibleCustomers = useMemo(() => matchedCustomers.slice(0, CUSTOMER_ROWS_SHOWN), [matchedCustomers])

  async function resend(p: Row) {
    const { data: logs, error: e } = await supabase.from('sms_logs').select('id, phone, message_text').eq('related_payment_id', p.id).order('id', { ascending: false }).limit(1)
    if (e || !logs?.length) return toast.err('No WhatsApp message was generated for this payment')
    setWa({ smsLogId: logs[0].id, phone: logs[0].phone, message: logs[0].message_text, receipt: p.receipt_number })
  }
  async function doReverse() {
    if (!rev) return
    setBusy(true)
    const { error: e } = await supabase.rpc('reverse_payment', { p_payment_id: rev.id, p_reason: reason })
    setBusy(false)
    if (e) return toast.err(errMsg(e))
    toast.ok('Payment reversed'); setRev(null); setReason('')
    await Promise.all(['payments', 'customers', 'customer-fees', 'open-fees', 'admin-stats', 'accounts', 'account-tx', 'journal']
      .map((k) => qc.invalidateQueries({ queryKey: [k] })))
  }
  function collectFor(customerId: number) {
    setPresetCustomerId(customerId)
    setPayOpen(true)
  }
  const columns = useMemo<ColumnDef<Row>[]>(() => [
    { accessorKey: 'receipt_number', header: 'Receipt' },
    { accessorKey: 'payment_date', header: 'Date', cell: ({ getValue }) => formatDate(getValue<string>()) },
    { id: 'customer', header: 'Customer', accessorFn: (r) => r.customers?.username ?? '', cell: ({ row }) => <div><div className="font-medium">{row.original.customers?.username}</div><div className="text-xs text-slate-500">{row.original.customers?.customer_code} - {row.original.customers?.areas?.name}</div></div> },
    { id: 'month', header: 'For month', accessorFn: (r) => r.monthly_fees?.billing_month ?? '', cell: ({ getValue }) => formatMonth(getValue<string>()) },
    { accessorKey: 'amount_paid', header: 'Amount', cell: ({ row }) => <Money value={row.original.amount_paid} className={row.original.reversed_at ? 'text-slate-400 line-through' : 'font-medium'} /> },
    { id: 'by', header: 'Received by', accessorFn: (r) => r.received?.full_name ?? '' },
    { id: 'state', header: 'Status', accessorFn: (r) => (r.reversed_at ? 'reversed' : r.whatsapp_sent ? 'sent' : 'pending'), cell: ({ row }) => row.original.reversed_at ? <StatusBadge status="reversed" /> : <StatusBadge status={row.original.whatsapp_sent ? 'sent' : 'pending'} label={row.original.whatsapp_sent ? 'WhatsApp sent' : 'WhatsApp pending'} /> },
    { id: 'actions', header: '', enableSorting: false, cell: ({ row }) => !row.original.reversed_at && (
      <div className="flex gap-1">
        <Button variant="ghost" size="sm" aria-label="WhatsApp" onClick={() => void resend(row.original)}><MessageCircle className="h-4 w-4" /></Button>
        {isAdmin && <Button variant="ghost" size="sm" aria-label="Reverse" onClick={() => setRev(row.original)}><Undo2 className="h-4 w-4 text-red-600" /></Button>}
      </div>) },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [isAdmin])

  return (
    <div>
      <PageHeader title="Fee collections" subtitle={`${rows.length} payment(s) - total ${formatMoney(total)}`} />
      {feeSetup.error && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">Monthly fee setup failed: {errMsg(feeSetup.error)}</p>}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b p-4">
          <div><h2 className="font-semibold">This month&apos;s customers</h2><p className="text-sm text-slate-500">Record a full or partial payment for any active customer.</p></div>
          <div className="flex flex-wrap gap-2">
            <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <Input type="search" className="w-56 pl-9" value={custSearch} onChange={(e) => setCustSearch(e.target.value)} placeholder="Find customer..." aria-label="Find customer" /></div>
            <Select className="w-auto" value={custStatus} onChange={(e) => setCustStatus(e.target.value)} aria-label="Fee status">
              <option value="">Any status</option><option value="unpaid">Unpaid</option><option value="partial">Partial</option><option value="overdue">Overdue</option><option value="paid">Paid</option></Select>
          </div>
        </div>
        {customerFees.error && <div className="p-4"><ErrorState error={customerFees.error} onRetry={() => void customerFees.refetch()} /></div>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Monthly fee</th><th className="px-4 py-3">Paid</th><th className="px-4 py-3">Remaining</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Action</th></tr></thead>
            <tbody className="divide-y">
              {(customerFees.isLoading || feeSetup.isLoading) && Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}><td colSpan={6} className="px-4 py-3"><Skeleton className="h-5 w-full" /></td></tr>
              ))}
              {visibleCustomers.map((customer) => {
                const paid = customer.status === 'paid'
                return <tr key={customer.customer_id} className="hover:bg-slate-50">
                  <td className="px-4 py-3"><div className="font-medium">{customer.username}</div><div className="text-xs text-slate-500">{customer.customer_code} · {customer.phone}</div></td>
                  <td className="px-4 py-3"><Money value={customer.amount_due ?? 0} /></td>
                  <td className="px-4 py-3"><Money value={customer.total_paid} /></td>
                  <td className="px-4 py-3"><Money value={customer.remaining} /></td>
                  <td className="px-4 py-3"><StatusBadge status={customer.status ?? 'unpaid'} /></td>
                  <td className="px-4 py-3 text-right">{paid
                    ? <div className="flex flex-col items-end gap-1"><span className="inline-flex items-center gap-1 text-sm font-medium text-green-700"><CheckCircle2 className="h-4 w-4" />Fee Successfully Received</span>
                        {Number(customer.balance) > 0 && <Button size="sm" variant="secondary" onClick={() => collectFor(customer.customer_id)}>Pay older dues</Button>}</div>
                    : <Button size="sm" variant="success" onClick={() => collectFor(customer.customer_id)}>Received payment</Button>}</td>
                </tr>
              })}
              {!customerFees.isLoading && !feeSetup.isLoading && !customerFees.error && visibleCustomers.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">{custSearch || custStatus || area ? 'No customers match your filters.' : 'No active customers found.'}</td></tr>}
            </tbody>
          </table>
        </div>
        {matchedCustomers.length > CUSTOMER_ROWS_SHOWN && <p className="border-t p-3 text-center text-xs text-slate-500">Showing the first {CUSTOMER_ROWS_SHOWN} of {matchedCustomers.length} customers. Use the search box to find a specific customer.</p>}
      </Card>
      <DataTable columns={columns} data={rows} isLoading={isLoading} error={error} onRetry={() => void refetch()} searchPlaceholder="Search receipt, customer..."
        emptyTitle="No payments in this period" emptyHint="Change the dates or record a payment."
        toolbar={<>
          <Input type="date" className="w-auto" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          <Input type="date" className="w-auto" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          {isAdmin && <Select className="w-auto" value={emp} onChange={(e) => setEmp(e.target.value)} aria-label="Employee"><option value="">All employees</option>{employees.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</Select>}
          <Select className="w-auto" value={area} onChange={(e) => setArea(e.target.value)} aria-label="Area"><option value="">All areas</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
        </>} />
      <PaymentFormDialog open={payOpen} onClose={() => { setPayOpen(false); setPresetCustomerId(undefined) }} onDone={setWa} presetCustomerId={presetCustomerId} />
      <WhatsAppDialog payload={wa} onClose={() => setWa(null)} />
      <ConfirmDialog open={!!rev} danger loading={busy} confirmDisabled={!reason.trim()} title="Reverse payment?" confirmLabel="Reverse" onCancel={() => { setRev(null); setReason('') }} onConfirm={() => void doReverse()}
        message={<div className="space-y-2"><p>Receipt {rev?.receipt_number} (<Money value={rev?.amount_paid} />) will be marked reversed and the customer&apos;s balance restored. The record is kept.</p>
          <Field label="Reason (required)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>} />
    </div>
  )
}
