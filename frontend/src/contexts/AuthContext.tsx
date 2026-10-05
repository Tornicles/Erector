import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { configurationError, localPreview, supabase } from '../lib/supabase';
import { safeError } from '../services/errors';

type AuthState = {
  session: Session | null;
  workspaceId: string | null;
  loading: boolean;
  error: string | null;
  configured: boolean;
  localPreview: boolean;
  retry: () => void;
};
const AuthContext = createContext<AuthState | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<AuthState, 'retry'>>({ session: null, workspaceId: null, loading: true, error: null, configured: !configurationError, localPreview: false });
  const generation = useRef(0);
  const readyWorkspace = useRef<{ userId: string; workspaceId: string } | null>(null);
  const effectiveSupabase = localPreview ? null : supabase;
  const applySession = useCallback(async (session: Session | null) => {
    const version = ++generation.current;
    if (session && readyWorkspace.current?.userId === session.user.id) {
      setState({ session, workspaceId: readyWorkspace.current.workspaceId, loading: false, error: null, configured: true, localPreview: false });
      return;
    }
    readyWorkspace.current = null;
    setState({ session, workspaceId: null, loading: !!session, error: null, configured: !!effectiveSupabase, localPreview: false });
    if (!session || !effectiveSupabase) return;
    const { data, error } = await effectiveSupabase.rpc('bootstrap_workspace');
    if (version !== generation.current) return;
    if (!error && data) readyWorkspace.current = { userId: session.user.id, workspaceId: data };
    setState({ session, workspaceId: error ? null : data, loading: false, error: error ? safeError(error).message : null, configured: true, localPreview: false });
  }, [effectiveSupabase]);
  useEffect(() => {
    if (localPreview) {
      setState({ session: null, workspaceId: null, loading: false, error: null, configured: false, localPreview: true });
      return;
    }
    if (!effectiveSupabase) {
      setState({ session: null, workspaceId: null, loading: false, error: configurationError, configured: false, localPreview: false });
      return;
    }
    let active = true;
    let authEventReceived = false;
    const { data: { subscription } } = effectiveSupabase.auth.onAuthStateChange((_event, session) => {
      authEventReceived = true;
      window.setTimeout(() => { if (active) void applySession(session); }, 0);
    });
    effectiveSupabase.auth.getSession().then(({ data, error }) => {
      if (!active || authEventReceived) return;
      if (error) setState(s => ({ ...s, loading: false, error: 'Your session could not be restored. Please retry sign-in.' }));
      else void applySession(data.session);
    }).catch(() => { if (active) setState(s => ({ ...s, loading: false, error: 'Your session could not be restored.' })); });
    return () => { active = false; generation.current++; subscription.unsubscribe(); };
  }, [applySession, localPreview, effectiveSupabase]);
  return <AuthContext.Provider value={{ ...state, retry: () => { void applySession(state.session); } }}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider is required.');
  return context;
}
export { AuthContext };
