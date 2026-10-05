import { requireSupabase } from '../lib/supabase';
import { AppError } from './errors';
const redirect = (path: string) => `${window.location.origin}${path}`;
export const authService = {
  async signIn(email: string, password: string) {
    const { error } = await requireSupabase().auth.signInWithPassword({ email, password });
    if (error) throw new AppError('authentication', 'Sign-in failed. Check your credentials, email verification, or provider settings.');
  },
  async signUp(email: string, password: string) {
    const { data, error } = await requireSupabase().auth.signUp({ email, password, options: { emailRedirectTo: redirect('/auth/callback') } });
    if (error) throw new AppError('authentication', 'Account creation failed. Check the password requirements and whether signups are enabled.');
    return data.session ? 'Account created.' : 'Check your email to verify your account before signing in.';
  },
  async google() {
    const { error } = await requireSupabase().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirect('/auth/callback') } });
    if (error) throw new AppError('authentication', 'Google sign-in is unavailable. Verify that Google OAuth and this callback URL are enabled in Supabase.');
  },
  async resetPassword(email: string) {
    const { error } = await requireSupabase().auth.resetPasswordForEmail(email, { redirectTo: redirect('/auth/reset') });
    if (error) throw new AppError('authentication', 'The reset request could not be completed. Please retry.');
  },
  async updatePassword(password: string) {
    const { error } = await requireSupabase().auth.updateUser({ password });
    if (error) throw new AppError('authentication', 'The password could not be updated. Open a fresh reset link and retry.');
  },
  async signOut() {
    const { error } = await requireSupabase().auth.signOut();
    if (error) throw new AppError('authentication', 'Logout failed. Please retry.');
  },
};
