import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { Pencil, Power, UserPlus } from 'lucide-react'
import { Button, Dialog, Field, Input, Select, toast } from '@/components/ui'
import { ConfirmDialog, PageHeader, StatusBadge } from '@/components/shared'
import { DataTable } from '@/components/shared/DataTable'
import { supabase, useSb, errMsg } from '@/lib/query'
import { employeeEditSchema, staffSchema } from '@/lib/validation/schemas'
import { useAreas, useEmployees } from '@/hooks/useRefData'
import { useAuth } from '@/features/auth/AuthContext'
import { currentMonthStart, formatDate, normalizePhone } from '@/lib/format'
import type { Employee } from '@/types/database'
import type { z } from 'zod'

type StaffF = z.infer<typeof staffSchema>
type EditF = z.infer<typeof employeeEditSchema>

/**
 * Turn a Supabase Functions error into a human-readable message.
 * Kept outside the component — it uses no component state.
 */
async function readFnError(e: unknown): Promise<{ msg: string; network: boolean }> {
  const err = e as { name?: string; message?: string; context?: Response }
  if (err?.name === 'FunctionsHttpError' && err.context) {
    try {
      return { msg: (await err.context.json()).error ?? err.message ?? 'Function error', network: false }
    } catch {
      /* fall through */
    }
  }
  if (err?.name === 'FunctionsFetchError' || /failed to send|fetch/i.test(err?.message ?? '')) {
    return {
      network: true,
      msg: 'Could not reach the "create-staff" Edge Function. Deploy it before adding employees (see the README).',
    }
  }
  return { msg: err?.message ?? String(e), network: false }
}

export default function EmployeesPage() {
  const qc = useQueryClient()
  const { profile } = useAuth()
  const areas = useAreas().data ?? []
  const { data, isLoading, error, refetch } = useEmployees()

  // This month's per-user collection totals (for the "Collected" column).
  const month = useSb<{ received_by: string; amount_paid: number }[]>(
    ['payments-month-by-user'],
    () =>
      supabase
        .from('payments')
        .select('received_by, amount_paid')
        .is('reversed_at', null)
        .gte('payment_date', currentMonthStart())
        .limit(20000),
  )

  const totals = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of month.data ?? []) {
      m.set(p.received_by, (m.get(p.received_by) ?? 0) + Number(p.amount_paid))
    }
    return m
  }, [month.data])

  const [createOpen, setCreateOpen] = useState(false)
  const [edit, setEdit] = useState<Employee | null>(null)
  const [tog, setTog] = useState<Employee | null>(null)

  // ---- Create staff account (Edge Function: create-staff) ----
  const cf = useForm<StaffF>({ resolver: zodResolver(staffSchema) })

  async function createStaff(v: StaffF) {
    if (!v.password || v.password.length < 8) {
      return cf.setError('password', { message: 'At least 8 characters' })
    }
    const { data: d, error: e } = await supabase.functions.invoke('create-staff', {
      body: {
        email: v.email,
        password: v.password,
        full_name: v.full_name,
        phone: v.phone || null,
        role_title: v.role_title || 'Field Collector',
        area_id: v.area_id ?? null,
        // monthly_salary removed on purpose — the column still exists but is unused.
      },
    })
    if (e) return toast.err((await readFnError(e)).msg)
    if ((d as { error?: string })?.error) return toast.err((d as { error: string }).error)

    toast.ok('Staff account added')
    cf.reset()
    setCreateOpen(false)
    // Refresh employees AND the dropdown list used by the Seller field.
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['employees'] }),
      qc.invalidateQueries({ queryKey: ['employee-options'] }),
    ])
  }

  // ---- Edit existing employee ----
  const ef = useForm<EditF>({
    resolver: zodResolver(employeeEditSchema),
    values: edit
      ? ({
          full_name: edit.full_name,
          phone: edit.phone ?? '',
          role_title: edit.role_title ?? '',
          area_id: edit.area_id ?? '',
        } as never)
      : undefined,
  })

  async function saveEdit(v: EditF) {
    const { error: e } = await supabase
      .from('employees')
      .update({
        full_name: v.full_name,
        phone: v.phone ? normalizePhone(v.phone) : null,
        role_title: v.role_title || null,
        area_id: v.area_id ?? null,
      })
      .eq('id', edit!.id)
    if (e) return toast.err(e.message)
    toast.ok('Employee updated')
    setEdit(null)
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['employees'] }),
      qc.invalidateQueries({ queryKey: ['employee-options'] }),
    ])
  }

  // ---- Activate / deactivate ----
  async function doToggle() {
    const next = !tog!.is_active
    const a = await supabase.from('employees').update({ is_active: next }).eq('id', tog!.id)
    // Lock or unlock the login too. An inactive profile is refused by every RLS policy.
    const b = tog!.profile_id
      ? await supabase.from('profiles').update({ is_active: next }).eq('id', tog!.profile_id)
      : { error: null }
    if (a.error || b.error) toast.err(errMsg(a.error ?? b.error))
    else toast.ok(next ? 'Employee activated' : 'Employee deactivated')
    setTog(null)
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['employees'] }),
      qc.invalidateQueries({ queryKey: ['employee-options'] }),
    ])
  }

  // ---- Table columns ----
  const columns = useMemo<ColumnDef<Employee>[]>(
    () => [
      {
        accessorKey: 'full_name',
        header: 'Name',
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.full_name}</div>
            <div className="text-xs text-slate-500">{row.original.phone ?? ''}</div>
          </div>
        ),
      },
      {
        accessorKey: 'role_title',
        header: 'Title',
        cell: ({ getValue }) => getValue<string>() ?? '-',
      },
      { id: 'area', header: 'Area', accessorFn: (r) => r.areas?.name ?? '-' },
      {
        id: 'coll',
        header: 'Collected (this month)',
        accessorFn: (r) => (r.profile_id ? totals.get(r.profile_id) ?? 0 : 0),
        cell: ({ getValue }) => (
          <span className="tabular-nums font-medium text-green-700">
            Rs. {getValue<number>().toLocaleString('en-PK')}
          </span>
        ),
      },
      {
        accessorKey: 'joined_at',
        header: 'Joined',
        cell: ({ getValue }) => formatDate(getValue<string>()),
      },
      {
        accessorKey: 'is_active',
        header: 'Status',
        cell: ({ getValue }) => <StatusBadge status={getValue<boolean>() ? 'active' : 'inactive'} />,
      },
      {
        id: 'a',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" aria-label="Edit" onClick={() => setEdit(row.original)}>
              <Pencil className="h-4 w-4" />
            </Button>
            {row.original.profile_id !== profile?.id && (
              <Button variant="ghost" size="sm" aria-label="Toggle active" onClick={() => setTog(row.original)}>
                <Power className="h-4 w-4" />
              </Button>
            )}
          </div>
        ),
      },
    ],
    [totals, profile?.id],
  )

  return (
    <div>
      <PageHeader
        title="Employees"
        subtitle="Staff who collect fees"
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <UserPlus className="h-4 w-4" />
            Add staff account
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={data}
        isLoading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        emptyTitle="No employees yet"
      />

      {/* ---------- Create staff dialog ---------- */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="New staff account">
        <form onSubmit={cf.handleSubmit(createStaff)} className="space-y-3">
          <Field label="Full name *" error={cf.formState.errors.full_name?.message}>
            <Input {...cf.register('full_name')} />
          </Field>
          <Field label="Login email *" error={cf.formState.errors.email?.message}>
            <Input type="email" {...cf.register('email')} />
          </Field>
          <Field
            label="Temporary password *"
            error={cf.formState.errors.password?.message}
            hint="Tell the staff member; minimum 8 characters"
          >
            <Input type="text" autoComplete="off" {...cf.register('password')} />
          </Field>
          <Field label="Phone" error={cf.formState.errors.phone?.message}>
            <Input type="tel" {...cf.register('phone')} />
          </Field>
          <Field label="Title">
            <Input placeholder="Field Collector" {...cf.register('role_title')} />
          </Field>
          <Field label="Area">
            <Select {...cf.register('area_id')}>
              <option value="">-</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={cf.formState.isSubmitting}>
              Create account
            </Button>
          </div>
        </form>
      </Dialog>

      {/* ---------- Edit employee dialog ---------- */}
      <Dialog open={!!edit} onClose={() => setEdit(null)} title="Edit employee">
        <form onSubmit={ef.handleSubmit(saveEdit)} className="space-y-3">
          <Field label="Full name *" error={ef.formState.errors.full_name?.message}>
            <Input {...ef.register('full_name')} />
          </Field>
          <Field label="Phone" error={ef.formState.errors.phone?.message}>
            <Input type="tel" {...ef.register('phone')} />
          </Field>
          <Field label="Title">
            <Input {...ef.register('role_title')} />
          </Field>
          <Field label="Area">
            <Select {...ef.register('area_id')}>
              <option value="">-</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setEdit(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={ef.formState.isSubmitting}>
              Save
            </Button>
          </div>
        </form>
      </Dialog>

      {/* ---------- Activate / deactivate confirmation ---------- */}
      <ConfirmDialog
        open={!!tog}
        danger={tog?.is_active}
        title={tog?.is_active ? 'Deactivate employee?' : 'Activate employee?'}
        confirmLabel={tog?.is_active ? 'Deactivate' : 'Activate'}
        message={
          tog?.is_active
            ? `${tog?.full_name} will no longer be able to sign in. Their history is kept.`
            : `${tog?.full_name} will be able to sign in again.`
        }
        onCancel={() => setTog(null)}
        onConfirm={() => void doToggle()}
      />
    </div>
  )
}