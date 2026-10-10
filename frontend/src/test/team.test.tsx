import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../contexts/AuthContext';
import { AppError } from '../services/errors';
import { InvitePage, TeamPage } from '../pages/TeamPage';

const teamMocks = vi.hoisted(() => ({
  members: vi.fn(),
  invites: vi.fn(),
  createInvite: vi.fn(),
  revokeInvite: vi.fn(),
  acceptInvite: vi.fn(),
}));

vi.mock('../services/team', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/team')>()),
  teamService: {
    members: teamMocks.members,
    invites: teamMocks.invites,
    createInvite: teamMocks.createInvite,
    revokeInvite: teamMocks.revokeInvite,
    acceptInvite: teamMocks.acceptInvite,
  },
}));

const OWNER_ID = '00000000-0000-4000-8000-000000000001';
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000010';

function authValue(session: boolean, userId = OWNER_ID) {
  return {
    session: session ? { user: { id: userId, email: 'owner@example.test' } } : null,
    workspaceId: session ? WORKSPACE_ID : null,
    loading: false,
    error: null,
    configured: true,
    localPreview: false,
    retry: vi.fn(),
  } as never;
}

function renderTeam(userId = OWNER_ID) {
  const router = createMemoryRouter([{ path: '/team', element: <TeamPage /> }], {
    initialEntries: ['/team'],
  });
  render(
    <AuthContext.Provider value={authValue(true, userId)}>
      <RouterProvider router={router} />
    </AuthContext.Provider>,
  );
}

function renderInvite(token: string, session: boolean) {
  const router = createMemoryRouter([{ path: '/invite/:token', element: <InvitePage /> }], {
    initialEntries: [`/invite/${token}`],
  });
  render(
    <AuthContext.Provider value={authValue(session)}>
      <RouterProvider router={router} />
    </AuthContext.Provider>,
  );
}

describe('TeamPage', () => {
  it('lists members and creates a single-use invite link for an owner', async () => {
    const user = userEvent.setup();
    teamMocks.members.mockResolvedValueOnce([
      { user_id: OWNER_ID, role: 'owner', created_at: '2026-10-10T00:00:00Z' },
    ]);
    teamMocks.invites.mockResolvedValue([]);
    teamMocks.createInvite.mockResolvedValueOnce({
      invite_id: 'invite-1',
      token: 'single-use-token',
      role: 'editor',
      expires_at: '2026-10-17T00:00:00Z',
    });
    renderTeam();
    expect(await screen.findByText('Team')).toBeVisible();
    expect(screen.getByText(/owner/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Create invite link' }));
    expect(teamMocks.createInvite).toHaveBeenCalledWith(WORKSPACE_ID, 'editor', 7);
    expect(await screen.findByText(/shown once and works once/)).toBeVisible();
    expect(screen.getByText(/single-use-token/, { exact: false })).toBeVisible();
  });

  it('stays read-only for viewers and names their role', async () => {
    const viewer = '00000000-0000-4000-8000-000000000002';
    teamMocks.members.mockResolvedValueOnce([
      { user_id: OWNER_ID, role: 'owner', created_at: '2026-10-10T00:00:00Z' },
      { user_id: viewer, role: 'viewer', created_at: '2026-10-10T00:00:00Z' },
    ]);
    renderTeam(viewer);
    expect(await screen.findByText(/Only a workspace owner or administrator can invite/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Create invite link' })).not.toBeInTheDocument();
  });

  it('revokes a pending invite link', async () => {
    const user = userEvent.setup();
    teamMocks.members.mockResolvedValueOnce([
      { user_id: OWNER_ID, role: 'admin', created_at: '2026-10-10T00:00:00Z' },
    ]);
    teamMocks.invites.mockResolvedValue([
      { invite_id: 'invite-1', role: 'editor', expires_at: '2099-10-17T00:00:00Z', accepted_at: null, revoked_at: null, created_at: '2026-10-10T00:00:00Z' },
    ]);
    teamMocks.revokeInvite.mockResolvedValueOnce(undefined);
    renderTeam();
    await user.click(await screen.findByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(teamMocks.revokeInvite).toHaveBeenCalledWith(WORKSPACE_ID, 'invite-1'));
  });
});

describe('InvitePage', () => {
  it('asks signed-out visitors to sign in first', async () => {
    renderInvite('abc123', false);
    expect(await screen.findByText(/Sign in or create an account first/)).toBeVisible();
    expect(sessionStorage.getItem('tonde:pending-invite')).toBe('abc123');
    sessionStorage.removeItem('tonde:pending-invite');
  });

  it('accepts a valid link for a signed-in creator', async () => {
    teamMocks.acceptInvite.mockResolvedValueOnce({ workspace_id: WORKSPACE_ID, role: 'editor' });
    renderInvite('good-token', true);
    expect(await screen.findByText(/You joined the workspace/)).toBeVisible();
    expect(teamMocks.acceptInvite).toHaveBeenCalledWith('good-token');
  });

  it('reports a spent link instead of joining', async () => {
    teamMocks.acceptInvite.mockRejectedValueOnce(new AppError('conflict', 'This invite link is invalid, expired, revoked, or already used.'));
    renderInvite('spent-token', true);
    expect(await screen.findByText(/invalid, expired, revoked, or already used/)).toBeVisible();
  });
});
