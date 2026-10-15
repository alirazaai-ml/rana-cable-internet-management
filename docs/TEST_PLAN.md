# Manual test plan

Prereq: admin account, one staff account (created from the Employee page), a few customers, invoices generated for the current month. Use two browsers (or one normal + one private) for admin and staff.

## A. Security (RLS)
| # | Steps | Expected |
|---|---|---|
| A1 | Open `/admin` while logged out | Redirect to `/login` |
| A2 | Log in as staff, type `/admin/employees` in the URL | Redirected to `/staff` |
| A3 | Staff: menu | Only Home, Customer, Collection, Complaint, About |
| A4 | Staff edits a customer's name | Saves OK |
| A5 | Staff tries to change balance/service/status (browser console: `supabase.from('customers').update({service_status:'off'}).eq('id',1)`) | Error "Staff cannot change balance, service status or customer status" |
| A6 | Staff console: `supabase.from('company_logs').select()`, `journal_entries`, `accounts`, `sms_templates` | Empty arrays |
| A7 | Staff console: `supabase.from('payments').delete()` / `.update({amount_paid:1})` | 0 rows affected (no policy) |
| A8 | Staff console: `supabase.rpc('reverse_payment',{p_payment_id:1,p_reason:'x'})` | Error "Only admin…" |
| A9 | Staff console: `supabase.from('packages').insert({name:'x',monthly_fee:1})` | RLS violation |
| A10 | Admin deactivates staff; staff (already signed in) reloads | Signed out / all queries empty; cannot sign in again |
| A11 | Call `create-staff` with a staff token | 403 "Admins only" |

## B. Payment correctness
| # | Steps | Expected |
|---|---|---|
| B1 | Customer with fee Rs. 1,500, opening balance 0. Record Rs. 500 | Receipt `RCP-YYYY-000001`; invoice shows remaining 1,000; customer balance Rs. 1,000 |
| B2 | Record Rs. 1,000 more | Invoice paid; balance Rs. 0 |
| B3 | Try Rs. 1 more on the paid invoice | Invoice not listed (only unpaid shown); via console RPC → "exceeds the remaining" |
| B4 | Admin reverses the Rs. 500 payment with reason | Row shows struck-through + "Reversed"; balance Rs. 500; Journal shows income + reversal expense; Cash Box net unchanged vs. before; Company Logs has `payment.reversed` |
| B5 | Reverse same payment again | Error "already reversed" |
| B6 | Run `ensure_monthly_fees` twice for the same month | Second run creates 0 |
| B7 | Customer opening balance Rs. 800 | Balance = 800 + unpaid invoices |
| B8 | Phone `+92 300 1234567`, `3001234567`, `00923001234567` | All stored as `03001234567`; invalid → inline error |
| B9 | Add customer with an existing phone | Warning prompt, can still save |

## C. Concurrency
Two staff (or two browser tabs) open *Record payment* for the **same customer/invoice** (remaining Rs. 1,000). Both enter Rs. 1,000 and press Save at the same moment.
Expected: exactly one succeeds; the other shows "exceeds the remaining Rs. 0"; total paid never exceeds invoice amount.

## D. WhatsApp flow
| # | Steps | Expected |
|---|---|---|
| D1 | Record payment | Dialog shows message with name, amount, month, remaining, receipt number |
| D2 | Press *Send via WhatsApp* | New tab opens `wa.me/92300…` with text pre-filled |
| D3 | Back in app, *Mark as Sent* | SMS Logs row → Sent; payment badge "WhatsApp sent" |
| D4 | Press *Skip* | SMS log stays Pending; payment row has WhatsApp icon to retry |
| D5 | Deactivate the "Payment Received" template, record payment | Payment saves; dialog says no template, no log row |

## E. Admin features
Package/Area create+edit, deactivate customer (history kept, service off), complaint assign → staff sees it → staff resolves, journal entry, manual account transaction, SMS template edit, Company Logs show all of the above, dashboard numbers match lists.

## F. UI
Test on a phone-width window (375px): menus, tables scroll horizontally, buttons ≥44px, dialogs usable; empty/loading/error states (turn off network to see the error state).

## G. Adding staff (Employee page)
| # | Steps | Expected |
|---|---|---|
| G1 | About → Run check | Every line ✅ (Edge Function may be ⚠ if you chose the link method) |
| G2 | Admin uses Employee → Add staff account with a new email and temporary password | Staff appears in the list; they can sign in and see the Staff panel |
| G3 | Same email again | "This login is already linked to a user" |
| G4 | Unknown email | "No login found for …" |
| G5 | (If deployed) *Create new login* tab with new email + password | Staff created in one step |
| G6 | (If not deployed) *Create new login* | Clear message and the dialog switches to the Link tab |
| G7 | Staff token calls `link_staff_account` from the console | "Only admin can add staff" |
