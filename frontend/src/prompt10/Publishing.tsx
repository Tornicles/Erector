import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, ExternalLink, RefreshCw, Send, ShieldCheck, Undo2 } from 'lucide-react';
import { safeError } from '../services/errors';
import {
  publishingService,
  type Publication, type PublicationAction, type PublicationStatus,
  type PublishingVocabulary,
} from '../services/publishing';
import { LoadingState } from '../components/StateComponents';

/**
 * Publishing one exact artifact to one external destination.
 *
 * The screen is built around the acts a creator owns and the facts only the destination can provide:
 *
 * * it shows the pinned Production revision, Result revision, media checksum and destination — what an
 *   authorization names — and reports changed content as changed instead of still approved;
 * * **Authorize** is its own button with its own record. A creative approval is never used as publishing
 *   authority, and this screen says so instead of implying it;
 * * submitting shows the destination's own answer. `published` appears only with a remote resource, and
 *   an ambiguous answer is shown as **destination state unknown** with reconciliation offered, never as
 *   success or failure.
 *
 * The browser never holds a provider token: the call is made by the server through its adapter.
 */

const TONE: Record<string, string> = {
  draft: 'muted', ready: 'ok', awaiting_authorization: 'warn', submitting: 'warn', submitted: 'warn',
  processing: 'warn', published: 'ok', failed: 'bad', cancelled: 'muted', removed: 'muted',
  unknown_remote_state: 'bad',
};

function when(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export function PublishingCanvas({ workspaceId, productionId, canManage = true }: {
  workspaceId: string; productionId: string; canManage?: boolean;
}) {
  const [vocabulary, setVocabulary] = useState<PublishingVocabulary | null>(null);
  const [publications, setPublications] = useState<Publication[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [status, setStatus] = useState<PublicationStatus | null>(null);
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [note, setNote] = useState('');
  const [observed, setObserved] = useState('published');
  const [observedResource, setObservedResource] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const refresh = useCallback(() => setReloadKey(current => current + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    Promise.all([publishingService.vocabulary(workspaceId),
      publishingService.list(workspaceId, { production_id: productionId })])
      .then(([loadedVocabulary, loaded]) => {
        if (!active) return;
        setVocabulary(loadedVocabulary);
        setPublications(loaded.items);
        setSelectedId(current => (current && loaded.items.some(item => item.id === current))
          ? current : (loaded.items[0]?.id ?? ''));
      })
      .catch(failure => { if (active) setError(safeError(failure).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceId, productionId, reloadKey]);

  useEffect(() => {
    if (!selectedId) { setStatus(null); return; }
    let active = true;
    publishingService.status(workspaceId, selectedId).then(loaded => {
      if (!active) return;
      setStatus(loaded);
      setTitle(loaded.publication.title);
      setCaption(loaded.publication.caption);
    }).catch(failure => { if (active) setStatus(null); setNotice(safeError(failure).message); });
    return () => { active = false; };
  }, [workspaceId, selectedId, reloadKey]);

  async function run(work: () => Promise<PublicationAction>) {
    if (!canManage) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await work();
      setNotice(result.note || result.meaning || 'Recorded.');
      refresh();
    } catch (failure) {
      setError(safeError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingState label="Reading publications for this Production…" />;

  const publication = status?.publication ?? null;
  const preview = status?.preview ?? null;
  const published = publication?.state === 'published';

  return (
    <section className="p10-publishing" aria-label="Publishing to an external destination">
      {error && <p className="error-text" role="alert">{error}</p>}
      {notice && <p className="subtle" role="status">{notice}</p>}
      {vocabulary && <p className="subtle">{vocabulary.authority_law}</p>}

      <label className="p10-field">
        <span>Publication</span>
        <select aria-label="Publication" value={selectedId} onChange={event => setSelectedId(event.target.value)}>
          {publications.length === 0 && <option value="">No publication for this Production yet</option>}
          {publications.map(item => (
            <option key={item.id} value={item.id}>
              {(item.title || 'Untitled')} · {vocabulary?.states[item.state] ?? item.state} · {item.destination_provider}
            </option>
          ))}
        </select>
      </label>

      {!publication && <p className="subtle">Choose a publication to review, authorize and submit.</p>}

      {publication && (
        <>
          <div className="p10-row" role="region" aria-label="Pinned content and destination">
            <div className="p10-row-head">
              <strong>{publication.title || 'Untitled publication'}</strong>
              <span className={`p10-badge p10-${TONE[publication.state] ?? 'muted'}`}>
                {vocabulary?.states[publication.state] ?? publication.state}
              </span>
            </div>
            <dl className="p10-facts">
              <div><dt>Production revision (pinned)</dt><dd>{publication.production_revision}</dd></div>
              <div><dt>Production revision now</dt><dd>{preview?.production.current_revision ?? '—'}</dd></div>
              <div><dt>Result revision (pinned)</dt><dd>{publication.result_revision}</dd></div>
              <div><dt>Result revision now</dt><dd>{preview?.result.current_revision ?? '—'}</dd></div>
              <div><dt>Media checksum (pinned)</dt><dd>{publication.media_checksum || '—'}</dd></div>
              <div><dt>Destination</dt><dd>{publication.destination_provider}{publication.destination ? ` · ${publication.destination}` : ''}</dd></div>
              <div><dt>Visibility</dt><dd>{publication.visibility}</dd></div>
              <div><dt>Requested</dt><dd>{when(publication.created_at)}</dd></div>
            </dl>
            <p className="subtle">{vocabulary?.provider_boundary}</p>
          </div>

          {preview && (
            <div className="p10-row" role="region" aria-label="What would go out">
              <h3>What would go out</h3>
              <p className="subtle">Capability: {preview.capability}
                {preview.missing_scopes.length > 0 ? ` · missing scopes: ${preview.missing_scopes.join(', ')}` : ''}</p>
              {preview.blocked_by.length > 0
                ? <ul className="p10-blockers" aria-label="Reasons this cannot be submitted">
                  {preview.blocked_by.map(reason => <li key={reason} className="p10-warn">{reason}</li>)}
                </ul>
                : <p className="subtle">Nothing blocks a submission right now.</p>}
              {Object.keys(preview.provider_constraints).length > 0 && (
                <p className="subtle">Destination constraints: {JSON.stringify(preview.provider_constraints)}</p>
              )}
              <p className="subtle">Content fingerprint: {preview.content.fingerprint}</p>
            </div>
          )}

          <div className="p10-row" role="region" aria-label="Publication metadata">
            <label className="p10-field">
              <span>Title</span>
              <input aria-label="Publication title" value={title} maxLength={300}
                onChange={event => setTitle(event.target.value)} />
            </label>
            <label className="p10-field">
              <span>Caption</span>
              <textarea aria-label="Publication caption" value={caption} maxLength={5000}
                onChange={event => setCaption(event.target.value)} />
            </label>
            <label className="p10-field">
              <span>Reason recorded with your decisions</span>
              <input aria-label="Decision note" value={note} maxLength={800}
                onChange={event => setNote(event.target.value)} />
            </label>
            {canManage && (
              <div className="p10-actions">
                <button type="button" disabled={busy} onClick={() => void run(() => publishingService.update(
                  workspaceId, publication.id, { title, caption, destination: publication.destination,
                    config: publication.destination_config, visibility: publication.visibility,
                    scheduled_for: publication.scheduled_for }))}>
                  Save metadata
                </button>
                <button type="button" disabled={busy} onClick={() => void run(() =>
                  publishingService.setState(workspaceId, publication.id, { desired: 'ready', note }))}>
                  Mark ready to publish
                </button>
              </div>
            )}
          </div>

          <div className="p10-row" role="region" aria-label="Publishing authorization">
            <h3>Publishing authorization</h3>
            {status?.authorizations.length
              ? <ul className="p10-list">
                {status.authorizations.map(entry => (
                  <li key={entry.id}>
                    {entry.decision === 'authorize' ? 'Authorized' : 'Withdrawn'} by {entry.actor_user_id ?? '—'} at {when(entry.authorized_at)} ·
                    Production revision {entry.production_revision}, Result revision {entry.result_revision},
                    media {entry.media_checksum} → {entry.destination_provider} {entry.destination}
                    {entry.note ? ` · ${entry.note}` : ''}
                  </li>
                ))}
              </ul>
              : <p className="subtle">Nothing is authorized to publish yet.</p>}
            <p className="subtle">A creative approval of the Result is a different decision: it is not
              publishing authorization, and this authorization names this exact version and destination.</p>
            {canManage && (
              <div className="p10-actions">
                <button type="button" disabled={busy} onClick={() => void run(() =>
                  publishingService.authorize(workspaceId, publication.id, { decision: 'authorize', note }))}>
                  <ShieldCheck size={14} aria-hidden /> Authorize publishing this exact version
                </button>
                <button type="button" disabled={busy} onClick={() => void run(() =>
                  publishingService.authorize(workspaceId, publication.id, { decision: 'withdraw', note }))}>
                  <Undo2 size={14} aria-hidden /> Withdraw authorization
                </button>
              </div>
            )}
          </div>

          <div className="p10-row" role="region" aria-label="Submission and destination result">
            <h3>Submission</h3>
            <p className="subtle">Attempts: {publication.submission_attempts} · last attempt {when(publication.last_attempt_at)}
              {' · '}retry safety: {status?.retry_safety ?? '—'}</p>
            {status?.attempts.length
              ? <ul className="p10-list">
                {status.attempts.map(attempt => (
                  <li key={attempt.id}>
                    Attempt {attempt.attempt_number}: {attempt.state}
                    {attempt.remote_resource_id ? ` · remote ${attempt.remote_resource_id}` : ''}
                    {attempt.failure_category ? ` · ${attempt.failure_category}` : ''}
                    {attempt.failure_message ? ` — ${attempt.failure_message}` : ''}
                    {' · '}{when(attempt.finished_at ?? attempt.started_at)}
                  </li>
                ))}
              </ul>
              : <p className="subtle">No submission has been attempted.</p>}
            {published && (
              <p className="p10-ok" role="status">
                <BadgeCheck size={15} aria-hidden /> Published: the destination confirmed this publication
                {publication.remote_resource_id ? ` as ${publication.remote_resource_id}` : ''} at {when(publication.published_at)}.
                {publication.remote_url && <> <a href={publication.remote_url} target="_blank" rel="noreferrer">
                  Open at the destination <ExternalLink size={13} aria-hidden /></a></>}
              </p>
            )}
            {publication.state === 'unknown_remote_state' && (
              <p className="p10-error" role="alert">{vocabulary?.unknown_state_law}</p>
            )}
            {publication.state === 'failed' && (
              <p className="p10-error" role="alert">
                Failed: {publication.failure_category
                  ? (vocabulary?.failure_categories[publication.failure_category] ?? publication.failure_category)
                  : 'cause not established'}
                {publication.failure_code ? ` (${publication.failure_code})` : ''}
                {publication.failure_message ? ` — ${publication.failure_message}` : ''}
              </p>
            )}
            {canManage && (
              <div className="p10-actions">
                <button type="button" disabled={busy || publication.state !== 'ready'}
                  onClick={() => void run(() => publishingService.submit(workspaceId, publication.id))}>
                  <Send size={14} aria-hidden /> Submit to the destination
                </button>
                <button type="button" disabled={busy}
                  onClick={() => void run(() => publishingService.refresh(workspaceId, publication.id))}>
                  <RefreshCw size={14} aria-hidden /> Read the destination state
                </button>
              </div>
            )}
          </div>

          <div className="p10-row" role="region" aria-label="Reconciliation">
            <h3>Destination state the creator observed</h3>
            <p className="subtle">{vocabulary?.unknown_state_law}</p>
            {status?.reconciliations.length
              ? <ul className="p10-list">
                {status.reconciliations.map(entry => (
                  <li key={entry.id}>
                    {entry.observed_state} · source {entry.source}
                    {entry.remote_resource_id ? ` · remote ${entry.remote_resource_id}` : ''} · {when(entry.observed_at)}
                    {entry.note ? ` · ${entry.note}` : ''}
                  </li>
                ))}
              </ul>
              : <p className="subtle">No reconciliation has been recorded.</p>}
            {canManage && (
              <div className="p10-actions">
                <label className="p10-field">
                  <span>Observed state</span>
                  <select aria-label="Observed destination state" value={observed}
                    onChange={event => setObserved(event.target.value)}>
                    <option value="published">Published at the destination</option>
                    <option value="processing">Still processing</option>
                    <option value="removed">Removed from the destination</option>
                    <option value="failed">Failed at the destination</option>
                    <option value="unknown_remote_state">Still unknown</option>
                  </select>
                </label>
                <label className="p10-field">
                  <span>Remote resource the destination shows</span>
                  <input aria-label="Observed remote resource" value={observedResource} maxLength={300}
                    onChange={event => setObservedResource(event.target.value)} />
                </label>
                <button type="button" disabled={busy} onClick={() => void run(() =>
                  publishingService.reconcile(workspaceId, publication.id, { observed, note,
                    remote_resource_id: observedResource || null }))}>
                  Record what the destination shows
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
