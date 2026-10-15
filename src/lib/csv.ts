/**
 * CSV cell. Values starting with = + - @ are treated as formulas by Excel/Sheets ("CSV injection"),
 * so they get a leading apostrophe. Names and notes come from customers, so they are untrusted.
 */
export function csvCell(value: unknown): string {
  let t = String(value ?? '')
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`
  return `"${t.replaceAll('"', '""')}"`
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((values) => values.map(csvCell).join(',')).join('\r\n')
}
