import { ConfigErrorScreen } from '@/components/shared/ErrorBoundary'
import { configError } from '@/lib/supabase'
import { Providers } from './providers'
import { AppRoutes } from './router'

export default function App() {
  if (configError) return <ConfigErrorScreen message={configError} />
  return <Providers><AppRoutes /></Providers>
}
