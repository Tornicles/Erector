/**
 * Team Types
 * Mirrors backend/models/teams.py
 */

import { TeamRole } from './enums';

export interface Skill {
  name: string;
  level: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  years_experience?: number | null;
}

export type MemberStatus = 'active' | 'inactive' | 'removed';
export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export interface TeamMember {
  user_id: string;
  email: string;
  role: TeamRole;
  permissions: string[];
  title?: string | null;
  department?: string | null;
  capacity_hours_per_week?: number | null;
  skills: Skill[];
  reliability_score?: number | null;
  commitment_score?: number | null;
  ego_type?: string | null;
  joined_at: string;
  last_active_at?: string | null;
  status: MemberStatus;
}

export interface TeamInvitation {
  invitation_id: string;
  email: string;
  role: TeamRole;
  invited_by: string;
  expires_at: string;
  accepted_at?: string | null;
  status: InvitationStatus;
}

export interface TeamSettings {
  allow_public_sharing: boolean;
  require_mfa: boolean;
  default_role: TeamRole;
  notification_digest: boolean;
}

export interface Team {
  team_id: string;
  owner_id: string;
  name: string;
  description?: string | null;
  members: TeamMember[];
  invitations: TeamInvitation[];
  subscription_id?: string | null;
  settings: TeamSettings;
  created_at: string;
  updated_at?: string | null;
}

export interface CreateTeamRequest {
  name: string;
  description?: string;
}

export interface InviteMemberRequest {
  email: string;
  role: TeamRole;
}
