import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { inviteLink, inviteStatus, teamService, type CreatedInvite, type InviteRole, type TeamInvite, type TeamMember, type TeamRole } from '../services/team';
import { safeError } from '../services/errors';
import { ErrorState, LoadingState } from '../components/StateComponents';

const INVITE_ROLES: InviteRole[] = ['editor', 'viewer', 'admin'];

function shortId(id: string): string {
  return id.length > 13 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

export function TeamPage() {
  const { workspaceId, session } = useAuth();
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [ownRole, setOwnRole] = useState<TeamRole | null>(null);
  const [invites, setInvites] = useState<TeamInvite[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<InviteRole>('editor');
  const [days, setDays] = useState(7);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!workspaceId || !session) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await teamService.members(workspaceId);
      setMembers(rows);
      setOwnRole(rows.find(row => row.user_id === session.user.id)?.role ?? null);
      try {
        setInvites(await teamService.invites(workspaceId));
      } catch {
        setInvites(null);
      }
    } catch (failure) {
      setError(safeError(failure).message);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, session]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!workspaceId) return <ErrorState title="No workspace" message="Sign in to manage your team." />;
  if (loading) return <LoadingState label="Loading team…" />;
  if (error) return <ErrorState message={error} retry={() => void reload()} />;

  const canInvite = ownRole === 'owner' || ownRole === 'admin';
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!workspaceId || creating) return;
    setCreating(true);
    setActionError(null);
    setCopied(false);
    try {
      setCreated(await teamService.createInvite(workspaceId, role, days));
      setInvites(await teamService.invites(workspaceId).catch(() => null));
    } catch (failure) {
      setActionError(safeError(failure).message);
    } finally {
      setCreating(false);
    }
  };
  const revoke = async (inviteId: string) => {
    if (!workspaceId) return;
    setActionError(null);
    try {
      await teamService.revokeInvite(workspaceId, inviteId);
      setInvites(await teamService.invites(workspaceId).catch(() => null));
    } catch (failure) {
      setActionError(safeError(failure).message);
    }
  };
  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(inviteLink(token));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section aria-labelledby="team-heading">
      <p className="eyebrow">PRODUCTION WORKSPACE</p>
      <h2 id="team-heading">Team</h2>
      <p className="subtle">Members of this workspace and single-use invite links. There is no email delivery: share a link yourself, and it works exactly once.</p>

      <h3>Members</h3>
      {!members?.length ? <p className="subtle">No members found.</p> : (
        <ul className="plain-list">
          {members.map(member => (
            <li key={member.user_id}>
              <span>{shortId(member.user_id)}</span>{' '}
              <span className="subtle">{member.role}{member.user_id === session?.user.id ? ' · you' : ''}</span>
            </li>
          ))}
        </ul>
      )}

      {canInvite ? (
        <>
          <h3>Invite someone</h3>
          <form className="inline-form" onSubmit={create}>
            <label>Role
              <select value={role} onChange={event => setRole(event.target.value as InviteRole)}>
                {INVITE_ROLES.map(option => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label>Link lasts (days)
              <input type="number" min={1} max={30} value={days} onChange={event => setDays(Number(event.target.value))} />
            </label>
            <button className="primary" disabled={creating}>{creating ? 'Creating…' : 'Create invite link'}</button>
          </form>
          <p className="subtle">Invites grant admin, editor, or viewer. Ownership is never granted by invite.</p>
          {created && (
            <div className="configuration-notice" role="status">
              <strong>Share this link yourself — it is shown once and works once.</strong>
              <p><code>{inviteLink(created.token)}</code></p>
              <button className="secondary-action" type="button" onClick={() => void copy(created.token)}>{copied ? 'Copied' : 'Copy link'}</button>
            </div>
          )}
          <h3>Invite links</h3>
          {!invites?.length ? <p className="subtle">No invite links yet.</p> : (
            <ul className="plain-list">
              {invites.map(invite => {
                const status = inviteStatus(invite);
                return (
                  <li key={invite.invite_id}>
                    <span>{invite.role} · {status} · expires {new Date(invite.expires_at).toLocaleDateString()}</span>{' '}
                    {status === 'pending' && <button className="secondary-action" type="button" onClick={() => void revoke(invite.invite_id)}>Revoke</button>}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : (
        <p className="subtle" role="status">Only a workspace owner or administrator can invite. Your role: {ownRole ?? 'unknown'}.</p>
      )}
      {actionError && <p role="alert" className="error-text">{actionError}</p>}
      <p><Link to="/home">Back to Home</Link></p>
    </section>
  );
}

export function InvitePage() {
  const { token } = useParams();
  const { session, loading } = useAuth();
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'failed'>(token ? 'idle' : 'failed');
  const [detail, setDetail] = useState<string | null>(token ? null : 'That invite link is invalid.');
  const [joined, setJoined] = useState<{ workspace_id: string; role: string } | null>(null);

  useEffect(() => {
    if (!token) return;
    if (!session) {
      try {
        sessionStorage.setItem('tonde:pending-invite', token);
      } catch {
        /* private browsing: the link stays in the address bar */
      }
      return;
    }
    let active = true;
    setState('working');
    teamService.acceptInvite(token).then(result => {
      if (!active) return;
      setJoined(result);
      setState('done');
      try {
        sessionStorage.removeItem('tonde:pending-invite');
      } catch {
        /* ignore */
      }
    }).catch(failure => {
      if (!active) return;
      setDetail(safeError(failure).message);
      setState('failed');
    });
    return () => {
      active = false;
    };
  }, [token, session]);

  if (loading) return <LoadingState label="Checking invite…" />;
  if (!session) {
    return (
      <section aria-labelledby="invite-heading">
        <p className="eyebrow">TEAM INVITE</p>
        <h2 id="invite-heading">You are invited to a TONDE workspace</h2>
        <p className="subtle">Sign in or create an account first, then open this link again to join. The link works exactly once.</p>
        <p><Link to="/login">Sign in</Link> · <Link to="/signup">Create account</Link></p>
      </section>
    );
  }
  if (state === 'done' && joined) {
    return (
      <section aria-labelledby="invite-heading">
        <p className="eyebrow">TEAM INVITE</p>
        <h2 id="invite-heading">You joined the workspace</h2>
        <p role="status">Workspace {shortId(joined.workspace_id)} · role {joined.role}.</p>
        <p><Link to="/home">Go to Home</Link> · <Link to="/team">View team</Link></p>
      </section>
    );
  }
  if (state === 'failed') return <ErrorState title="Invite not accepted" message={detail ?? 'That invite link is invalid.'} />;
  return <LoadingState label="Accepting invite…" />;
}
