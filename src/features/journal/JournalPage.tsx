import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { Button, Dialog, Field, Input, Select, toast } from '@/components/ui'
import { Money, PageHeader, StatusBadge, FormActions } from '@/components/shared'
import { DataTable } from '@/components/shared/DataTable'
import { supabase, useSb } from '@/lib/query'
import { journalSchema } from '@/lib/validation/schemas'
import { useAuth } from '@/features/auth/AuthContext'
import { currentMonthStart, formatDate, todayKarachi } from '@/lib/format'
import type { JournalEntry } from '@/types/database'
import type { z } from 'zod'

type F = z.infer<typeof journalSchema>

export default function JournalPage() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const [from, setFrom] = useState(currentMonthStart()); const [to, setTo] = useState(todayKarachi()); const [open, setOpen] = useState(false)
  const { data, isLoading, error, refetch } = useSb<JournalEntry[]>(['journal', from, to], () =>
    supabase.from('journal_entries').select('*').gte('entry_date', from).lte('entry_date', to).order('entry_date', { ascending: false }).order('id', { ascending: false }).limit(5000))
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<F>({ resolver: zodResolver(journalSchema) as never, defaultValues: { entry_date: todayKarachi(), entry_type: 'expense', category: '', description: '' } })
  const income = (data ?? []).filter((e) => e.entry_type === 'income').reduce((s, e) => s + Number(e.amount), 0)
  const expense = (data ?? []).filter((e) => e.entry_type === 'expense').reduce((s, e) => s + Number(e.amount), 0)

  async function onSubmit(v: F) {
    const { error: e } = await supabase.from('journal_entries').insert({ entry_date: v.entry_date, entry_type: v.entry_type, category: v.category, amount: v.amount, description: v.description || null, created_by: profile!.id })
    if (e) return toast.err(e.message)
    toast.ok('Entry added'); reset(); setOpen(false); await qc.invalidateQueries({ queryKey: ['journal'] })
  }
  const columns = useMemo<ColumnDef<JournalEntry>[]>(() => [
    { accessorKey: 'entry_date', header: 'Date', cell: ({ getValue }) => formatDate(getValue<string>()) },
    { accessorKey: 'entry_type', header: 'Type', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} /> },
    { accessorKey: 'category', header: 'Category' },
    { accessorKey: 'description', header: 'Description', cell: ({ getValue }) => getValue<string>() ?? '-' },
    { accessorKey: 'amount', header: 'Amount', cell: ({ row }) => <Money value={row.original.amount} className={row.original.entry_type === 'income' ? 'text-green-700' : 'text-red-700'} /> },
  ], [])
  return (
    <div>
      <PageHeader title="Daily Journal" subtitle={`Income ${'Rs. ' + income.toLocaleString()} - Expense ${'Rs. ' + expense.toLocaleString()} - Net ${'Rs. ' + (income - expense).toLocaleString()}`}
        actions={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Add entry</Button>} />
      <DataTable columns={columns} data={data} isLoading={isLoading} error={error} onRetry={() => void refetch()} emptyTitle="No entries in this period" emptyHint="Customer payments appear here automatically."
        toolbar={<><Input type="date" className="w-auto" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" /><Input type="date" className="w-auto" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" /></>} />
      <Dialog open={open} onClose={() => setOpen(false)} title="New journal entry">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <Field label="Date"><Input type="date" {...register('entry_date')} /></Field>
          <Field label="Type"><Select {...register('entry_type')}><option value="expense">Expense</option><option value="income">Income</option></Select></Field>
          <Field label="Category *" error={errors.category?.message}><Input placeholder="e.g. Fuel, Cable, Salary" {...register('category')} /></Field>
          <Field label="Amount (Rs.) *" error={errors.amount?.message}><Input type="number" step="0.01" {...register('amount')} /></Field>
          <Field label="Description"><Input {...register('description')} /></Field>
          <FormActions onCancel={() => setOpen(false)} saving={isSubmitting} />
        </form>
      </Dialog>
    </div>
  )
}
