import { useCallback, useEffect, useState } from 'react';
import { ClipboardCheck, Lock, Unlock } from 'lucide-react';
import { safeError } from '../services/errors';
import {
  productionReadinessService,
  type AccessState, type ReadinessReport, type ReadinessVocabulary,
} from '../services/productionReadiness';
import { LoadingState } from '../components/StateComponents';

/**
 * Readiness: is this approved, is it still the thing I approved, and what prevents us from moving
 * forward.
 *
 * Three deliberate separations. Approval is a creator decision about a SPECIFIC revision: the panel
 * shows the revision the approval named, the person who decided and the time, and reports newer
 * content as changed after approval rather than quietly still approved. Lock is independent of
 * approval: it protects a decision from incidental change, unlocking is explicit and records why,
 * and the screen never offers an approval that a creator did not make. And readiness is a category
 * derived from real state with blockers you can navigate to - it is never a score, and it never
 * claims to know whether an external provider is available.
 */

type Target = { id: string; label: string; kind: string };

const STATE_TONE: Record<string, string> = {
  ready: 'ok', ready_with_warnings: 'warn', needs_review: 'warn', blocked: 'bad', unknown: 'muted',
};

const SEVERITY_TONE: Record<string, string> = { blocking: 'bad', review: 'warn', warning: 'muted' };

const APPROVAL_LABEL: Record<string, string> = {
  draft: 'Draft', needs_review: 'Needs review', approved: 'Approved',
  changed_after_approval: 'Changed after approval',
};

function when(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export function ProductionReadinessCanvas({ workspaceId, productionId, targets, busy, onChanged, onOpen }: {
  workspaceId: string; productionId: string; targets: Target[]; busy: boolean;
  onChanged: () => void; onOpen?: (objectId: string, kind: string | null) => void;
}) {
  const [vocabulary, setVocabulary] = useState<ReadinessVocabulary | null>(null);
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [objectId, setObjectId] = useState('');
  const [state, setState] = useState<AccessState | null>(null);
  const [note, setNote] = useState('');
  const [working, setWorking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const refresh = useCallback(() => { setReloadKey(current => current + 1); onChanged(); }, [onChanged]);

  useEffect(() => {
    if (!objectId && targets.length > 0) setObjectId(targets[0].id);
  }, [targets, objectId]);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    Promise.all([
      productionReadinessService.vocabulary(workspaceId, productionId),
      productionReadinessService.readiness(workspaceId, productionId),
    ]).then(([loadedVocabulary, loadedReport]) => {
      if (!active) return;
      setVocabulary(loadedVocabulary); setReport(loadedReport);
    }).catch(failure => { if (active) setError(safeError(failure).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceId, productionId, reloadKey]);

  useEffect(() => {
    if (!objectId) { setState(null); return; }
    let active = true;
    productionReadinessService.state(workspaceId, productionId, objectId)
      .then(loaded => { if (active) setState(loaded); })
      .catch(failure => { if (active) setState(null); setNotice(safeError(failure).message); });
    return () => { active = false; };
  }, [workspaceId, productionId, objectId, reloadKey]);

  const selected = targets.find(target => target.id === objectId) ?? null;
  const decisionBlocked = working || busy || !objectId;

  async function decide(decision: 'approve' | 'request_review' | 'reopen') {
    if (decisionBlocked) return;
    setWorking(true); setError(null); setNotice(null);
    try {
      const result = await productionReadinessService.decide(workspaceId, productionId, objectId, {
        decision, expectedRevision: state?.current_revision ?? null, note,
      });
      setNotice(result.meaning);
      setNote('');
      refresh();
    } catch (failure) {
      setError(safeError(failure).message);
    } finally {
      setWorking(false);
    }
  }

  async function toggleLock(locked: boolean) {
    if (decisionBlocked) return;
    if (!locked && !note.trim()) { setError('Record why you are unlocking this object.'); return; }
    setWorking(true); setError(null); setNotice(null);
    try {
      const result = await productionReadinessService.setLock(workspaceId, productionId, objectId, {
        locked, expectedRevision: state?.current_revision ?? null, note,
      });
      setNotice(result.meaning);
      setNote('');
      refresh();
    } catch (failure) {
      setError(safeError(failure).message);
    } finally {
      setWorking(false);
    }
  }

  if (loading) return <LoadingState label="Checking what this production needs…" />;

  const disabled = decisionBlocked;
  const unlockBlocked = disabled || !note.trim();

  return (
    <section className="rd" aria-label="Production readiness and approval">
      {error && <p className="rd-alert" role="alert">{error}</p>}
      {notice && <p className="rd-note" role="status">{notice}</p>}

      <div className="rd-report" role="region" aria-label="Readiness summary">
        <header className="rd-head">
          <ClipboardCheck size={16} aria-hidden />
          <span className={`rd-badge rd-${STATE_TONE[report?.state ?? 'unknown'] ?? 'muted'}`}>
            {report?.state_label ?? 'Unknown'}
          </span>
          {report && <strong>{report.headline}</strong>}
        </header>
        {report && (
          <p className="rd-counts">
            {report.counts.blocking} blocking · {report.counts.review} needing review · {report.counts.warning} warnings
          </p>
        )}
        {report && report.dimensions.length > 0 && (
          <ul className="rd-dims" aria-label="Readiness dimensions">
            {report.dimensions.map(dimension => (
              <li key={dimension.dimension} className={`rd-dim rd-${STATE_TONE[dimension.state] ?? 'muted'}`}>
                <span className="rd-dim-label">{dimension.label ?? dimension.dimension}</span>
                <span className="rd-dim-state">{dimension.state_label ?? dimension.state}</span>
              </li>
            ))}
          </ul>
        )}
        {report && report.blockers.length > 0 && (
          <ul className="rd-blockers" aria-label="Readiness blockers">
            {report.blockers.map((blocker, index) => (
              <li key={`${blocker.code}-${blocker.affected_object_id ?? index}`}
                className={`rd-blocker rd-${SEVERITY_TONE[blocker.severity] ?? 'muted'}`}>
                <div className="rd-blocker-head">
                  <span className="rd-sev">{blocker.severity_label ?? blocker.severity}</span>
                  <span className="rd-dim-tag">{blocker.dimension_label ?? blocker.dimension}</span>
                  <strong>{blocker.problem}</strong>
                </div>
                <p className="rd-why">{blocker.why_it_matters}</p>
                <p className="rd-action">Next: {blocker.required_action}</p>
                {onOpen && blocker.affected_object_id && (
                  <button type="button" className="rd-open"
                    onClick={() => onOpen(blocker.affected_object_id as string, blocker.affected_kind)}>
                    Open {blocker.affected_label ?? 'affected object'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {report && <p className="rd-limit">{report.limitation ?? vocabulary?.limitation}</p>}
      </div>

      <div className="rd-approval" role="region" aria-label="Approval and lock for one object">
        <label className="rd-field">
          <span>Object</span>
          <select aria-label="Object to review" value={objectId} onChange={event => setObjectId(event.target.value)}>
            {targets.map(target => (
              <option key={target.id} value={target.id}>{target.label} ({target.kind})</option>
            ))}
          </select>
        </label>

        {!state && objectId && <p className="rd-muted">No approval record for this object yet.</p>}

        {state && (
          <>
            <dl className="rd-state" aria-label="Current approval and lock">
              <div><dt>Approval</dt><dd>{APPROVAL_LABEL[state.approval ?? 'draft'] ?? 'Draft'}</dd></div>
              <div><dt>Revision approved</dt><dd>{state.approved_revision ?? '—'}</dd></div>
              <div><dt>Current revision</dt><dd>{state.current_revision ?? '—'}</dd></div>
              <div><dt>Decided by</dt><dd>{state.approved_by ?? '—'}</dd></div>
              <div><dt>Decided at</dt><dd>{when(state.approved_at)}</dd></div>
              <div><dt>Lock</dt><dd>{state.locked ? 'Locked' : 'Unlocked'}</dd></div>
            </dl>
            {state.changed_line && <p className="rd-changed" role="status">{state.changed_line}</p>}
            {state.locked && state.lock_reason && <p className="rd-lock-reason">Locked because: {state.lock_reason}</p>}

            <label className="rd-field">
              <span>Reason (recorded with the decision)</span>
              <input aria-label="Decision reason" value={note} maxLength={800}
                onChange={event => setNote(event.target.value)}
                placeholder="Why are you approving, reopening, locking or unlocking this?" />
            </label>

            <div className="rd-actions">
              <button type="button" disabled={disabled} onClick={() => decide('approve')}>
                {state.current_revision ? `Approve revision ${state.current_revision}` : 'Approve'}
              </button>
              <button type="button" disabled={disabled} onClick={() => decide('request_review')}>Request review</button>
              <button type="button" disabled={disabled} onClick={() => decide('reopen')}>Reopen</button>
              {state.locked
                ? <button type="button" disabled={unlockBlocked} onClick={() => toggleLock(false)}>
                    <Unlock size={14} aria-hidden /> Unlock
                  </button>
                : <button type="button" disabled={disabled} onClick={() => toggleLock(true)}>
                    <Lock size={14} aria-hidden /> Lock
                  </button>}
            </div>
            <p className="rd-meaning">
              {state.locked
                ? 'Unlocking needs a reason: it is recorded and the object stays approved separately from its lock.'
                : 'Approving names this exact revision. A later change is reported, never treated as still approved.'}
            </p>

            {state.decisions.length > 0 && (
              <ol className="rd-history" aria-label="Decision history">
                {state.decisions.map((entry, index) => (
                  <li key={entry.id ?? `${entry.action}-${index}`}>
                    <span className="rd-h-action">{entry.action_label ?? entry.action}</span>
                    <span className="rd-h-time">{when(entry.created_at)}</span>
                    {entry.pinned_revision != null && <span className="rd-h-rev">revision {entry.pinned_revision}</span>}
                    {entry.note && <span className="rd-h-note">{entry.note}</span>}
                  </li>
                ))}
              </ol>
            )}
          </>
        )}

      </div>
      {selected && <span className="rd-hidden-label" aria-hidden>{selected.label}</span>}
    </section>
  );
}
