import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { Pencil, Plus } from 'lucide-react'
import { Button, Dialog, Field, Input, toast } from '@/components/ui'
import { Money, PageHeader, StatusBadge, FormActions } from '@/components/shared'
import { DataTable } from '@/components/shared/DataTable'
import { saveRow } from '@/lib/query'
import { packageSchema } from '@/lib/validation/schemas'
import { usePackages } from '@/hooks/useRefData'
import type { Package } from '@/types/database'
import type { z } from 'zod'

type F = z.infer<typeof packageSchema>

export default function PackagesPage() {
  const qc = useQueryClient()
  const { data, isLoading, error, refetch } = usePackages()
  const [edit, setEdit] = useState<Package | null>(null); const [open, setOpen] = useState(false)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<F>({
    resolver: zodResolver(packageSchema),
    values: { name: edit?.name ?? '', speed_label: edit?.speed_label ?? '', monthly_fee: edit?.monthly_fee ?? 0, description: edit?.description ?? '', is_active: edit?.is_active ?? true },
  })
  async function onSubmit(v: F) {
    const e = await saveRow('packages', edit?.id, { name: v.name, speed_label: v.speed_label || null, monthly_fee: v.monthly_fee, description: v.description || null, is_active: v.is_active })
    if (e) return toast.err(e.includes('duplicate') ? 'A package with this name already exists' : e)
    toast.ok('Package saved'); setOpen(false); await qc.invalidateQueries({ queryKey: ['packages'] })
  }
  const columns = useMemo<ColumnDef<Package>[]>(() => [
    { accessorKey: 'name', header: 'Package', cell: ({ getValue }) => <span className="font-medium">{getValue<string>()}</span> },
    { accessorKey: 'speed_label', header: 'Speed label', cell: ({ getValue }) => getValue<string>() ?? '-' },
    { accessorKey: 'monthly_fee', header: 'Monthly fee', cell: ({ getValue }) => <Money value={getValue<number>()} /> },
    { accessorKey: 'is_active', header: 'Status', cell: ({ getValue }) => <StatusBadge status={getValue<boolean>() ? 'active' : 'inactive'} /> },
    { id: 'a', header: '', enableSorting: false, cell: ({ row }) => <Button variant="ghost" size="sm" aria-label="Edit" onClick={() => { setEdit(row.original); setOpen(true) }}><Pencil className="h-4 w-4" /></Button> },
  ], [])
  return (
    <div>
      <PageHeader title="Packages" subtitle="Billing tiers. Changing a fee affects only future monthly fee schedules." actions={<Button onClick={() => { setEdit(null); setOpen(true) }}><Plus className="h-4 w-4" />Add package</Button>} />
      <DataTable columns={columns} data={data} isLoading={isLoading} error={error} onRetry={() => void refetch()} emptyTitle="No packages yet" />
      <Dialog open={open} onClose={() => setOpen(false)} title={edit ? 'Edit package' : 'New package'}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <Field label="Name * (e.g. 2MB)" error={errors.name?.message}><Input {...register('name')} /></Field>
          <Field label="Speed label"><Input {...register('speed_label')} /></Field>
          <Field label="Monthly fee (Rs.) *" error={errors.monthly_fee?.message}><Input type="number" step="0.01" {...register('monthly_fee')} /></Field>
          <Field label="Description"><Input {...register('description')} /></Field>
          <label className="flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" {...register('is_active')} />Active (available for new customers)</label>
          <FormActions onCancel={() => setOpen(false)} saving={isSubmitting} />
        </form>
      </Dialog>
    </div>
  )
}
