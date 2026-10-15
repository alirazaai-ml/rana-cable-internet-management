import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/types/database'

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  /** Set when the profile could not be read (e.g. network down). The user stays signed in. */
  profileError: string | null
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
  retryProfile: () => Promise<void>
}
const Ctx = createContext<AuthState | null>(null)

/**
 * The role shown in the UI comes from the profiles table (read via RLS), never from
 * a value the user can edit. The database re-checks the role on every request anyway;
 * the UI only decides which menu items to show.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const profileRef = useRef<Profile | null>(null)
  profileRef.current = profile

  /**
   * Loads the profile. `inactive` means the account is unknown or disabled (the user is then
   * signed out); `error` means we could not ask (the user stays signed in and can retry).
   */
  const loadProfile = useCallback(async (s: Session | null): Promise<{ profile: Profile | null; inactive: boolean; error: string | null }> => {
    if (!s) { setProfile(null); setProfileError(null); return { profile: null, inactive: false, error: null } }
    const { data, error } = await supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle()
    if (error) {
      // A network blip must not log the user out; show a retry screen instead.
      setProfileError(error.message)
      return { profile: null, inactive: false, error: error.message }
    }
    setProfileError(null)
    if (!data || !data.is_active) {
      await supabase.auth.signOut()
      setProfile(null)
      return { profile: null, inactive: true, error: null }
    }
    setProfile(data as Profile)
    return { profile: data as Profile, inactive: false, error: null }
  }, [])

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return
      setSession(data.session)
      await loadProfile(data.session)
      if (alive) setLoading(false)
    }).catch(() => { if (alive) setLoading(false) })

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'SIGNED_OUT') { setProfile(null); setProfileError(null); return }
      // Token refreshes and the initial event need no profile reload.
      if ((event === 'SIGNED_IN' || event === 'USER_UPDATED') && s && profileRef.current?.id !== s.user.id) {
        // defer: calling supabase inside this callback can deadlock
        setTimeout(() => { void loadProfile(s) }, 0)
      }
    })
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [loadProfile])

  const value: AuthState = {
    session, profile, loading, profileError,
    async signIn(email, password) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        if (error.code === 'email_not_confirmed') {
          return 'Please confirm your email before signing in.'
        }
        return error.status === 400 ? 'Wrong email or password.' : `Could not sign in: ${error.message}`
      }
      setSession(data.session)
      const r = await loadProfile(data.session)
      if (r.inactive) return 'This account is not active. Contact the administrator.'
      if (r.error) return `Signed in, but your profile could not be loaded: ${r.error}`
      return null
    },
    async signOut() { await supabase.auth.signOut(); setProfile(null); setSession(null) },
    async retryProfile() { await loadProfile(session) },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth outside AuthProvider')
  return c
}
