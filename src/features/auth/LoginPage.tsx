import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Navigate } from 'react-router-dom'
import { Wifi } from 'lucide-react'
import { Button, Card, Field, Input } from '@/components/ui'
import { useAuth } from './AuthContext'
import { homeFor } from './guards'

const schema = z.object({ email: z.string().trim().email('Enter your email'), password: z.string().min(1, 'Enter your password') })

export default function LoginPage() {
  const { signIn, profile } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) })
  if (profile) return <Navigate to={homeFor(profile.role)} replace />
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-100/60 via-slate-50 to-white p-4">
      <Card className="w-full max-w-sm p-6 shadow-lg sm:p-8">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="rounded-full bg-brand-100 p-3 text-brand-600"><Wifi className="h-7 w-7" /></div>
          <h1 className="text-xl font-bold">Rana Cable & Internet</h1>
          <p className="text-sm text-slate-500">Internet Customer Record Management</p>
        </div>
        <form className="space-y-4" onSubmit={handleSubmit(async (v) => setError(await signIn(v.email, v.password)))}>
          <Field label="Email" error={errors.email?.message}><Input type="email" autoComplete="username" {...register('email')} /></Field>
          <Field label="Password" error={errors.password?.message}><Input type="password" autoComplete="current-password" {...register('password')} /></Field>
          {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700" role="alert">{error}</p>}
          <Button type="submit" className="w-full" loading={isSubmitting}>Sign in</Button>
        </form>
        <p className="mt-4 text-center text-xs text-slate-400">Accounts are created by the administrator.</p>
      </Card>
    </div>
  )
}
