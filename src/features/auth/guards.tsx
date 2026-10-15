import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from './AuthContext'
import type { Role } from '@/types/database'
import { Button, Skeleton } from '@/components/ui'

export function homeFor(role: Role) { return role === 'admin' ? '/admin' : '/staff' }

export function ProtectedRoute() {
  const { session, profile, loading, profileError, retryProfile, signOut } = useAuth()
  if (loading) return <div className="p-8"><Skeleton className="h-8 w-48" /></div>
  if (session && !profile && profileError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900" role="alert">
          <p className="font-semibold">Could not load your account</p>
          <p>{profileError}</p>
          <p className="text-xs">Check your internet connection and try again. You are still signed in.</p>
          <div className="flex gap-2">
            <Button onClick={() => void retryProfile()}>Try again</Button>
            <Button variant="secondary" onClick={() => void signOut()}>Sign out</Button>
          </div>
        </div>
      </div>
    )
  }
  if (!session || !profile) return <Navigate to="/login" replace />
  return <Outlet />
}

export function RoleGuard({ role }: { role: Role }) {
  const { profile } = useAuth()
  if (!profile) return <Navigate to="/login" replace />
  if (profile.role !== role) return <Navigate to={homeFor(profile.role)} replace />
  return <Outlet />
}

export function RootRedirect() {
  const { profile, loading } = useAuth()
  if (loading) return null
  return <Navigate to={profile ? homeFor(profile.role) : '/login'} replace />
}
