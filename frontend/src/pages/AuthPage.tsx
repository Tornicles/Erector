import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { authService } from '../services/auth';
import { safeError } from '../services/errors';
import { configurationError, localPreview } from '../lib/supabase';
export function AuthPage({ reset = false }: { reset?: boolean }) {
  const { session, loading, configured } = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState<string | null>(null); const [error, setError] = useState<string | null>(null); const [reload, setReload] = useState(false);
  const from = (location.state as { from?: string } | null)?.from;
  if (reload) return <Navigate to="/login" replace />;
  if (session && !reset && !loading) return <Navigate to={from?.startsWith('/') && !from.startsWith('//') ? from : '/home'} replace />;
  async function act(operation: () => Promise<void | string>) {
    setBusy(true); setError(null); setMessage(null);
    try { const result = await operation(); if (result) setMessage(result); }
    catch (failure) { setError(safeError(failure).message); }
    finally { setBusy(false); }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void act(async () => {
      if (reset) { await authService.updatePassword(password); return 'Password updated. You can return to your workspace.'; }
      if (mode === 'signup') return authService.signUp(email, password);
      if (mode === 'forgot') { await authService.resetPassword(email); return 'If an account exists, check your email for the reset link.'; }
      await authService.signIn(email, password);
    });
  };
  return <main className="auth-page">
    <section className="auth-brand"><div className="wordmark">TONDE<span>®</span></div><p className="eyebrow">YOUR AI PRODUCTION DIRECTOR</p><h1>From a vision.<br />To a production.</h1><p className="auth-promise">Show TONDE what you want to make.<br />TONDE tells you exactly how to make it.</p><div className="auth-footer"><span>ONE CREATIVE TRUTH.</span><span>REAL / AI / HYBRID</span></div></section>
    <section className="auth-form"><p className="eyebrow">WELCOME TO TONDE</p><h2>{reset ? 'Set a new password' : mode === 'signup' ? 'Create your account' : mode === 'forgot' ? 'Reset your password' : localPreview ? 'Local preview — no live project' : 'Your next production starts here.'}</h2>
      {!configured && !localPreview && <div className="configuration-notice" role="status"><strong>Supabase connection required</strong><p>{configurationError}</p><p>No mock authentication is enabled. Your workspace will become available when the real project is configured.</p></div>}        {localPreview && <div className="configuration-notice" role="status"><strong>Local preview only</strong><p>TONDE is running without a configured Supabase project. Real sign-in, Google, email, and private uploads are not available until the project is configured. This preview is for interface iteration only.</p></div>}
      {reset && !session && <p role="alert">Open the password reset link from your email to restore a recovery session.</p>}
      <form onSubmit={submit}>
        {!reset && <label>Email address<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} disabled={!configured || busy} /></label>}
        {(reset || mode !== 'forgot') && <label>Password<input type="password" autoComplete={reset || mode === 'signup' ? 'new-password' : 'current-password'} minLength={8} required value={password} onChange={e => setPassword(e.target.value)} disabled={!configured || busy} /></label>}
        {error && <p className="error-text" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
        <button className="primary" disabled={!configured || busy || reset && !session}>{busy ? 'Connecting…' : reset ? 'Update password' : mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : 'Enter your workspace'}<ArrowUpRight size={17} /></button>
      {!configured && localPreview && <button className="secondary-action" type="button" onClick={() => setReload(true)}>Leave local preview</button>}
      </form>
      {!reset && <><button className="google-button" disabled={!configured || busy} onClick={() => { void act(authService.google); }}>Continue with Google</button><div className="auth-links"><button onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setError(null); }}>{mode === 'signup' ? 'Already have an account?' : 'Create an account'}</button><button onClick={() => { setMode(mode === 'forgot' ? 'login' : 'forgot'); setError(null); }}>{mode === 'forgot' ? 'Back to sign in' : 'Forgot password?'}</button></div></>}
      {reset && session && <a href="/home">Return to workspace</a>}
      <p className="subtle">Your productions belong to your workspace. Private by default.</p>
    </section>
  </main>;
}
