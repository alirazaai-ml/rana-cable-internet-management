// Hand-written row types mirroring supabase/migrations/0001_tables.sql.
// (Later you can replace with `supabase gen types typescript` output.)

// src/types/database.ts
export type Role = 'admin' | 'staff'

export interface Profile { id: string; full_name: string; role: Role; is_active: boolean; created_at: string; updated_at: string }
export interface EmployeeOption { id: number; full_name: string; is_active: boolean }
export interface Area { id: number; name: string; description: string | null; created_at: string }
export interface Package { id: number; name: string; speed_label: string | null; monthly_fee: number; description: string | null; is_active: boolean; created_at: string; updated_at?: string }
export interface Employee {
  id: number; profile_id: string | null; full_name: string; phone: string | null; role_title: string | null
  area_id: number | null; monthly_salary: number | null; is_active: boolean; joined_at: string
  areas?: { name: string } | null
}
export interface Customer {
  id: number; customer_code: string; username: string; phone: string; package_id: number; area_id: number
  seller_id: number | null; address: string | null; opening_balance: number; balance: number
  service_status: 'on' | 'off'; customer_status: 'active' | 'inactive'
  cnic: string | null; father_name: string | null; notes: string | null; created_at: string
  areas?: { name: string } | null; packages?: { name: string; monthly_fee: number } | null
}
export type FeeStatus = 'paid' | 'partial' | 'unpaid' | 'overdue'
export interface FeeBalance {
  monthly_fee_id: number; customer_id: number; billing_month: string; amount_due: number; due_date: string
  total_paid: number; remaining: number; status: FeeStatus
}
export interface Payment {
  id: number; customer_id: number; monthly_fee_id: number; amount_paid: number; payment_method: 'cash' | 'bank_transfer' | 'other'
  payment_date: string; received_by: string; receipt_number: string; notes: string | null
  reversed_at: string | null; reversal_reason: string | null; whatsapp_sent: boolean; created_at: string
  customers?: { username: string; customer_code: string; phone: string; areas?: { name: string } | null } | null
  monthly_fees?: { billing_month: string } | null
  profiles?: { full_name: string } | null
}
export interface Complaint {
  id: number; customer_id: number; complaint_text: string; category: string
  status: 'open' | 'in_progress' | 'resolved' | 'closed'; assigned_to: string | null
  resolution_notes: string | null; created_by: string | null; created_at: string; resolved_at: string | null
  customers?: { username: string; customer_code: string } | null
  assignee?: { full_name: string } | null
}
export interface JournalEntry { id: number; entry_date: string; entry_type: 'income' | 'expense'; category: string; amount: number; description: string | null; reference_payment_id: number | null }
export interface Account { id: number; name: string; account_type: 'cash' | 'bank'; current_balance: number; is_active: boolean }
export interface AccountTransaction { id: number; account_id: number; transaction_type: 'credit' | 'debit'; amount: number; description: string | null; created_at: string }
export interface SmsTemplate { id: number; name: string; template_text: string; is_active: boolean; updated_at: string }
export interface SmsLog {
  id: number; customer_id: number | null; phone: string; message_text: string; status: 'pending' | 'sent' | 'failed'
  provider: string; error_message: string | null; created_at: string; sent_at: string | null
  customers?: { username: string } | null
}
export interface CompanyLog { id: number; actor_id: string | null; action: string; entity_type: string; entity_id: string | null; details: unknown; created_at: string; profiles?: { full_name: string } | null }
