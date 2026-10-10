import { useCallback, useEffect, useState } from 'react';
import { Link2, Plug, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import { safeError } from '../services/errors';
import {
  integrationService,
  type IntegrationAction, type IntegrationConnection, type IntegrationProvider,
  type IntegrationVocabulary, type OAuthInitiation,
} from '../services/integrations';
import { LoadingState } from '../components/StateComponents';

/**
 * Destination accounts.
 *
 * The one word this screen must never say without evidence is CONNECTED. It is shown only when the
 * database says the connection is `connected` and a verification is recorded — never because an
 * authorization flow was started, never because a credential reference exists. A provider whose adapter
 * has never been exercised against the real provider is described as such, and a provider this
 * deployment has no credentials for says so instead of looking available.
 *
 * The screen also never shows a token, an authorization code or a secret: a connection names the vault
 * reference that holds the credential, and nothing else.
 */

const TONE: Record<string, string> = {
  connected: 'ok', pending: 'warn', reauth_required: 'warn', expired: 'warn', error: 'bad',
  revoked: 'muted', disabled: 'muted', disconnected: 'muted',
};

function when(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export function IntegrationsCanvas({ workspaceId, canManage = true }: {
  workspaceId: string | null; canManage?: boolean;
}) {
  const [vocabulary, setVocabulary] = useState<IntegrationVocabulary | null>(null);
  const [providers, setProviders] = useState<IntegrationProvider[]>([]);
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [provider, setProvider] = useState('');
  const [credentialReference, setCredentialReference] = useState('');
  const [accountLabel, setAccountLabel] = useState('');
  const [initiation, setInitiation] = useState<OAuthInitiation | null>(null);
  const [callbackState, setCallbackState] = useState('');
  const [callbackCode, setCallbackCode] = useState('');
  const [disconnectReason, setDisconnectReason] = useState('');

  const refresh = useCallback(() => setReloadKey(current => current + 1), []);

  useEffect(() => {
    if (!workspaceId) { setLoading(false); return; }
    let active = true;
    setLoading(true); setError(null);
    Promise.all([integrationService.vocabulary(workspaceId), integrationService.providers(workspaceId),
      integrationService.connections(workspaceId)])
      .then(([loadedVocabulary, loadedProviders, loadedConnections]) => {
        if (!active) return;
        setVocabulary(loadedVocabulary);
        setProviders(loadedProviders.items);
        setConnections(loadedConnections.items);
        const firstAvailable = loadedProviders.items.find(item => item.connection_available);
        setProvider(current => current || firstAvailable?.key || loadedProviders.items[0]?.key || '');
      })
      .catch(failure => { if (active) setError(safeError(failure).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceId, reloadKey]);

  const selected = providers.find(item => item.key === provider) ?? null;

  function announce(result: IntegrationAction | OAuthInitiation, fallback: string) {
    setNotice(result.note || fallback);
    refresh();
  }

  async function run(key: string, work: () => Promise<void>) {
    if (!workspaceId) return;
    setBusy(key); setError(null); setNotice(null);
    try { await work(); } catch (failure) { setError(safeError(failure).message); } finally { setBusy(null); }
  }

  if (!workspaceId) {
    return <p className="capability-note" role="status">Local preview only — connect a Supabase workspace to
      manage destination accounts.</p>;
  }
  if (loading) return <LoadingState label="Reading destination accounts…" />;

  return (
    <section className="p10-integrations" aria-label="Destination accounts">
      {error && <p className="error-text" role="alert">{error}</p>}
      {notice && <p className="subtle" role="status">{notice}</p>}
      {vocabulary && <p className="subtle">{vocabulary.credential_law} {vocabulary.token_refresh_boundary}</p>}

      <div className="p10-connections" role="region" aria-label="Connected destination accounts">
        <h3>Destination accounts</h3>
        {connections.length === 0
          ? <p className="subtle">No destination account is connected to this workspace yet.</p>
          : <ul className="p10-list">
            {connections.map(connection => (
              <li key={connection.id} className="p10-row">
                <div className="p10-row-head">
                  <strong>{connection.external_account_label || connection.provider_account_id || 'Unnamed account'}</strong>
                  <span className={`p10-badge p10-${TONE[connection.status] ?? 'muted'}`}>
                    {vocabulary?.connection_states[connection.status] ?? connection.status}
                  </span>
                </div>
                <p className="subtle">Provider: {connection.provider} · Auth: {connection.auth_type}</p>
                <p className="subtle">Verification: {connection.verified_at
                  ? `confirmed ${when(connection.verified_at)}`
                  : 'not confirmed by the provider'}{connection.last_success_at ? ` · last success ${when(connection.last_success_at)}` : ''}</p>
                {connection.last_error_code && (
                  <p className="p10-error">Last error: {connection.last_error_code} ({when(connection.last_error_at)})</p>
                )}
                <p className="subtle">Granted scopes: {connection.granted_scopes.length
                  ? connection.granted_scopes.join(', ') : 'none recorded'}</p>
                {connection.missing_requested_scopes.length > 0 && (
                  <p className="p10-warn">Missing scopes TONDE asked for: {connection.missing_requested_scopes.join(', ')}</p>
                )}
                <p className="subtle">
                  Credential: {connection.credential_reference_recorded
                    ? 'a vault reference is recorded; TONDE stores no credential'
                    : 'no vault reference recorded'}
                </p>
                {canManage && (
                  <div className="p10-actions">
                    <button type="button" disabled={busy !== null}
                      onClick={() => void run(`verify-${connection.id}`, async () => {
                        announce(await integrationService.verify(workspaceId, connection.id), 'Verification recorded.');
                      })}>
                      <RefreshCw size={14} aria-hidden /> Verify again
                    </button>
                    <button type="button" disabled={busy !== null}
                      onClick={() => void run(`reauthorize-${connection.id}`, async () => {
                        announce(await integrationService.reauthorize(workspaceId, connection.id, {
                          credential_reference: credentialReference || undefined,
                        }), 'Reauthorization recorded.');
                      })}>
                      <ShieldCheck size={14} aria-hidden /> Reauthorize
                    </button>
                    <button type="button" disabled={busy !== null}
                      onClick={() => void run(`disconnect-${connection.id}`, async () => {
                        announce(await integrationService.disconnect(workspaceId, connection.id,
                          { reason: disconnectReason }), 'The account is disconnected.');
                      })}>
                      <Unplug size={14} aria-hidden /> Disconnect
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>}
        {canManage && <label className="p10-field">
          <span>Reason recorded when disconnecting</span>
          <input aria-label="Disconnect reason" value={disconnectReason} maxLength={600}
            onChange={event => setDisconnectReason(event.target.value)} placeholder="Why is this account being disconnected?" />
        </label>}
      </div>

      <div className="p10-providers" role="region" aria-label="Providers available to this deployment">
        <h3>Providers</h3>
        <ul className="p10-list">
          {providers.map(item => (
            <li key={item.key} className="p10-row">
              <div className="p10-row-head">
                <strong>{item.name}</strong>
                <span className={`p10-badge p10-${item.adapter_state === 'verified' && item.enabled ? 'ok' : 'muted'}`}>
                  {vocabulary?.adapter_states[item.adapter_state] ?? item.adapter_state}
                </span>
              </div>
              <p className="subtle">{item.category.replaceAll('_', ' ')} · {item.auth_type}</p>
              {!item.connection_available && (
                <p className="p10-warn">This provider cannot be connected here: no enabled adapter exists for it yet.</p>
              )}
              {item.adapter.adapter_present && !item.adapter.configured && (
                <p className="p10-warn">No provider call can be made: this deployment is missing
                  {` ${item.adapter.unconfigured_dependencies.join(', ')}`}.</p>
              )}
              {item.capabilities.length > 0 && (
                <p className="subtle">Capabilities: {item.capabilities.map(capability => capability.capability_key).join(', ')}</p>
              )}
            </li>
          ))}
        </ul>
      </div>

      {canManage && selected && (
        <div className="p10-connect" role="region" aria-label="Connect a destination account">
          <h3>Connect an account</h3>
          <label className="p10-field">
            <span>Provider</span>
            <select aria-label="Provider to connect" value={provider} onChange={event => setProvider(event.target.value)}>
              {providers.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}
            </select>
          </label>
          <label className="p10-field">
            <span>Vault reference for the credential (never the credential itself)</span>
            <input aria-label="Credential reference" value={credentialReference} maxLength={200}
              onChange={event => setCredentialReference(event.target.value)} placeholder="e.g. vault/studio-channel" />
          </label>
          <label className="p10-field">
            <span>Account label</span>
            <input aria-label="Account label" value={accountLabel} maxLength={200}
              onChange={event => setAccountLabel(event.target.value)} placeholder="Which account is this?" />
          </label>
          <div className="p10-actions">
            <button type="button" disabled={busy !== null}
              onClick={() => void run('connect', async () => {
                announce(await integrationService.connect(workspaceId, {
                  provider, credential_reference: credentialReference, account_label: accountLabel,
                  requested_scopes: selected.scopes,
                }), 'Connection recorded.');
              })}>
              <Plug size={14} aria-hidden /> Connect and verify
            </button>
            <button type="button" disabled={busy !== null}
              onClick={() => void run('initiate', async () => {
                setNotice(null);
                const result = await integrationService.attemptInitiation(workspaceId, { provider });
                setInitiation(result);
                setNotice(result.note);
              })}>
              <Link2 size={14} aria-hidden /> Start authorization
            </button>
          </div>
          {initiation && (
            <div className="p10-oauth" role="region" aria-label="Authorization in progress">
              <p className="subtle">{initiation.initiated
                ? `Authorize at the provider, then paste the answer below. The state expires in ${initiation.expires_in_minutes} minutes and can be used once.`
                : 'No authorization flow was started.'}</p>
              {initiation.authorize_url && (
                <p><a href={initiation.authorize_url} target="_blank" rel="noreferrer">Open the provider authorization page</a></p>
              )}
              {initiation.unconfigured.length > 0 && (
                <p className="p10-warn">Unavailable here: {initiation.unconfigured.join(', ')}.</p>
              )}
              <label className="p10-field">
                <span>Authorization state</span>
                <input aria-label="Authorization state" value={callbackState} maxLength={200}
                  onChange={event => setCallbackState(event.target.value)} />
              </label>
              <label className="p10-field">
                <span>Authorization code from the provider</span>
                <input aria-label="Authorization code" value={callbackCode} maxLength={2000}
                  onChange={event => setCallbackCode(event.target.value)} />
              </label>
              <button type="button" disabled={busy !== null || !callbackState || !callbackCode}
                onClick={() => void run('callback', async () => {
                  announce(await integrationService.completeCallback(workspaceId, {
                    state: callbackState, code: callbackCode, account_label: accountLabel,
                    credential_reference: credentialReference,
                  }), 'Authorization answer recorded.');
                  setCallbackCode('');
                })}>
                Finish authorization
              </button>
            </div>
          )}
          <p className="subtle">{vocabulary?.oauth_state_law}</p>
        </div>
      )}
    </section>
  );
}
