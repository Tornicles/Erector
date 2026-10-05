/**
 * Auth Types
 * Mirrors backend/models/auth.py
 */

import { Platform } from './enums';

export interface ErectorSession {
  session_id: string;
  user_id: string;
  expires_at: string;
  refresh_expires_at: string;
  device_id?: string | null;
  platform: Platform;
  revoked_at?: string | null;
  created_at: string;
}

export interface MagicLinkAttempt {
  attempt_id: string;
  email_hash: string;
  expires_at: string;
  consumed_at?: string | null;
  created_at: string;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  session_id: string;
}

export interface MagicLinkRequest {
  email: string;
  redirect_url?: string;
}

export interface MagicLinkVerify {
  token: string;
  email: string;
}
