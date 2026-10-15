import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Button, Dialog, Field, Input, Select, Textarea, toast } from '@/components/ui'
import { customerSchema, type CustomerForm as F } from '@/lib/validation/schemas'
import { supabase, errMsg } from '@/lib/query'
import { useAreas, useEmployeeOptions, useIsAdmin, usePackages } from '@/hooks/useRefData'
import { normalizePhone } from '@/lib/format'
import type { Customer } from '@/types/database'

export default function CustomerFormDialog({ open, onClose, customer }: { open: boolean; onClose: () => void; customer?: Customer | null }) {
  const isAdmin = useIsAdmin()
  const qc = useQueryClient()
  const areas = useAreas().data ?? []
  const packages = (usePackages().data ?? []).filter((p) => p.is_active || p.id === customer?.package_id)
  const employees = (useEmployeeOptions().data ?? []).filter((e) => e.is_active || e.id === customer?.seller_id)
  // Package and area of an existing customer are admin-only (the database enforces it too).
  const lockPlan = !isAdmin && !!customer
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<F>({
    // a disabled select is not submitted, so its validation is skipped for staff editing a customer
    resolver: zodResolver(lockPlan ? customerSchema.partial({ package_id: true, area_id: true }) : customerSchema) as never,
    values: customer ? {
      username: customer.username, phone: customer.phone, package_id: customer.package_id, area_id: customer.area_id,
      seller_id: customer.seller_id ?? '', address: customer.address ?? '', cnic: customer.cnic ?? '',
      father_name: customer.father_name ?? '', notes: customer.notes ?? '', opening_balance: customer.opening_balance,
      service_status: customer.service_status, customer_status: customer.customer_status,
    } : { username: '', phone: '', package_id: undefined as never, area_id: undefined as never, seller_id: '', address: '', cnic: '', father_name: '', notes: '', opening_balance: 0, service_status: 'on', customer_status: 'active' },
  })

  async function onSubmit(v: F) {
    const row: Record<string, unknown> = {
      username: v.username, phone: normalizePhone(v.phone),
      package_id: lockPlan ? customer!.package_id : v.package_id, area_id: lockPlan ? customer!.area_id : v.area_id,
      seller_id: v.seller_id === '' || v.seller_id == null ? null : v.seller_id,
      address: v.address || null, cnic: v.cnic || null, father_name: v.father_name || null, notes: v.notes || null,
    }
    // Admin-only fields. Staff never send them (and the DB trigger would reject them anyway).
    if (isAdmin) { row.opening_balance = v.opening_balance ?? 0; row.service_status = v.service_status; row.customer_status = v.customer_status }

    // Duplicate-phone WARNING (not a hard block): the owner decides.
    const phone = row.phone as string
    const { data: dup } = await supabase.from('customers').select('customer_code, username').eq('phone', phone).neq('id', customer?.id ?? -1).limit(1)
    if (dup && dup.length > 0 && !window.confirm(`This phone number is already used by ${dup[0].username} (${dup[0].customer_code}). Save anyway?`)) return

    const res = customer ? await supabase.from('customers').update(row).eq('id', customer.id) : await supabase.from('customers').insert(row)
    if (res.error) { toast.err(errMsg(res.error)); return }
    toast.ok(customer ? 'Customer updated' : 'Customer added')
    await qc.invalidateQueries({ queryKey: ['customers'] })
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} title={customer ? `Edit ${customer.customer_code}` : 'New customer'} wide>
      <form onSubmit={handleSubmit(onSubmit)} className="grid gap-3 sm:grid-cols-2">
        <Field label="Customer name *" error={errors.username?.message}><Input {...register('username')} /></Field>
        <Field label="Phone *" error={errors.phone?.message} hint="03XX XXXXXXX or +92 3XX XXXXXXX"><Input type="tel" inputMode="tel" {...register('phone')} /></Field>
        <Field label="Package *" error={errors.package_id?.message} hint={lockPlan ? 'Only an administrator can change this' : undefined}>
          <Select disabled={lockPlan} {...register('package_id')}><option value="">Select...</option>{packages.map((p) => <option key={p.id} value={p.id}>{p.name} - Rs. {p.monthly_fee}</option>)}</Select></Field>
        <Field label="Area *" error={errors.area_id?.message} hint={lockPlan ? 'Only an administrator can change this' : undefined}>
          <Select disabled={lockPlan} {...register('area_id')}><option value="">Select...</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
        <Field label="Seller (who signed up this customer)"><Select {...register('seller_id')}><option value="">-</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</Select></Field>
        <Field label="Father name"><Input {...register('father_name')} /></Field>
        <Field label="CNIC" error={errors.cnic?.message}><Input inputMode="numeric" placeholder="35202-1234567-1" {...register('cnic')} /></Field>
        <Field label="Address"><Input {...register('address')} /></Field>
        {isAdmin && <>
          <Field label="Opening balance (Rs.)" hint="Dues carried over from the old register"><Input type="number" step="0.01" {...register('opening_balance')} /></Field>
          <Field label="Service"><Select {...register('service_status')}><option value="on">On</option><option value="off">Off</option></Select></Field>
          <Field label="Customer status"><Select {...register('customer_status')}><option value="active">Active</option><option value="inactive">Inactive</option></Select></Field>
        </>}
        <div className="sm:col-span-2"><Field label="Notes"><Textarea {...register('notes')} /></Field></div>
        <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={isSubmitting}>Save</Button></div>
      </form>
    </Dialog>
  )
}
