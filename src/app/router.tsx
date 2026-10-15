import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ProtectedRoute, RoleGuard, RootRedirect } from '@/features/auth/guards'
import LoginPage from '@/features/auth/LoginPage'
import { AdminLayout, StaffLayout } from '@/components/layout/Layout'
import { Skeleton } from '@/components/ui'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'

const L = (f: () => Promise<{ default: React.ComponentType }>) => lazy(f)
const AdminHome = L(() => import('@/features/dashboard/AdminDashboard'))
const StaffHome = L(() => import('@/features/dashboard/StaffDashboard'))
const Customers = L(() => import('@/features/customers/CustomersPage'))
const Collections = L(() => import('@/features/payments/CollectionsPage'))
const Complaints = L(() => import('@/features/complaints/ComplaintsPage'))
const Employees = L(() => import('@/features/employees/EmployeesPage'))
const Packages = L(() => import('@/features/packages/PackagesPage'))
const Journal = L(() => import('@/features/journal/JournalPage'))
const Areas = L(() => import('@/features/areas/AreasPage'))
const Accounts = L(() => import('@/features/accounts/AccountsPage'))
const SmsTemplates = L(() => import('@/features/sms/SmsTemplatesPage'))
const SmsLogs = L(() => import('@/features/sms/SmsLogsPage'))
const CompanyLogs = L(() => import('@/features/logs/CompanyLogsPage'))
const About = L(() => import('@/features/about/AboutPage'))
const Backup = L(() => import('@/features/backup/BackupPage'))

export function AppRoutes() {
  const { pathname } = useLocation()
  return (
    <ErrorBoundary resetKey={pathname}>
    <Suspense fallback={<div className="p-8"><Skeleton className="h-8 w-48" /></div>}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<RootRedirect />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<RoleGuard role="admin" />}>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminHome />} />
              <Route path="customers" element={<Customers />} />
              <Route path="collections" element={<Collections />} />
              <Route path="complaints" element={<Complaints />} />
              <Route path="employees" element={<Employees />} />
              <Route path="packages" element={<Packages />} />
              <Route path="journal" element={<Journal />} />
              <Route path="areas" element={<Areas />} />
              <Route path="accounts" element={<Accounts />} />
              <Route path="sms-templates" element={<SmsTemplates />} />
              <Route path="sms-logs" element={<SmsLogs />} />
              <Route path="logs" element={<CompanyLogs />} />
              <Route path="backup" element={<Backup />} />
              <Route path="about" element={<About />} />
            </Route>
          </Route>
          <Route element={<RoleGuard role="staff" />}>
            <Route path="/staff" element={<StaffLayout />}>
              <Route index element={<StaffHome />} />
              <Route path="customers" element={<Customers />} />
              <Route path="collections" element={<Collections />} />
              <Route path="complaints" element={<Complaints />} />
              <Route path="about" element={<About />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
    </ErrorBoundary>
  )
}
