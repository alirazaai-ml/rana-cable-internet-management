import { normalizePhone } from './format'

/**
 * SmsProvider: the payment flow only talks to this interface, so moving from the free
 * wa.me link to Meta WhatsApp Cloud API or Twilio later means writing ONE new class,
 * not rewriting the payment screens.
 */
export interface SmsProvider {
  readonly name: string
  /** manual providers just open a link and need a human "Mark as sent" afterwards */
  readonly requiresManualConfirm: boolean
  send(phone: string, message: string): Promise<{ ok: boolean; error?: string }>
}

/** 03XXXXXXXXX -> 923XXXXXXXXX (wa.me wants the international number without + or 00). */
export function toWaNumber(phone: string): string {
  const n = normalizePhone(phone)
  if (!n) throw new Error('Invalid phone number')
  return '92' + n.slice(1)
}

export function waLink(phone: string, message: string): string {
  return `https://wa.me/${toWaNumber(phone)}?text=${encodeURIComponent(message)}`
}

export const WhatsAppLinkProvider: SmsProvider = {
  name: 'whatsapp_manual',
  requiresManualConfirm: true,
  async send(phone, message) {
    try {
      window.open(waLink(phone, message), '_blank', 'noopener,noreferrer')
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
}

export const smsProvider: SmsProvider = WhatsAppLinkProvider
