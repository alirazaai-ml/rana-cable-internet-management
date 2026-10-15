// WhatsAppDialog.tsx

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { MessageCircle, CheckCircle2 } from 'lucide-react'
import { Button, Dialog, toast } from '@/components/ui'
import { smsProvider } from '@/lib/whatsapp'
import { supabase, errMsg } from '@/lib/query'

export interface WaPayload { smsLogId: number | null; phone: string; message: string; receipt: string }

/**
 * Step 6-9 of the spec: show preview -> open wa.me -> staff taps Send in WhatsApp ->
 * comes back and presses "Mark as Sent" (the database function then updates sms_logs + payments).
 */
export default function WhatsAppDialog({ payload, onClose }: { payload: WaPayload | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!payload) return null

  async function send() {
    const r = await smsProvider.send(payload!.phone, payload!.message)
    if (!r.ok) return toast.err(r.error ?? 'Could not open WhatsApp')
    setOpened(true)
  }
  async function markSent() {
    if (!payload!.smsLogId) return onClose()
    setBusy(true)
    const { error } = await supabase.rpc('mark_whatsapp_sent', { p_sms_log_id: payload!.smsLogId })
    setBusy(false)
    if (error) return toast.err(errMsg(error))
    toast.ok('Marked as sent')
    await qc.invalidateQueries({ queryKey: ['payments'] })
    setOpened(false); onClose()
  }
  function close() { setOpened(false); onClose() }

  return (
    <Dialog open onClose={close} title={`Receipt ${payload.receipt}`}>
      <div className="mb-3 flex items-center gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-800"><CheckCircle2 className="h-5 w-5" />Payment saved.</div>
      <p className="mb-1 text-sm font-medium">WhatsApp message to {payload.phone}</p>
      <pre className="mb-4 whitespace-pre-wrap rounded-lg bg-slate-100 p-3 text-sm">{payload.message || 'No active "Payment Received" template - message not generated.'}</pre>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={close}>Skip</Button>
        {payload.message && <Button variant="success" onClick={() => void send()}><MessageCircle className="h-4 w-4" />Send via WhatsApp</Button>}
        {opened && <Button loading={busy} onClick={() => void markSent()}>Mark as Sent</Button>}
      </div>
      {payload.message && <p className="mt-3 text-xs text-slate-500">WhatsApp opens in a new tab. Press Send there, come back, then tap "Mark as Sent".</p>}
    </Dialog>
  )
}
