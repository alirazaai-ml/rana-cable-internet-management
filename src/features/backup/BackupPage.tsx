import { useState } from 'react'
import { Download, RefreshCw, ShieldCheck } from 'lucide-react'
import { Button, Card, Input, toast } from '@/components/ui'
import { PageHeader } from '@/components/shared'
import { supabase } from '@/lib/supabase'
import { toCsv } from '@/lib/csv'

type Customer = {
  customer_code: string; username: string; phone: string; balance: number
  customer_status: string; service_status: string; created_at: string
}
type BackupData = { exported_at: string; customers: unknown[]; monthly_fees: unknown[]; payments: unknown[] }
type Format = 'csv' | 'xlsx' | 'pdf' | 'json'

const PAGE = 1000
const headers = ['Customer code', 'Name', 'Phone', 'Balance', 'Customer status', 'Service status', 'Created']
const row = (c: Customer) => [c.customer_code, c.username, c.phone, Number(c.balance).toFixed(2), c.customer_status, c.service_status, c.created_at]

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Read every row of a table, 1000 at a time (the API caps a single response). */
async function fetchAll<T>(table: string, columns: string, order: string): Promise<T[]> {
  const all: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(columns).order(order).order('id').range(from, from + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    all.push(...((data ?? []) as T[]))
    if (!data || data.length < PAGE) break
  }
  return all
}

export default function BackupPage() {
  const [busy, setBusy] = useState<Format | null>(null)
  const [search, setSearch] = useState('')

  async function loadCustomers(): Promise<Customer[]> {
    const all = await fetchAll<Customer>('customers', 'customer_code, username, phone, balance, customer_status, service_status, created_at', 'customer_code')
    const q = search.trim().toLowerCase()
    return q ? all.filter((c) => `${c.customer_code} ${c.username} ${c.phone}`.toLowerCase().includes(q)) : all
  }

  async function exportData(format: Format) {
    setBusy(format)
    try {
      const date = new Date().toISOString().slice(0, 10)
      let count = 0
      if (format === 'json') {
        // A complete backup: every column of every customer, fee and payment (search filter ignored).
        const [customers, monthly_fees, payments] = await Promise.all([
          fetchAll<unknown>('customers', '*', 'customer_code'),
          fetchAll<unknown>('monthly_fees', '*', 'billing_month'),
          fetchAll<unknown>('payments', '*', 'created_at'),
        ])
        const backup: BackupData = { exported_at: new Date().toISOString(), customers, monthly_fees, payments }
        download(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }), `rana-cable-internet-backup-${date}.json`)
        count = customers.length
      } else {
        const data = await loadCustomers()
        count = data.length
        if (format === 'csv') download(new Blob(['﻿' + toCsv([headers, ...data.map(row)])], { type: 'text/csv;charset=utf-8' }), `customers-${date}.csv`)
        if (format === 'xlsx') {
          const XLSX = await import('xlsx') // heavy library: only downloaded when used
          const sheet = XLSX.utils.aoa_to_sheet([headers, ...data.map(row)])
          const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Customers')
          XLSX.writeFile(book, `customers-${date}.xlsx`)
        }
        if (format === 'pdf') {
          const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
          const doc = new jsPDF({ orientation: 'landscape' })
          doc.text('Customer data export', 14, 14)
          autoTable(doc, { head: [headers], body: data.map(row), startY: 20, styles: { fontSize: 7 } })
          doc.save(`customers-${date}.pdf`)
        }
      }
      toast.ok(`${count} customer record(s) exported`)
    } catch (error) { toast.err(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(null) }
  }

  const anyBusy = busy !== null
  return <div className="space-y-6">
    <PageHeader title="Backup & exports" subtitle="Download an authorized, point-in-time customer data copy." />
    <Card className="max-w-3xl p-5">
      <div className="flex items-start gap-3"><ShieldCheck className="mt-1 h-5 w-5 text-green-600" /><div><h2 className="font-semibold">Admin-only data export</h2><p className="mt-1 text-sm text-slate-600">Exports are generated in your browser from rows protected by Supabase RLS. No data is uploaded to a third party.</p></div></div>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Optional customer search" aria-label="Filter customers" /><Button variant="secondary" onClick={() => setSearch('')} disabled={!search}><RefreshCw className="h-4 w-4" />Clear</Button></div>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(['csv', 'xlsx', 'pdf'] as const).map((format) => <Button key={format} loading={busy === format} disabled={anyBusy && busy !== format} onClick={() => void exportData(format)}><Download className="h-4 w-4" />{format.toUpperCase()}</Button>)}
        <Button loading={busy === 'json'} disabled={anyBusy && busy !== 'json'} onClick={() => void exportData('json')}><Download className="h-4 w-4" />FULL JSON BACKUP</Button>
      </div>
      <p className="mt-3 text-xs text-slate-500">CSV, XLSX, and PDF follow the optional search filter. Full JSON always includes every customer, monthly fee, and payment record with all columns.</p>
    </Card>
  </div>
}
