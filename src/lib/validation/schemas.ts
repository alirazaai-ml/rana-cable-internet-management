import { z } from 'zod'
import { normalizePhone } from '../format'

export const phoneField = z.string().trim().min(1, 'Phone is required')
  .refine((v) => normalizePhone(v) !== null, 'Enter a valid Pakistani mobile (e.g. 0300 1234567)')

const blankNum = z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().min(0).optional())
const optText = z.string().trim().optional().or(z.literal(''))
const idField = (label: string) => z.coerce.number({ invalid_type_error: `Select ${label}` }).int().positive(`Select ${label}`)

export const customerSchema = z.object({
  username: z.string().trim().min(2, 'Name is required'),
  phone: phoneField,
  package_id: idField('a package'),
  area_id: idField('an area'),
  seller_id: z.coerce.number().int().positive().optional().or(z.literal('')),
  address: optText,
  cnic: optText.refine((v) => !v || /^\d{5}-?\d{7}-?\d$/.test(v), 'CNIC must be 13 digits'),
  father_name: optText,
  notes: optText,
  // admin-only fields (ignored for staff by the DB trigger and hidden in the UI)
  opening_balance: z.coerce.number().min(0).optional(),
  service_status: z.enum(['on', 'off']).optional(),
  customer_status: z.enum(['active', 'inactive']).optional(),
})
export type CustomerForm = z.infer<typeof customerSchema>

export const areaSchema = z.object({ name: z.string().trim().min(2, 'Name is required'), description: optText })
export const packageSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  speed_label: optText,
  monthly_fee: z.coerce.number({ invalid_type_error: 'Enter a number' }).min(0),
  description: optText,
  is_active: z.boolean(),
})
export const staffSchema = z.object({
  full_name: z.string().trim().min(2, 'Name is required'),
  email: z.string().trim().email('Valid email required'),
  password: z.string().optional(), // required only in "create login" mode (checked in the page)
  phone: optText.refine((v) => !v || normalizePhone(v) !== null, 'Invalid phone'),
  role_title: optText,
  area_id: blankNum,
  monthly_salary: blankNum,
})
export const employeeEditSchema = z.object({
  full_name: z.string().trim().min(2, 'Name is required'),
  phone: optText.refine((v) => !v || normalizePhone(v) !== null, 'Invalid phone'),
  role_title: optText,
  area_id: blankNum,
  monthly_salary: blankNum,
})
export const paymentSchema = z.object({
  monthly_fee_id: idField('a monthly fee'),
  amount: z.coerce.number({ invalid_type_error: 'Enter amount' }).positive('Amount must be above 0'),
  method: z.enum(['cash', 'bank_transfer', 'other']),
  notes: optText,
})
export const complaintSchema = z.object({
  customer_id: idField('a customer'),
  category: z.enum(['slow_speed', 'no_connection', 'billing', 'hardware', 'other']),
  complaint_text: z.string().trim().min(5, 'Describe the problem'),
})
export const journalSchema = z.object({
  entry_date: z.string().min(1),
  entry_type: z.enum(['income', 'expense']),
  category: z.string().trim().min(2, 'Category required'),
  amount: z.coerce.number({ invalid_type_error: 'Enter amount' }).positive('Amount must be above 0'),
  description: optText,
})
export const accountSchema = z.object({ name: z.string().trim().min(2, 'Name is required'), account_type: z.enum(['cash', 'bank']) })
export const adjustSchema = z.object({
  type: z.enum(['credit', 'debit']),
  amount: z.coerce.number({ invalid_type_error: 'Enter amount' }).positive('Amount must be above 0'),
  description: optText,
})
export const templateSchema = z.object({
  name: z.string().trim().min(2, 'Name is required'),
  template_text: z.string().trim().min(5, 'Template text is required'),
  is_active: z.boolean(),
})
