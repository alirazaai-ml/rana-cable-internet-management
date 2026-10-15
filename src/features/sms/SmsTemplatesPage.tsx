import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { Pencil, Plus } from 'lucide-react'
import { Button, Dialog, Field, Input, Textarea, toast } from '@/components/ui'
import { PageHeader, StatusBadge, FormActions } from '@/components/shared'
import { DataTable } from '@/components/shared/DataTable'
import { saveRow, supabase, useSb } from '@/lib/query'
import { templateSchema } from '@/lib/validation/schemas'
import type { SmsTemplate } from '@/types/database'
import type { z } from 'zod'

type F = z.infer<typeof templateSchema>
const PLACEHOLDERS = ['{{customer_name}}', '{{amount}}', '{{month}}', '{{remaining}}', '{{balance}}', '{{receipt_number}}', '{{company_name}}']

export default function SmsTemplatesPage() {
  const qc = useQueryClient()
  const { data, isLoading, error, refetch } = useSb<SmsTemplate[]>(['sms-templates'], () => supabase.from('sms_templates').select('*').order('name'))
  const [edit, setEdit] = useState<SmsTemplate | null>(null); const [open, setOpen] = useState(false)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<F>({ resolver: zodResolver(templateSchema), values: { name: edit?.name ?? '', template_text: edit?.template_text ?? '', is_active: edit?.is_active ?? true } })
  async function onSubmit(v: F) {
    const e = await saveRow('sms_templates', edit?.id, v)
    if (e) return toast.err(e.includes('duplicate') ? 'A template with this name exists' : e)
    toast.ok('Template saved'); setOpen(false); await qc.invalidateQueries({ queryKey: ['sms-templates'] })
  }
  const columns = useMemo<ColumnDef<SmsTemplate>[]>(() => [
    { accessorKey: 'name', header: 'Name', cell: ({ getValue }) => <span className="font-medium">{getValue<string>()}</span> },
    { accessorKey: 'template_text', header: 'Text', cell: ({ getValue }) => <span className="line-clamp-2 max-w-lg">{getValue<string>()}</span> },
    { accessorKey: 'is_active', header: 'Status', cell: ({ getValue }) => <StatusBadge status={getValue<boolean>() ? 'active' : 'inactive'} /> },
    { id: 'a', header: '', enableSorting: false, cell: ({ row }) => <Button variant="ghost" size="sm" aria-label="Edit" onClick={() => { setEdit(row.original); setOpen(true) }}><Pencil className="h-4 w-4" /></Button> },
  ], [])
  return (
    <div>
      <PageHeader title="SMS / WhatsApp Templates" subtitle='The active "Payment Received" template is used after every payment.' actions={<Button onClick={() => { setEdit(null); setOpen(true) }}><Plus className="h-4 w-4" />Add template</Button>} />
      <DataTable columns={columns} data={data} isLoading={isLoading} error={error} onRetry={() => void refetch()} emptyTitle="No templates" />
      <Dialog open={open} onClose={() => setOpen(false)} title={edit ? 'Edit template' : 'New template'} wide>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <Field label="Name *" error={errors.name?.message}><Input {...register('name')} /></Field>
          <Field label="Message *" error={errors.template_text?.message} hint={`Placeholders: ${PLACEHOLDERS.join(' ')}`}><Textarea rows={6} {...register('template_text')} /></Field>
          <label className="flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" {...register('is_active')} />Active</label>
          <FormActions onCancel={() => setOpen(false)} saving={isSubmitting} />
        </form>
      </Dialog>
    </div>
  )
}
