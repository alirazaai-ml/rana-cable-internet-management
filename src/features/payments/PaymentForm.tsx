import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Button, Dialog, Field, Input, Select, Textarea, toast } from '@/components/ui'
import { Money } from '@/components/shared'
import { paymentSchema } from '@/lib/validation/schemas'
import { supabase, useSb, errMsg } from '@/lib/query'
import { formatMonth } from '@/lib/format'
import type { FeeBalance } from '@/types/database'
import type { WaPayload } from './WhatsAppDialog'

type FormVals = { monthly_fee_id: number; amount: number; method: 'cash' | 'bank_transfer' | 'other'; notes?: string }

export default function PaymentFormDialog({ open, onClose, onDone, presetCustomerId }: {
  open: boolean; onClose: () => void; onDone: (p: WaPayload) => void; presetCustomerId?: number
}) {
  const qc = useQueryClient()
  const cid = presetCustomerId ?? ''
  const fees = useSb<FeeBalance[]>(['open-fees', cid], () =>
    supabase.from('fee_balances').select('*').eq('customer_id', cid).gt('remaining', 0).order('billing_month'), open && cid !== '')
  const { register, handleSubmit, setValue, watch, reset, formState: { errors, isSubmitting } } = useForm<FormVals>({
    resolver: zodResolver(paymentSchema) as never, defaultValues: { method: 'cash', notes: '' },
  })

  useEffect(() => { if (!open) reset() }, [open, reset])

  const feeId = watch('monthly_fee_id')
  const fee = (fees.data ?? []).find((i) => i.monthly_fee_id === Number(feeId))
  useEffect(() => { if (fee) setValue('amount', fee.remaining) }, [fee, setValue])

  async function onSubmit(v: FormVals) {
    if (fee && Number(v.amount) > Number(fee.remaining)) return toast.err(`Amount cannot be more than the remaining Rs. ${fee.remaining}`)
    const { data, error } = await supabase.rpc('record_payment', {
      p_customer_id: cid, p_monthly_fee_id: v.monthly_fee_id, p_amount: v.amount, p_method: v.method, p_notes: v.notes || null,
    })
    if (error) return toast.err(errMsg(error))
    const r = data as { receipt_number: string; sms_log_id: number | null; message: string | null; phone: string }
    await Promise.all(['payments', 'customers', 'customer-fees', 'open-fees', 'admin-stats', 'staff-stats', 'accounts', 'account-tx', 'journal'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
    onClose()
    onDone({ smsLogId: r.sms_log_id, phone: r.phone, message: r.message ?? '', receipt: r.receipt_number })
  }

  return (
    <Dialog open={open} onClose={onClose} title="Receive payment">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        {cid !== '' && (
          <Field label="Monthly fee *" error={errors.monthly_fee_id?.message}>
            <Select {...register('monthly_fee_id')}>
              <option value="">{fees.isLoading ? 'Loading...' : (fees.data ?? []).length ? 'Select month...' : 'No outstanding fees'}</option>
              {(fees.data ?? []).map((i) => <option key={i.monthly_fee_id} value={i.monthly_fee_id}>{formatMonth(i.billing_month)} - remaining Rs. {i.remaining} ({i.status})</option>)}
            </Select>
          </Field>
        )}
        {fee && <p className="text-sm text-slate-600">Due <Money value={fee.amount_due} /> - paid <Money value={fee.total_paid} /> - remaining <Money value={fee.remaining} className="font-semibold" /></p>}
        <Field label="Amount received (Rs.) *" error={errors.amount?.message}><Input type="number" inputMode="decimal" step="0.01" {...register('amount')} /></Field>
        <Field label="Method"><Select {...register('method')}><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></Select></Field>
        <Field label="Notes"><Textarea {...register('notes')} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" variant="success" loading={isSubmitting} disabled={cid === '' || fees.isLoading || !fees.data?.length}>Save payment</Button></div>
      </form>
    </Dialog>
  )
}
