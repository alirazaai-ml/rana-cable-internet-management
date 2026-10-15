/** Rs. 1,500 */
export function formatMoney(n: number | string | null | undefined): string {
  const v = Number(n ?? 0)
  const sign = v < 0 ? '-' : ''
  return `${sign}Rs. ${Math.abs(v).toLocaleString('en-PK', { maximumFractionDigits: 2 })}`
}

const TZ = 'Asia/Karachi'

export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '-'
  const date = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T00:00:00+05:00') : new Date(d)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ })
}

export function formatDateTime(d: string | Date | null | undefined): string {
  if (!d) return '-'
  const date = new Date(d)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ,
  })
}

export function formatMonth(d: string | null | undefined): string {
  if (!d) return '-'
  const date = new Date(d.slice(0, 10) + 'T00:00:00+05:00')
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: TZ })
}

/** Today's date (YYYY-MM-DD) in Pakistan time, regardless of the device's timezone. */
export function todayKarachi(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
}

/** First of the month (YYYY-MM-DD) in Pakistan time. */
export function currentMonthStart(): string {
  return todayKarachi().slice(0, 8) + '01'
}

/** Normalise Pakistani phone to 03XXXXXXXXX. Returns null if invalid. Mirrors the SQL function. */
export function normalizePhone(input: string): string | null {
  let d = input.replace(/\D/g, '')
  if (d.startsWith('0092')) d = d.slice(4)
  else if (d.startsWith('92') && d.length === 12) d = d.slice(2)
  if (d.length === 10 && d.startsWith('3')) d = '0' + d
  return /^03\d{9}$/.test(d) ? d : null
}

export const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
