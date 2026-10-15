import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { AuthProvider } from '@/features/auth/AuthContext'

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000, gcTime: 5 * 60_000 } } })

export function Providers({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}><BrowserRouter><AuthProvider>{children}</AuthProvider></BrowserRouter></QueryClientProvider>
}
