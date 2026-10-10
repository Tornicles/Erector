import { authenticatedRequest } from './api';

export type TeamRole = 'owner' | 'admin' | 'editor' | 'viewer';
export type InviteRole = 'admin' | 'editor' | 'viewer';

export interface TeamMember {
  user_id: string;
  role: TeamRole;
  created_at: string;
}

export interface TeamInvite {
  invite_id: string;
  role: InviteRole;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface CreatedInvite {
  invite_id: string;
  token: string;
  role: InviteRole;
  expires_at: string;
}

export type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export function inviteStatus(invite: TeamInvite, now = Date.now()): InviteStatus {
  if (invite.accepted_at) return 'accepted';
  if (invite.revoked_at) return 'revoked';
  if (Date.parse(invite.expires_at) <= now) return 'expired';
  return 'pending';
}

export function inviteLink(token: string): string {
  return `${window.location.origin}/invite/${token}`;
}

export const teamService = {
  async members(workspaceId: string): Promise<TeamMember[]> {
    return authenticatedRequest<TeamMember[]>(`/api/v1/workspaces/${workspaceId}/team/members`);
  },
  async invites(workspaceId: string): Promise<TeamInvite[]> {
    return authenticatedRequest<TeamInvite[]>(`/api/v1/workspaces/${workspaceId}/team/invites`);
  },
  async createInvite(workspaceId: string, role: InviteRole, expiresInDays: number): Promise<CreatedInvite> {
    return authenticatedRequest<CreatedInvite>(`/api/v1/workspaces/${workspaceId}/team/invites`, {
      method: 'POST',
      body: JSON.stringify({ role, expires_in_days: expiresInDays }),
    });
  },
  async revokeInvite(workspaceId: string, inviteId: string): Promise<void> {
    await authenticatedRequest(`/api/v1/workspaces/${workspaceId}/team/invites/${inviteId}/revoke`, {
      method: 'POST',
    });
  },
  async acceptInvite(token: string): Promise<{ workspace_id: string; role: TeamRole }> {
    return authenticatedRequest(`/api/v1/invites/accept`, {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  },
};
