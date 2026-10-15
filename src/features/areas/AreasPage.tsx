import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Button, Dialog, Field, Input, toast } from '@/components/ui'
import { ConfirmDialog, PageHeader, FormActions } from '@/components/shared'
import { DataTable } from '@/components/shared/DataTable'
import { saveRow, supabase } from '@/lib/query'
import { areaSchema } from '@/lib/validation/schemas'
import { useAreas } from '@/hooks/useRefData'
import type { Area } from '@/types/database'
import { z } from 'zod'

type F = z.infer<typeof areaSchema>

export default function AreasPage() {
  const qc = useQueryClient()
  const { data, isLoading, error, refetch } = useAreas()
  const [edit, setEdit] = useState<Area | null>(null); const [open, setOpen] = useState(false); const [del, setDel] = useState<Area | null>(null)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<F>({ resolver: zodResolver(areaSchema), values: { name: edit?.name ?? '', description: edit?.description ?? '' } })

  async function onSubmit(v: F) {
    const e = await saveRow('areas', edit?.id, { name: v.name, description: v.description || null })
    if (e) return toast.err(e.includes('duplicate') ? 'An area with this name already exists' : e)
    toast.ok('Area saved'); setOpen(false); await qc.invalidateQueries({ queryKey: ['areas'] })
  }
  async function doDelete() {
    const { error: e } = await supabase.from('areas').delete().eq('id', del!.id)
    if (e) toast.err(e.message.includes('foreign key') ? 'This area has customers/employees and cannot be deleted' : e.message)
    else { toast.ok('Area deleted'); await qc.invalidateQueries({ queryKey: ['areas'] }) }
    setDel(null)
  }
  const columns = useMemo<ColumnDef<Area>[]>(() => [
    { accessorKey: 'name', header: 'Area / Village', cell: ({ getValue }) => <span className="font-medium">{String(getValue())}</span> },
    { accessorKey: 'description', header: 'Description', cell: ({ getValue }) => getValue<string>() ?? '-' },
    { id: 'a', header: '', enableSorting: false, cell: ({ row }) => <div className="flex gap-1">
      <Button variant="ghost" size="sm" aria-label="Edit" onClick={() => { setEdit(row.original); setOpen(true) }}><Pencil className="h-4 w-4" /></Button>
      <Button variant="ghost" size="sm" aria-label="Delete" onClick={() => setDel(row.original)}><Trash2 className="h-4 w-4 text-red-600" /></Button></div> },
  ], [])
  return (
    <div>
      <PageHeader title="Areas" subtitle="Villages you serve" actions={<Button onClick={() => { setEdit(null); setOpen(true) }}><Plus className="h-4 w-4" />Add area</Button>} />
      <DataTable columns={columns} data={data} isLoading={isLoading} error={error} onRetry={() => void refetch()} emptyTitle="No areas yet" emptyHint="Add your villages first." />
      <Dialog open={open} onClose={() => setOpen(false)} title={edit ? 'Edit area' : 'New area'}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <Field label="Name *" error={errors.name?.message}><Input {...register('name')} /></Field>
          <Field label="Description"><Input {...register('description')} /></Field>
          <FormActions onCancel={() => setOpen(false)} saving={isSubmitting} />
        </form>
      </Dialog>
      <ConfirmDialog open={!!del} danger title="Delete area?" confirmLabel="Delete" message={`Delete "${del?.name}"? Only possible if no customers use it.`} onCancel={() => setDel(null)} onConfirm={() => void doDelete()} />
    </div>
  )
}
