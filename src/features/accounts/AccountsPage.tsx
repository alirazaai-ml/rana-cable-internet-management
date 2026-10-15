import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { Button, Card, Dialog, Field, Input, Select, toast } from '@/components/ui'
import { Money, PageHeader, StatusBadge, FormActions } from '@/components/shared'
import { DataTable } from '@/components/shared/DataTable'
import { supabase, useSb } from '@/lib/query'
import { accountSchema, adjustSchema } from '@/lib/validation/schemas'
import { useAuth } from '@/features/auth/AuthContext'
import { formatDateTime } from '@/lib/format'
import type { Account, AccountTransaction } from '@/types/database'
import type { z } from 'zod'

type F = z.infer<typeof accountSchema>

export default function AccountsPage() {
  const qc = useQueryClient(); const { profile } = useAuth()
  const accounts = useSb<Account[]>(['accounts'], () => supabase.from('accounts').select('*').order('id'))
  const [sel, setSel] = useState<number | null>(null); const [open, setOpen] = useState(false); const [adj, setAdj] = useState(false)
  const accountId = sel ?? accounts.data?.[0]?.id ?? null
  const tx = useSb<AccountTransaction[]>(['account-tx', accountId], () => supabase.from('account_transactions').select('*').eq('account_id', accountId!).order('created_at', { ascending: false }).limit(1000), accountId != null)
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<F>({ resolver: zodResolver(accountSchema), defaultValues: { account_type: 'cash' } })
  type Adj = { type: 'credit' | 'debit'; amount: number; description?: string }
  const af = useForm<Adj>({ resolver: zodResolver(adjustSchema) as never, defaultValues: { type: 'credit', description: '' } })

  async function create(v: F) {
    const { error: e } = await supabase.from('accounts').insert({ name: v.name, account_type: v.account_type })
    if (e) return toast.err(e.message)
    toast.ok('Account created'); reset(); setOpen(false); await qc.invalidateQueries({ queryKey: ['accounts'] })
  }
  async function adjust(v: Adj) {
    const { error: e } = await supabase.from('account_transactions').insert({ account_id: accountId, transaction_type: v.type, amount: +v.amount, description: v.description || 'Manual entry', created_by: profile!.id })
    if (e) return toast.err(e.message)
    toast.ok('Transaction added'); af.reset(); setAdj(false)
    await Promise.all(['accounts', 'account-tx'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
  }
  const columns = useMemo<ColumnDef<AccountTransaction>[]>(() => [
    { accessorKey: 'created_at', header: 'Date', cell: ({ getValue }) => formatDateTime(getValue<string>()) },
    { accessorKey: 'transaction_type', header: 'Type', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} /> },
    { accessorKey: 'description', header: 'Description', cell: ({ getValue }) => getValue<string>() ?? '-' },
    { accessorKey: 'amount', header: 'Amount', cell: ({ row }) => <Money value={row.original.amount} className={row.original.transaction_type === 'credit' ? 'text-green-700' : 'text-red-700'} /> },
  ], [])
  return (
    <div className="space-y-4">
      <PageHeader title="Accounts" subtitle="Cash box and bank. Balances are calculated from transactions; payments post here automatically." actions={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Add account</Button>} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(accounts.data ?? []).map((a) => (
          <button key={a.id} type="button" onClick={() => setSel(a.id)} className="text-left" aria-pressed={a.id === accountId}><Card className={`p-4 ${a.id === accountId ? 'ring-2 ring-brand-500' : ''}`}>
            <p className="text-xs uppercase text-slate-500">{a.account_type}</p><p className="font-semibold">{a.name}</p><p className="mt-1 text-2xl font-bold"><Money value={a.current_balance} /></p></Card></button>
        ))}
      </div>
      {accountId != null && <>
        <div className="flex justify-end"><Button variant="secondary" onClick={() => setAdj(true)}>Manual transaction</Button></div>
        <DataTable columns={columns} data={tx.data} isLoading={tx.isLoading} error={tx.error} onRetry={() => void tx.refetch()} emptyTitle="No transactions yet" />
      </>}
      <Dialog open={open} onClose={() => setOpen(false)} title="New account">
        <form onSubmit={handleSubmit(create)} className="space-y-3">
          <Field label="Name *" error={errors.name?.message}><Input {...register('name')} /></Field>
          <Field label="Type"><Select {...register('account_type')}><option value="cash">Cash</option><option value="bank">Bank</option></Select></Field>
          <FormActions onCancel={() => setOpen(false)} saving={isSubmitting} />
        </form>
      </Dialog>
      <Dialog open={adj} onClose={() => setAdj(false)} title="Manual transaction">
        <form onSubmit={af.handleSubmit(adjust)} className="space-y-3">
          <Field label="Type"><Select {...af.register('type')}><option value="credit">Credit (money in)</option><option value="debit">Debit (money out)</option></Select></Field>
          <Field label="Amount (Rs.)" error={af.formState.errors.amount?.message}><Input type="number" inputMode="decimal" step="0.01" {...af.register('amount')} /></Field>
          <Field label="Description"><Input {...af.register('description')} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setAdj(false)}>Cancel</Button><Button type="submit" loading={af.formState.isSubmitting}>Save</Button></div>
        </form>
      </Dialog>
    </div>
  )
}
