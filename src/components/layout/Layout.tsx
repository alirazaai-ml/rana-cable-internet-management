import { useState, type ComponentType } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  BookOpen, Boxes, Calculator, ClipboardList, Home, Info, LogOut, Map, Menu, MessageSquare, MessageSquareText,
  ScrollText, UserCog, Users, Wallet, Wifi, X, Banknote, Download,
} from 'lucide-react'
import { useAuth } from '@/features/auth/AuthContext'
import { cn } from '@/lib/utils'
import { Toaster } from '@/components/ui'

type Item = { to: string; label: string; icon: ComponentType<{ className?: string }>; end?: boolean }

const adminNav: Item[] = [
  { to: '/admin', label: 'Home', icon: Home, end: true },
  { to: '/admin/customers', label: 'Customer', icon: Users },
  { to: '/admin/collections', label: 'Collection', icon: Banknote },
  { to: '/admin/complaints', label: 'Complaint', icon: MessageSquare },
  { to: '/admin/employees', label: 'Employee', icon: UserCog },
  { to: '/admin/packages', label: 'Package', icon: Boxes },
  { to: '/admin/journal', label: 'Journal', icon: BookOpen },
  { to: '/admin/areas', label: 'Area', icon: Map },
  { to: '/admin/accounts', label: 'Account', icon: Wallet },
  { to: '/admin/sms-templates', label: 'SMS Template', icon: MessageSquareText },
  { to: '/admin/sms-logs', label: 'SMS Logs', icon: Calculator },
  { to: '/admin/logs', label: 'Company Logs', icon: ScrollText },
  { to: '/admin/backup', label: 'Backup & Export', icon: Download },
  { to: '/admin/about', label: 'About', icon: Info },
]
const staffNav: Item[] = [
  { to: '/staff', label: 'Home', icon: Home, end: true },
  { to: '/staff/customers', label: 'Customer', icon: Users },
  { to: '/staff/collections', label: 'Collection', icon: Banknote },
  { to: '/staff/complaints', label: 'Complaint', icon: ClipboardList },
  { to: '/staff/about', label: 'About', icon: Info },
]

function Shell({ items, title }: { items: Item[]; title: string }) {
  const [open, setOpen] = useState(false)
  const { profile, signOut } = useAuth()
  const nav = (
    <nav aria-label="Main" className="flex-1 space-y-1 overflow-y-auto p-3">
      {items.map((i) => (
        <NavLink key={i.to} to={i.to} end={i.end} onClick={() => setOpen(false)}
          className={({ isActive }) => cn('flex min-h-[44px] items-center gap-3 rounded-lg px-3 text-sm font-medium',
            isActive ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-300 transition hover:bg-slate-800 hover:text-white')}>
          <i.icon className="h-5 w-5 shrink-0" aria-hidden />{i.label}
        </NavLink>
      ))}
    </nav>
  )
  const side = (
    <div className="flex h-full flex-col bg-slate-900 text-white">
      <div className="flex items-center gap-2 border-b border-slate-800 p-4"><Wifi className="h-6 w-6 text-brand-500" /><div><div className="font-bold">Rana Cable & Internet</div><div className="text-xs text-slate-400">{title}</div></div></div>
      {nav}
      <div className="border-t border-slate-800 p-3 text-sm">
        <div className="mb-2 truncate px-3 text-xs text-slate-400">Signed in as <span className="font-medium text-slate-200">{profile?.full_name}</span></div>
        <button onClick={() => void signOut()} className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 text-slate-300 hover:bg-slate-800"><LogOut className="h-4 w-4" />Sign out</button>
      </div>
    </div>
  )
  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden w-60 shrink-0 lg:block"><div className="fixed inset-y-0 w-60">{side}</div></aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden"><div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64">{side}</div></div>
      )}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:hidden">
          <button onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open} className="rounded p-2 hover:bg-slate-100">{open ? <X /> : <Menu />}</button>
          <span className="font-semibold">Rana Cable & Internet</span><span className="text-xs text-slate-500">{title}</span>
        </header>
        <main className="mx-auto max-w-7xl p-4 sm:p-6"><Outlet /></main>
      </div>
      <Toaster />
    </div>
  )
}
export const AdminLayout = () => <Shell items={adminNav} title="Admin Panel" />
export const StaffLayout = () => <Shell items={staffNav} title="Staff Panel" />
