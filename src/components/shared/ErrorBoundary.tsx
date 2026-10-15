import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui'

interface Props { children: ReactNode; /** change this value to clear a previous error (e.g. the route) */ resetKey?: string }
interface State { error: Error | null }

/**
 * Catches render errors and failed lazy-loaded pages (which happen after a new deployment
 * when the browser still holds an old index.html) instead of leaving a blank screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }
  static getDerivedStateFromError(error: Error): State { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('UI error:', error, info.componentStack) }
  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }
  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const stale = /dynamically imported module|Importing a module script failed|Loading chunk|error loading dynamically/i.test(error.message)
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-4">
        <div className="w-full max-w-md space-y-3 rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-900" role="alert">
          <p className="font-semibold">{stale ? 'A new version is available' : 'This page could not be shown'}</p>
          <p>{stale ? 'Reload to get the latest version of the app.' : error.message}</p>
          <div className="flex gap-2">
            <Button onClick={() => window.location.reload()}>Reload page</Button>
            {!stale && <Button variant="secondary" onClick={() => this.setState({ error: null })}>Try again</Button>}
          </div>
        </div>
      </div>
    )
  }
}

export function ConfigErrorScreen({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-2 rounded-xl border border-red-200 bg-white p-6 text-sm shadow-sm" role="alert">
        <h1 className="text-lg font-bold text-red-700">App is not configured</h1>
        <p>{message}</p>
      </div>
    </div>
  )
}
