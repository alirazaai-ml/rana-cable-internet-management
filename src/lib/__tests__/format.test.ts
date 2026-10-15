import { describe, expect, it } from 'vitest'
import { currentMonthStart, formatDate, formatDateTime, formatMoney, formatMonth, normalizePhone, titleCase, todayKarachi } from '../format'

describe('dates (regression: timezone name was invalid and crashed every page)', () => {
  it('formats a date-only string in Pakistan time without throwing', () => {
    expect(formatDate('2026-10-14')).toBe('14 Oct 2026')
  })
  it('formats timestamps and months', () => {
    expect(formatDateTime('2026-10-14T00:00:00Z')).toContain('14 Oct 2026')
    expect(formatMonth('2026-10-01')).toBe('October 2026')
  })
  it('returns a dash for empty or invalid input instead of throwing', () => {
    expect(formatDate(null)).toBe('-')
    expect(formatDate('not a date')).toBe('-')
    expect(formatDateTime('nope')).toBe('-')
    expect(formatMonth(undefined)).toBe('-')
  })
  it('todayKarachi / currentMonthStart look like ISO dates', () => {
    expect(todayKarachi()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(currentMonthStart()).toMatch(/^\d{4}-\d{2}-01$/)
  })
})

describe('formatMoney', () => {
  it('formats rupees', () => {
    expect(formatMoney(1500)).toBe('Rs. 1,500')
    expect(formatMoney('2500.5')).toBe('Rs. 2,500.5')
    expect(formatMoney(null)).toBe('Rs. 0')
    expect(formatMoney(-300)).toBe('-Rs. 300')
  })
})

describe('normalizePhone (must mirror public.normalize_phone in SQL)', () => {
  it.each([
    ['03001234567', '03001234567'],
    ['0300 1234567', '03001234567'],
    ['+92 300 1234567', '03001234567'],
    ['923001234567', '03001234567'],
    ['00923001234567', '03001234567'],
    ['3001234567', '03001234567'],
    ['0300-123-4567', '03001234567'],
  ])('%s -> %s', (input, out) => expect(normalizePhone(input)).toBe(out))
  it.each(['', '12345', '0200 1234567', '0300123456', '03001234567890', 'abc'])('rejects %s', (input) => {
    expect(normalizePhone(input)).toBeNull()
  })
})

describe('titleCase', () => {
  it('turns snake_case into words', () => expect(titleCase('in_progress')).toBe('In Progress'))
})
