import { describe, expect, it } from 'vitest'
import { csvCell, toCsv } from '../csv'

describe('csv export', () => {
  it('quotes and escapes', () => expect(csvCell('Ali "Bhai", Khan')).toBe('"Ali ""Bhai"", Khan"'))
  it('neutralises spreadsheet formulas (CSV injection)', () => {
    for (const evil of ['=HYPERLINK("http://x")', '+1+1', '-2+3', '@SUM(A1)']) {
      expect(csvCell(evil).startsWith(`"'`)).toBe(true)
    }
  })
  it('handles null and numbers', () => {
    expect(csvCell(null)).toBe('""')
    expect(csvCell(12.5)).toBe('"12.5"')
  })
  it('joins rows with CRLF', () => expect(toCsv([['a', 'b'], ['c', 'd']])).toBe('"a","b"\r\n"c","d"'))
})
