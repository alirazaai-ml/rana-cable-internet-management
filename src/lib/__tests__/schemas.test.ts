import { describe, expect, it } from 'vitest'
import { accountSchema, adjustSchema, areaSchema, complaintSchema, customerSchema, journalSchema, packageSchema, paymentSchema, staffSchema } from '../validation/schemas'

const okCustomer = { username: 'Ali Khan', phone: '0300 1234567', package_id: '2', area_id: '3', seller_id: '', address: '', cnic: '', father_name: '', notes: '' }

describe('customerSchema', () => {
  it('accepts a valid customer and coerces select values', () => {
    const r = customerSchema.safeParse(okCustomer)
    expect(r.success).toBe(true)
    if (r.success) { expect(r.data.package_id).toBe(2); expect(r.data.area_id).toBe(3) }
  })
  it('rejects bad phone, missing package, short name, bad CNIC', () => {
    expect(customerSchema.safeParse({ ...okCustomer, phone: '123' }).success).toBe(false)
    expect(customerSchema.safeParse({ ...okCustomer, package_id: '' }).success).toBe(false)
    expect(customerSchema.safeParse({ ...okCustomer, username: 'A' }).success).toBe(false)
    expect(customerSchema.safeParse({ ...okCustomer, cnic: '123' }).success).toBe(false)
    expect(customerSchema.safeParse({ ...okCustomer, cnic: '35202-1234567-1' }).success).toBe(true)
  })
  it('allows staff to skip package/area when editing (partial schema)', () => {
    const { package_id: _p, area_id: _a, ...rest } = okCustomer
    expect(customerSchema.partial({ package_id: true, area_id: true }).safeParse(rest).success).toBe(true)
  })
})

describe('paymentSchema', () => {
  it('requires a positive amount and a fee', () => {
    expect(paymentSchema.safeParse({ monthly_fee_id: '4', amount: '500', method: 'cash' }).success).toBe(true)
    expect(paymentSchema.safeParse({ monthly_fee_id: '4', amount: '0', method: 'cash' }).success).toBe(false)
    expect(paymentSchema.safeParse({ monthly_fee_id: '', amount: '10', method: 'cash' }).success).toBe(false)
    expect(paymentSchema.safeParse({ monthly_fee_id: '4', amount: '10', method: 'cheque' }).success).toBe(false)
  })
})

describe('complaintSchema (regression: database allows "hardware")', () => {
  it.each(['slow_speed', 'no_connection', 'billing', 'hardware', 'other'])('accepts %s', (category) => {
    expect(complaintSchema.safeParse({ customer_id: '1', category, complaint_text: 'No signal at all' }).success).toBe(true)
  })
  it('rejects unknown category and too-short text', () => {
    expect(complaintSchema.safeParse({ customer_id: '1', category: 'x', complaint_text: 'No signal at all' }).success).toBe(false)
    expect(complaintSchema.safeParse({ customer_id: '1', category: 'other', complaint_text: 'bad' }).success).toBe(false)
  })
})

describe('other schemas', () => {
  it('package fee cannot be negative', () => {
    expect(packageSchema.safeParse({ name: '2MB', monthly_fee: '2000', is_active: true }).success).toBe(true)
    expect(packageSchema.safeParse({ name: '2MB', monthly_fee: '-1', is_active: true }).success).toBe(false)
  })
  it('area, journal, account, adjust, staff', () => {
    expect(areaSchema.safeParse({ name: 'V' }).success).toBe(false)
    expect(journalSchema.safeParse({ entry_date: '2026-10-14', entry_type: 'expense', category: 'Fuel', amount: '300' }).success).toBe(true)
    expect(journalSchema.safeParse({ entry_date: '2026-10-14', entry_type: 'expense', category: 'Fuel', amount: '0' }).success).toBe(false)
    expect(accountSchema.safeParse({ name: 'Cash Box', account_type: 'cash' }).success).toBe(true)
    expect(adjustSchema.safeParse({ type: 'debit', amount: '-5' }).success).toBe(false)
    expect(staffSchema.safeParse({ full_name: 'Ahmed', email: 'a@b.com' }).success).toBe(true)
    expect(staffSchema.safeParse({ full_name: 'Ahmed', email: 'nope' }).success).toBe(false)
  })
})
