import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, ClipboardCopy, Sparkles, Upload } from 'lucide-react';
import {
  productionService, type AiAttempt, type AiBatchPreview, type AiConnection, type AiDirectionResult,
  type AiHybridDecision, type AiLock, type AiModelOption, type AiReadiness, type AiReference, type AiShotDetail,
  type AiShotSummary, type AiSurface, type StudioApproval, type StudioReadModel,
} from '../services/productions';
import { safeError } from '../services/errors';
import { ErrorState, LoadingState, PartialState } from '../components/StateComponents';
import { executionMethodLabel } from '../types/domain';
import { approvalLabel, formatMs } from './StudioTimeline';

// AI Creation answers one question per Shot: what exactly must be generated, with which
// model, references, continuity and constraints? Capability, price and connection are
// three separate facts here, and this surface never upgrades one into another. When no
// provider is connected TONDE still compiles the prompt and hands it over to run by hand.

export const AI_READINESS_LABEL: Record<AiReadiness, string> = {
  unplanned: 'Not planned',
  stale: 'Prompt stale',
  needs_reference: 'Needs reference',
  needs_model: 'Needs model',
  needs_decision: 'Needs decision',
  unsupported: 'Unsupported by this model',
  provider_not_connected: 'Provider not connected',
  cost_confirmation: 'Cost confirmation',
  ready_to_generate: 'Ready to generate',
  manual_export: 'Manual export',
};

const AI_READINESS_CLASS: Record<AiReadiness, string> = {
  unplanned: 'readiness-unplanned',
  stale: 'readiness-decision',
  needs_reference: 'readiness-decision',
  needs_model: 'readiness-missing',
  needs_decision: 'readiness-decision',
  unsupported: 'readiness-safety',
  provider_not_connected: 'readiness-missing',
  cost_confirmation: 'readiness-substitute',
  ready_to_generate: 'readiness-ready',
  manual_export: 'readiness-substitute',
};

const CAPABILITY_LABEL: Record<string, string> = {
  SUPPORTED: 'Supported', 'PARTIALLY SUPPORTED': 'Partially supported', UNSUPPORTED: 'Unsupported',
  UNKNOWN: 'Unknown', 'REQUIRES CONNECTION': 'Requires connection',
};

export function AiReadinessBadge({ readiness }: { readiness: AiReadiness }) {
  return <span className={`readiness ${AI_READINESS_CLASS[readiness] ?? 'readiness-unplanned'}`}>
    {AI_READINESS_LABEL[readiness] ?? readiness.replaceAll('_', ' ')}</span>;
}

/** Unknown cost is shown as unknown. TONDE never prints a price it was not given. */
export function CostLine({ state, amount, currency, note }: {
  state: string; amount: number | null; currency: string; note?: string;
}) {
  if (state === 'known' && amount !== null) {
    return <p className="cost-line"><strong>Estimated cost</strong> {amount} {currency}
      <span className="claim">declared pricing</span>{note && <span className="subtle"> {note}</span>}</p>;
  }
  return <p className="cost-line"><strong>COST UNKNOWN</strong>
    <span className="subtle"> No verified pricing metadata was declared for this model, so TONDE shows no number.</span></p>;
}

/** A capability the selected model cannot use is stated, never rendered as a working control. */
function FrameLine({ label, frame, supported, capability }: {
  label: string; frame: Record<string, unknown>; supported: boolean; capability: string;
}) {
  const source = String(frame?.source ?? '');
  if (!source) return <p className="subtle">{label}: not set.</p>;
  return <p>{label}: <strong>{source.replaceAll('_', ' ')}</strong>
    {supported
      ? <span className="claim"> model-declared support</span>
      : <span className="readiness readiness-safety"> {label} is not supported by this model ({capability}) — recorded, not sent</span>}
  </p>;
}

function Disclosure({ title, children, defaultOpen = false, count }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean; count?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return <section className="real-section">
    <h4><button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      {title}{typeof count === 'number' ? ` (${count})` : ''}</button></h4>
    {open && <div className="real-body">{children}</div>}
  </section>;
}

function ReferenceList({ references }: { references: AiReference[] }) {
  if (!references.length) return <p className="subtle">No references are attached to this plan yet.</p>;
  return <ul className="reference-list">{references.map(reference => <li key={reference.reference_id} className="reference-card">
    <p><strong>{reference.role.replaceAll('_', ' ')} reference</strong> · {reference.priority}
      {reference.asset_name ? ` · ${reference.asset_name}` : ''}{reference.asset_type ? ` (${reference.asset_type.replaceAll('_', ' ')})` : ''}</p>
    {reference.note && <p className="subtle">{reference.note}</p>}
  </li>)}</ul>;
}

function LockList({ locks }: { locks: AiLock[] }) {
  if (!locks.length) return <p className="subtle">Nothing is locked yet, so every Shot is free to change.</p>;
  return <ul className="directive-list">{locks.map(lock => <li key={lock.lock_id}>
    <strong>{lock.scope}</strong> · {lock.label || 'unnamed'} · {lock.priority}
    {lock.locked ? ' · locked' : ' · unlocked'}
    {lock.locked_traits.length > 0 && <span className="subtle"> · holds: {lock.locked_traits.join(', ')}</span>}
    {lock.allowed_variations.length > 0 && <span className="subtle"> · may vary: {lock.allowed_variations.join(', ')}</span>}
    {lock.prohibited_changes.length > 0 && <span className="subtle"> · never: {lock.prohibited_changes.join(', ')}</span>}
    {lock.consent_note && <span className="subtle"> · {lock.consent_note}</span>}
  </li>)}</ul>;
}

function AttemptList({ attempts, onSelect, onMark, busy }: {
  attempts: AiAttempt[]; onSelect: (attemptId: string) => void;
  onMark: (attemptId: string, input: Record<string, unknown>) => void; busy: boolean;
}) {
  if (!attempts.length) return <p className="subtle">No Attempts recorded for this Shot yet.</p>;
  return <>
    <ul className="real-takes">{attempts.map(attempt => <li key={attempt.attempt_id}>
    <p><strong>Attempt {attempt.attempt_number}</strong> · {attempt.status.replaceAll('_', ' ')}
      {attempt.selected && <span className="claim"> selected result</span>}
      {attempt.mode === 'manual' && <span className="claim"> manual</span>}</p>
    <p className="subtle">{attempt.provider_key} · {attempt.model_key || 'model not set'}
      {attempt.prompt_version !== null ? ` · prompt v${attempt.prompt_version}` : ''}
      {attempt.seed !== null ? ` · seed ${attempt.seed}` : ''}
      {attempt.external_job_id ? ` · job ${attempt.external_job_id}` : ''}</p>
    {attempt.failure_code && <p className="readiness-note"><AlertTriangle size={13} /> {attempt.failure_code}
      {attempt.retryable === true && ' · retryable'} — {attempt.failure_message}</p>}
    {attempt.cost_state === 'known' && attempt.cost_amount !== null &&
      <p className="subtle">Cost {attempt.cost_amount} {attempt.cost_currency}</p>}
    {!attempt.selected && attempt.status === 'succeeded' && <button type="button" className="text-link" disabled={busy}
      onClick={() => onSelect(attempt.attempt_id)}>Select this result</button>}
    {attempt.status !== 'succeeded' && attempt.status !== 'cancelled' && <button type="button" className="text-link"
      disabled={busy} onClick={() => onMark(attempt.attempt_id, { status: 'cancelled' })}>Mark cancelled</button>}
    {attempt.failure_code && <button type="button" className="text-link" disabled={busy}
      onClick={() => onMark(attempt.attempt_id, { status: 'submitted', failure_code: '', retryable: null })}>
      Retry this Attempt</button>}
  </li>)}</ul>
    {/* Manual export is not a dead end: what came back is reported here and becomes a Result. */}
    <form className="real-deviation" onSubmit={event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const status = String(form.get('status') ?? 'succeeded');
      const media = String(form.get('media') ?? '').trim();
      const failure = String(form.get('failure') ?? '').trim();
      onMark(String(form.get('attempt')), {
        status,
        output_media_id: media || null,
        failure_code: status === 'failed' ? (failure.split(':')[0] || 'provider_error') : '',
        failure_message: status === 'failed' ? failure : '',
      });
      event.currentTarget.reset();
    }}>
      <label htmlFor="attempt-report">Report what came back</label>
      <select id="attempt-report" name="attempt" defaultValue={attempts[attempts.length - 1]?.attempt_id}>
        {attempts.map(attempt => <option key={attempt.attempt_id} value={attempt.attempt_id}>Attempt {attempt.attempt_number}</option>)}
      </select>
      <select name="status" defaultValue="succeeded" aria-label="Attempt outcome">
        {['succeeded', 'partial', 'failed', 'cancelled'].map(status =>
          <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}
      </select>
      <input name="media" placeholder="Media id of the output" aria-label="Output media id" />
      <input name="failure" placeholder="Why it failed" aria-label="Failure reason" />
      <button type="submit" disabled={busy}>Save the result</button>
    </form>
  </>;
}

function HybridPanel({ decision }: { decision: AiHybridDecision }) {
  return <div className="hybrid-panel">
    <p className="eyebrow">EXECUTION METHOD · {executionMethodLabel(decision.method)}</p>
    <ul className="directive-list">{decision.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
    <dl className="real-card-facts">
      <div><dt>Shoot component</dt><dd>{decision.shoot_component || 'none'}</dd></div>
      <div><dt>Generate component</dt><dd>{decision.generate_component || 'none'}</dd></div>
      <div><dt>Combine</dt><dd>{decision.combine.join('; ') || 'not needed'}</dd></div>
      <div><dt>Match</dt><dd>{decision.matching.join('; ') || 'not needed'}</dd></div>
      <div><dt>Plate requirements</dt><dd>{decision.plate_requirements.join('; ') || 'none'}</dd></div>
    </dl>
    {decision.limitations.length > 0 && <p className="subtle">Limits: {decision.limitations.join(' ')}</p>}
    <p className="subtle">This is advice. You decide, and your choice is written to the same Shot.</p>
  </div>;
}

export function AiShotCard({ shot, onOpen }: { shot: AiShotSummary; onOpen: () => void }) {
  return <article className="real-shot-card">
    <header>
      <p className="eyebrow">SHOT {shot.order} · {executionMethodLabel(shot.execution_method)}</p>
      <h4>{shot.title}</h4>
      <AiReadinessBadge readiness={shot.readiness} />
    </header>
    <dl className="real-card-facts">
      <div><dt>Model</dt><dd>{shot.model_label ?? 'none chosen'}</dd></div>
      <div><dt>Capability</dt><dd>{shot.capability_state ? CAPABILITY_LABEL[shot.capability_state] ?? shot.capability_state : 'not declared'}</dd></div>
      <div><dt>Prompt</dt><dd>{shot.plan_id ? (shot.prompt_stale ? 'stale' : `v${shot.prompt_version ?? 1}`) : 'not compiled'}</dd></div>
      <div><dt>Duration</dt><dd>{formatMs(shot.expected_duration_ms ?? shot.planned_duration_ms)}</dd></div>
      <div><dt>Aspect</dt><dd>{shot.aspect_ratio || 'from the Production'}</dd></div>
      <div><dt>Cost</dt><dd>{shot.cost_state === 'known' && shot.cost_amount !== null ? `${shot.cost_amount} ${shot.cost_currency}` : 'unknown'}</dd></div>
      <div><dt>Approval</dt><dd>{approvalLabel(shot.approval)}</dd></div>
    </dl>
    {shot.locked && <p className="subtle">This Shot is locked.</p>}
    {shot.prompt_stale && <p className="readiness-note"><AlertTriangle size={13} /> The Shot changed after this
      prompt was compiled, so the prompt is stale.</p>}
    <button type="button" className="text-link" onClick={onOpen}>
      <Sparkles size={13} /> Open the AI plan</button>
  </article>;
}

export function AiCreationCanvas({ workspaceId, productionId, busy, selectedShotId, onSelectShot, onChanged }: {
  workspaceId: string; productionId: string; busy: boolean;
  selectedShotId: string | null; onSelectShot: (sceneId: string, shotId: string) => void; onChanged: () => void;
}) {
  const [data, setData] = useState<AiSurface | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [detail, setDetail] = useState<AiShotDetail | null>(null);
  const [direction, setDirection] = useState<AiDirectionResult | null>(null);
  const [preview, setPreview] = useState<AiBatchPreview | null>(null);
  const [text, setText] = useState('');

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await productionService.aiSurface(workspaceId, productionId));
    } catch (failure) { setData(null); setError(safeError(failure).message); }
  }, [workspaceId, productionId]);

  useEffect(() => { void load(); }, [load]);

  const openShot = useCallback(async (shotId: string) => {
    setWorking(true); setError(null);
    try { setDetail(await productionService.aiShotDetail(workspaceId, productionId, shotId)); }
    catch (failure) { setDetail(null); setError(safeError(failure).message); }
    finally { setWorking(false); }
  }, [workspaceId, productionId]);

  useEffect(() => {
    if (!selectedShotId) { setDetail(null); setDirection(null); return; }
    if (detail?.shot.shot_id === selectedShotId) return;
    void openShot(selectedShotId);
  }, [selectedShotId, detail, openShot]);

  const direct = async (shotId: string, apply: boolean) => {
    setWorking(true); setError(null); setNotice(null);
    try {
      const result = await productionService.directAiShot(workspaceId, productionId, shotId, {
        apply, text, expected_shot_revision: detail?.shot.revision ?? null,
        expected_plan_revision: detail?.plan?.revision ?? null,
        hybrid: { apply },
      });
      setDirection(result);
      setNotice(apply
        ? `The AI plan was saved for this Shot (${result.plan.plan_status}).`
        : 'The Director answered. Nothing was written to the Shot yet.');
      await openShot(shotId); void load(); onChanged();
    } catch (failure) { setError(safeError(failure).message); }
    finally { setWorking(false); }
  };

  const setPlanApproval = async (approval: StudioApproval) => {
    if (!detail?.plan?.plan_id) return;
    setWorking(true); setError(null); setNotice(null);
    try {
      await productionService.setAiPlanApproval(workspaceId, productionId, detail.shot.shot_id, approval,
        detail.plan.revision ?? null);
      setNotice(`The AI plan is ${approvalLabel(approval)}.`);
      await openShot(detail.shot.shot_id); void load();
    } catch (failure) { setError(safeError(failure).message); }
    finally { setWorking(false); }
  };

  const setPlanLock = async (locked: boolean) => {
    if (!detail?.plan?.plan_id) return;
    setWorking(true); setError(null); setNotice(null);
    try {
      await productionService.setAiPlanLock(workspaceId, productionId, detail.shot.shot_id, locked,
        detail.plan.revision ?? null);
      setNotice(locked ? 'The AI plan is locked.' : 'The AI plan is unlocked.');
      await openShot(detail.shot.shot_id); void load();
    } catch (failure) { setError(safeError(failure).message); }
    finally { setWorking(false); }
  };

  const confirmCost = async () => {
    if (!detail) return;
    setWorking(true); setError(null); setNotice(null);
    try {
      await productionService.confirmAiCost(workspaceId, productionId, detail.shot.shot_id,
        'Confirmed in the Studio AI face.');
      setNotice('Cost confirmed for this Shot.');
      await openShot(detail.shot.shot_id); void load();
    } catch (failure) { setError(safeError(failure).message); }
    finally { setWorking(false); }
  };

  const recordAttempt = async (mode: 'manual' | 'live') => {
    if (!detail) return;
    setWorking(true); setError(null); setNotice(null);
    try {
      const key = `${detail.shot.shot_id}:${detail.plan?.prompt_version ?? 0}:${mode}:${detail.attempts.length + 1}`;
      const result = await productionService.createAiAttempt(workspaceId, productionId, detail.shot.shot_id, {
        idempotency_key: key, operation: (detail.plan?.motion as { needed?: boolean } | undefined)?.needed
          ? 'image_to_video' : 'video',
        provider_key: detail.plan?.provider_target ?? 'manual', mode,
        model_profile_id: detail.plan?.model_profile_id ?? null, model_key: detail.plan?.model ?? '',
        prompt_version: detail.plan?.prompt_version ?? null,
        status: mode === 'manual' ? 'planned' : 'submitted',
        settings: { aspect_ratio: detail.plan?.aspect_ratio ?? '' },
      });
      setNotice(result.idempotent
        ? 'This submission already exists, so nothing was billed twice.'
        : mode === 'manual'
          ? 'Attempt recorded. Run the prompt yourself, then report what came back.'
          : 'Attempt recorded and submitted to the provider.');
      await openShot(detail.shot.shot_id); void load();
    } catch (failure) { setError(safeError(failure).message); }
    finally { setWorking(false); }
  };

  const markAttempt = async (attemptId: string, input: Record<string, unknown>) => {
    if (!detail) return;
    setWorking(true); setError(null); setNotice(null);
    try {
      await productionService.updateAiAttempt(workspaceId, productionId, detail.shot.shot_id, attemptId, input);
      setNotice('Attempt updated.');
      await openShot(detail.shot.shot_id); void load();
    } catch (failure) { setError(safeError(failure).message); }
    finally { setWorking(false); }
  };

  const selectResult = async (attemptId: string) => {
    if (!detail) return;
    setWorking(true); setError(null); setNotice(null);
    try {
      await productionService.selectAiResult(workspaceId, productionId, detail.shot.shot_id, attemptId);
      setNotice('Selected as the current output for this Shot. This is not a Shot approval.');
      await openShot(detail.shot.shot_id); void load();
    } catch (failure) { setError(safeError(failure).message); }
    finally { setWorking(false); }
  };

  const changeMethod = async (method: 'shoot' | 'generate' | 'hybrid') => {
    if (!detail) return;
    setWorking(true); setError(null); setNotice(null);
    try {
      const result = await productionService.aiHybridDecision(workspaceId, productionId, detail.shot.shot_id, {
        execution_method: method, expected_shot_revision: detail.shot.revision,
      });
      setNotice(`${result.note} ${result.truthfulness}`);
      await openShot(detail.shot.shot_id); void load(); onChanged();
    } catch (failure) { setError(safeError(failure).message); }
    finally { setWorking(false); }
  };

  const previewBatch = async () => {
    setWorking(true); setError(null); setNotice(null);
    try {
      setPreview(await productionService.aiBatchPreview(workspaceId, productionId, { scope: 'production' }));
      setNotice('Preview ready. Nothing has been submitted.');
    } catch (failure) { setError(safeError(failure).message); }
    finally { setWorking(false); }
  };

  const createBatch = async () => {
    setWorking(true); setError(null); setNotice(null);
    try {
      const result = await productionService.createAiBatch(workspaceId, productionId,
        { scope: 'production', confirmed: true });
      setNotice(`Batch ${result.batch_id} opened with ${result.items ?? 0} Shot(s). Successful Shots are kept even if some fail.`);
      setPreview(null); void load();
    } catch (failure) { setError(safeError(failure).message); }
    finally { setWorking(false); }
  };

  const copyPrompt = async () => {
    const prompt = detail?.plan?.provider_prompt ?? '';
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setNotice('Provider prompt copied. Run it in your own tool, then record the Attempt.');
    } catch { setNotice('Copy is unavailable in this browser. Select the prompt text and copy it manually.'); }
  };

  if (error && !data) return <ErrorState message={error} retry={() => void load()} />;
  if (!data) return <LoadingState label="Reading the models you declared for this Production…" />;

  const selected = data.shots.find(shot => shot.shot_id === selectedShotId) ?? null;
  const modelProfile = detail?.plan?.model_profile as Record<string, unknown> | null | undefined;
  const canGenerate = detail?.plan?.plan_status === 'ready' && detail.readiness === 'ready_to_generate'
    && data.capabilities.live_generation && !detail.shot.locked;
  const blockedReasons: string[] = [];
  if (detail && !data.capabilities.live_generation) blockedReasons.push('No provider is connected in this workspace.');
  if (detail && detail.plan?.plan_status !== 'ready') blockedReasons.push('This Shot has no ready AI plan yet.');
  if (detail && detail.readiness !== 'ready_to_generate' && detail.readiness !== 'manual_export') {
    blockedReasons.push(`Readiness is ${AI_READINESS_LABEL[detail.readiness] ?? detail.readiness}.`);
  }
  if (detail?.shot.locked) blockedReasons.push('This Shot is locked.');

  return <div className="intel-panel real-canvas" role="region" aria-label="AI Creation">
    <header className="intel-heading">
      <div><p className="eyebrow">AI CREATION · PROVIDER-NEUTRAL</p><h3>{data.production.title}</h3></div>
      <span className="pill">{data.summary.ai_or_hybrid} AI/Hybrid Shot(s) · {data.summary.planned} planned</span>
      <div className="intel-actions">
        <button type="button" disabled={working || busy} onClick={() => void previewBatch()}>Preview batch generation</button>
        <button type="button" disabled={working || busy} onClick={() => void load()}>Refresh</button>
      </div>
    </header>
    <p className="subtle">{data.summary.ready} ready · {data.summary.manual_export} manual export ·
      {` ${data.summary.blocked} blocked`} · {data.summary.stale} stale prompt(s) ·
      {` ${data.summary.connected_providers} connected provider(s), ${data.summary.declared_models} declared model(s).`}</p>
    <p className="capability-note" role="status">{data.truthfulness}</p>
    <p className="subtle">{data.capabilities.note} Live generation: {data.capabilities.live_generation ? 'available' : 'not available in this workspace'}.</p>
    {error && <p role="alert" className="error-text">{error}</p>}
    {notice && <p role="status" className="subtle">{notice}</p>}

    <section className="real-queue" aria-label="AI readiness queue">
      <h4>Readiness</h4>
      <ul>
        <li><strong>Ready to generate</strong><span>{data.summary.ready}</span></li>
        <li><strong>Manual export</strong><span>{data.summary.manual_export}</span></li>
        <li><strong>Blocked</strong><span>{data.summary.blocked}</span></li>
        <li><strong>Stale prompt</strong><span>{data.summary.stale}</span></li>
      </ul>
      <p className="subtle">Explicit readiness states, not a completion percentage.</p>
    </section>

    <Disclosure title="Providers and connections" count={data.connections.length}>
      {data.connections.length === 0
        ? <PartialState title="No providers known">TONDE holds no vendor capability facts of its own. Declare what your
            models can do before any Shot is routed to them.</PartialState>
        : <ul className="real-setup">{data.connections.map((connection: AiConnection) => <li key={connection.provider_key}>
            <strong>{connection.label}</strong> · {connection.state.replaceAll('_', ' ')}
            {connection.credential_reference && <span className="subtle"> · holds a reference, not a credential</span>}
            {connection.manual_export_supported && <span className="subtle"> · manual export available</span>}
          </li>)}</ul>}
    </Disclosure>

    <Disclosure title="Models you declared" count={data.models.length}>
      {data.models.length === 0
        ? <PartialState title="No models declared">Declare a model you actually have in Setup. Capability is never
            inferred from a model name, and an undeclared model is never recommended.</PartialState>
        : <table className="real-table">
          <caption className="sr-only">Declared model capability</caption>
          <thead><tr><th scope="col">Model</th><th scope="col">Capability</th><th scope="col">References</th>
            <th scope="col">Frames</th><th scope="col">Duration</th><th scope="col">Cost</th></tr></thead>
          <tbody>{data.models.map((row: AiModelOption) => <tr key={row.model_profile_id}>
            <td><strong>{row.label || row.model_key}</strong><span className="subtle"> · {row.provider_key} · {row.operation.replaceAll('_', ' ')}</span></td>
            <td>{CAPABILITY_LABEL[row.capability_state] ?? row.capability_state}</td>
            <td>{row.supports_image_reference ? 'accepted' : 'not declared'}</td>
            <td>{row.supports_first_frame ? 'first' : '—'}{row.supports_last_frame ? ' + last' : ''}</td>
            <td>{row.max_duration_ms === null ? 'not declared' : formatMs(row.max_duration_ms)}</td>
            <td>{row.cost_known && row.cost_amount !== null ? `${row.cost_amount} ${row.cost_currency}` : 'unknown'}</td>
          </tr>)}</tbody>
        </table>}
    </Disclosure>

    <Disclosure title="Continuity locks" count={data.locks.length}>
      <LockList locks={data.locks} />
    </Disclosure>

    {preview && <section className="batch-preview" aria-label="Batch generation preview">
      <h4>Batch preview</h4>
      <dl className="real-card-facts">
        <div><dt>Scope</dt><dd>{preview.scope}</dd></div>
        <div><dt>Shots</dt><dd>{preview.shots ?? data.summary.ai_or_hybrid}</dd></div>
        {typeof preview.ready === 'number' && <div><dt>Ready</dt><dd>{preview.ready}</dd></div>}
        <div><dt>Blocked</dt><dd>{preview.blocked ?? data.summary.blocked}</dd></div>
        <div><dt>Estimated cost</dt><dd>{preview.cost_state === 'known' && preview.estimated_cost !== null && preview.estimated_cost !== undefined
          ? `${preview.estimated_cost}` : 'COST UNKNOWN'}</dd></div>
      </dl>
      {(preview.blocked ?? 0) > 0 && <p className="readiness-note"><AlertTriangle size={13} /> Blocked Shots are
        skipped rather than forced.</p>}
      {preview.confirmation_required && <p className="subtle">This batch needs your confirmation because it may incur
        real external spend.</p>}
      <div className="intel-actions">
        <button type="button" className="primary" disabled={working || !preview.confirmation_required}
          onClick={() => void createBatch()}>Confirm and open the batch</button>
        <button type="button" disabled={working} onClick={() => setPreview(null)}>Cancel</button>
      </div>
    </section>}

    <section aria-label="AI Shot plans">
      <h4>Shots</h4>
      {data.shots.length === 0
        ? <PartialState title="No Shots yet">Create Scenes and Shots first, then ask TONDE how to generate them.</PartialState>
        : <ul className="real-shot-cards">{data.shots.map(shot => <li key={shot.shot_id}>
            <AiShotCard shot={shot} onOpen={() => { setNotice(null); onSelectShot(shot.scene_id ?? '', shot.shot_id); }} />
          </li>)}</ul>}
    </section>

    {selected && detail && detail.shot.shot_id === selected.shot_id && <section className="real-detail"
      aria-label={`AI plan for ${detail.shot.title}`}>
      <header className="intel-heading">
        <div><p className="eyebrow">{detail.scene ? `SCENE ${detail.scene.order} · ` : ''}AI EXECUTION PLAN</p>
          <h3>{detail.shot.title}</h3></div>
        <AiReadinessBadge readiness={detail.readiness} />
      </header>
      <p className="subtle">{formatMs(detail.shot.planned_duration_ms)} planned · {approvalLabel(detail.shot.approval)} ·
        {executionMethodLabel(detail.shot.execution_method)}
        {detail.shot.locked && ' · Shot locked'}</p>

      <div className="real-direct" role="group" aria-label="Direct this Shot">
        <label htmlFor="ai-direction">Tell the Director what you need</label>
        <textarea id="ai-direction" rows={3} value={text} onChange={event => setText(event.target.value)}
          placeholder="How do I generate this Shot? Make the motion simpler and keep the Character like the last Shot." />
        <div className="intel-actions">
          <button type="button" disabled={working || busy} onClick={() => void direct(detail.shot.shot_id, false)}>
            {working ? 'Working…' : 'Ask how to direct this'}</button>
          <button type="button" className="primary" disabled={working || busy || detail.shot.locked}
            onClick={() => void direct(detail.shot.shot_id, true)}>Save this AI plan</button>
        </div>
        <div className="intel-actions" role="group" aria-label="Execution method">
          {(['shoot', 'generate', 'hybrid'] as const).map(method => <button type="button" key={method}
            disabled={working || busy} aria-pressed={detail.shot.execution_method === method}
            className={detail.shot.execution_method === method ? 'selected' : ''}
            onClick={() => void changeMethod(method)}>
            {method === 'hybrid' ? 'SHOOT + AI' : method === 'generate' ? 'AI PLAYBOOK' : method.toUpperCase()}
            </button>)}
        </div>
      </div>

      {direction && <div className="command-preview" role="status">
        <p className="eyebrow">TONDE'S ANSWER</p>
        <p>{direction.answer.summary}</p>
        <p>{direction.answer.why}</p>
        {direction.answer.model && <p className="subtle">
          <strong>{direction.answer.model.label}</strong> · {direction.answer.model.reason}
          {' · '}{direction.answer.model.cost_state === 'known' && direction.answer.model.cost_amount !== null
            ? `${direction.answer.model.cost_amount} ${direction.answer.model.cost_currency}`
            : 'COST UNKNOWN'}</p>}
        <p className="subtle">Recommended execution method: {executionMethodLabel(direction.answer.method)}</p>
        <HybridPanel decision={direction.hybrid} />
        {direction.answer.limitations.length > 0 && <p className="subtle">Limitations: {direction.answer.limitations.join(' ')}</p>}
        <p className="subtle">{direction.answer.truthfulness}</p>
        {direction.answer.direction_applied.length > 0 && <p className="subtle">Honoured: {direction.answer.direction_applied.join('; ')}.</p>}
        {direction.answer.direction_note && <p className="subtle">{direction.answer.direction_note}</p>}
        {direction.routing.manual_export && <p className="subtle">Manual export: {direction.routing.manual_export.reason}</p>}
        {direction.routing.excluded.length > 0 && <details><summary>Models TONDE did not choose</summary>
          <ul className="directive-list">{direction.routing.excluded.map(item => <li key={item.model_profile_id}>
            <strong>{item.model_key}</strong> · {CAPABILITY_LABEL[item.state] ?? item.state} — {item.reasons.join(' ')}
          </li>)}</ul></details>}
      </div>}

      {detail.plan
        ? <>
          <div className="real-plan-actions">
            <span className="pill">{approvalLabel(detail.plan.approval ?? detail.shot.approval)}</span>
            <span className="pill">Prompt v{detail.plan.prompt_version ?? 1}</span>
            {detail.plan.prompt_stale && <span className="readiness readiness-decision">Stale</span>}
            <button type="button" disabled={working} onClick={() => void setPlanApproval('approved')}>Approve plan</button>
            <button type="button" disabled={working} onClick={() => void setPlanApproval('needs_review')}>Needs review</button>
            <button type="button" disabled={working} onClick={() => void setPlanLock(!(detail.plan?.locked ?? false))}>
              {detail.plan.locked ? 'Unlock plan' : 'Lock plan'}</button>
            <button type="button" disabled={working} onClick={() => void confirmCost()}>Confirm cost</button>
          </div>
          <p className="readiness-note" role="status">{AI_READINESS_LABEL[detail.readiness] ?? detail.readiness}
            {detail.plan.readiness_note && ` — ${detail.plan.readiness_note}`}</p>
          {detail.plan.prompt_stale && <p className="readiness-note"><AlertTriangle size={13} /> The Shot changed after
            this prompt was compiled (shot revision {detail.plan.shot_revision} against prompt revision
            {' '}{detail.plan.source_shot_revision}). Ask the Director again to update it.</p>}

          {/* TONDE is the Director: copying the playbook prompt and running it in the creator's own tool is
              the primary action, and the Result comes back here. Running it inside TONDE is a secondary path
              that needs a connected provider account. */}
          <div className="generate-bar" role="group" aria-label="AI playbook actions">
            <button type="button" className="primary" disabled={working || busy || !detail.plan.provider_prompt}
              onClick={() => void copyPrompt()}>
              <ClipboardCopy size={14} /> Copy playbook prompt</button>
            <button type="button" disabled={working || busy || !canGenerate}
              aria-label="Run this Shot in a connected provider" onClick={() => void recordAttempt('live')}>
              <Sparkles size={14} /> Run in connected provider</button>
            <button type="button" disabled={working || busy} onClick={() => void recordAttempt('manual')}>
              <Upload size={14} /> Record Result from my tool</button>
          </div>
          {!canGenerate && <p className="subtle" role="status">Your playbook is ready to run in your own tool:
            {' '}copy the prompt into the tool you chose, then record the Result here. Running it inside TONDE
            needs a connected provider: {blockedReasons.join(' ')}</p>}

          <CostLine state={detail.plan.cost_state} amount={detail.plan.cost_amount}
            currency={detail.plan.cost_currency} note={detail.plan.cost_note} />

          <Disclosure title="Prompt" defaultOpen>
            <p className="subtle">Canonical TONDE prompt, then the provider-specific translation. Editing the provider
              prompt never overwrites the canonical record.</p>
            <dl className="prompt-sections">{Object.entries(detail.plan.canonical_prompt).map(([section, value]) => <div key={section}>
              <dt>{section}</dt><dd>{value}</dd></div>)}</dl>
            <label htmlFor="provider-prompt">Provider prompt</label>
            <textarea id="provider-prompt" rows={5} readOnly value={detail.plan.provider_prompt} />
            {detail.plan.provider_prompt_edited && <p className="subtle">You edited this provider prompt; TONDE keeps
              both versions.</p>}
          </Disclosure>

          <Disclosure title="Execution method" defaultOpen count={detail.plan.limitations.length}>
            <HybridPanel decision={{
              method: String((detail.plan.hybrid as { method?: string }).method ?? detail.shot.execution_method),
              reasons: (detail.plan.hybrid as { reasons?: string[] }).reasons ?? [],
              shoot_component: String((detail.plan.hybrid as { shoot_component?: string }).shoot_component ?? ''),
              generate_component: String((detail.plan.hybrid as { generate_component?: string }).generate_component ?? ''),
              combine: (detail.plan.hybrid as { combine?: string[] }).combine ?? [],
              matching: (detail.plan.hybrid as { matching?: string[] }).matching ?? [],
              limitations: detail.plan.limitations,
              plate_requirements: (detail.plan.hybrid as { plate_requirements?: string[] }).plate_requirements ?? [],
              factors: (detail.plan.hybrid as { factors?: Record<string, unknown> }).factors ?? {},
              advisory: true,
            }} />
          </Disclosure>

          <Disclosure title="Model and routing" defaultOpen>
            <p>{detail.plan.model_profile
              ? <><strong>{String((detail.plan.model_profile as { label?: string }).label ?? detail.plan.model)}</strong>
                {' · '}{String((detail.plan.model_profile as { provider_key?: string }).provider_key ?? detail.plan.provider)}
                {' · capability '}{CAPABILITY_LABEL[String((modelProfile?.capability_state as string) ?? 'UNKNOWN')] ?? 'Unknown'}</>
              : 'No model is selected for this Shot yet.'}</p>
            <p className="subtle">Chosen because: {(detail.plan.routing as { recommended?: { reason?: string } }).recommended?.reason
              ?? (detail.plan.routing as { reasoning?: string[] }).reasoning?.join(' ') ?? 'No model was recommended.'}</p>
            {detail.plan.fallback_model_profile_id && <p className="subtle">Fallback: {detail.plan.fallback_model_profile_id}</p>}
          </Disclosure>

          <Disclosure title="Frames and motion" count={1}>
            <FrameLine label="First frame" frame={detail.plan.first_frame}
              supported={Boolean(modelProfile?.supports_first_frame)} capability="first frame not declared" />
            <FrameLine label="Last frame" frame={detail.plan.last_frame}
              supported={Boolean(modelProfile?.supports_last_frame)} capability="last frame not declared" />
            <p>Motion: {String((detail.plan.motion as { description?: string }).description || 'none')}
              {Boolean((detail.plan.motion as { intensity?: string }).intensity) &&
                ` · intensity ${String((detail.plan.motion as { intensity?: string }).intensity)}`}</p>
            {(detail.plan.motion as { simplification?: string }).simplification &&
              <p className="subtle">{(detail.plan.motion as { simplification?: string }).simplification}</p>}
          </Disclosure>

          <Disclosure title="References" count={detail.references.length}>
            <ReferenceList references={detail.references} />
          </Disclosure>

          <Disclosure title="Continuity" defaultOpen>
            <dl className="real-card-facts">
              <div><dt>Must preserve</dt><dd>{((detail.plan.continuity as { must?: string[] }).must ?? []).join(', ') || 'nothing'}</dd></div>
              <div><dt>Should preserve</dt><dd>{((detail.plan.continuity as { should?: string[] }).should ?? []).join(', ') || 'nothing'}</dd></div>
              <div><dt>Flexible</dt><dd>{((detail.plan.continuity as { flexible?: string[] }).flexible ?? []).join(', ') || 'nothing'}</dd></div>
              <div><dt>Temporal state</dt><dd>{String((detail.plan.continuity as { temporal_state?: string }).temporal_state || 'not set')}</dd></div>
              <div><dt>Framing relationship</dt><dd>{String((detail.plan.continuity as { framing_relationship?: string }).framing_relationship || 'not set')}</dd></div>
            </dl>
            <LockList locks={detail.locks} />
          </Disclosure>

          <Disclosure title="Timing and audio">
            <p>Expected duration {formatMs(detail.plan.expected_duration_ms)} · aspect {detail.plan.aspect_ratio || 'from the Production'}</p>
            <p>Audio: {Boolean((detail.plan.audio as { needed?: boolean }).needed)
              ? ((detail.plan.audio as { narration?: { direction?: string } }).narration?.direction ?? 'planned')
              : 'none planned'}</p>
          </Disclosure>

          <Disclosure title="Negative constraints" count={detail.plan.negative_constraints.length}>
            {detail.plan.negative_constraints.length === 0
              ? <p className="subtle">No negative constraints recorded.</p>
              : <ul className="directive-list">{detail.plan.negative_constraints.map(item => <li key={item}>{item}</li>)}</ul>}
          </Disclosure>

          <Disclosure title="Limitations" count={detail.plan.limitations.length} defaultOpen>
            {detail.plan.limitations.length === 0
              ? <p className="subtle">No limitations were reported for this plan.</p>
              : <ul className="directive-list">{detail.plan.limitations.map(item => <li key={item}>{item}</li>)}</ul>}
          </Disclosure>

          <Disclosure title="Attempts" count={detail.attempts.length} defaultOpen>
            <AttemptList attempts={detail.attempts} busy={working} onSelect={attemptId => void selectResult(attemptId)}
              onMark={(attemptId, input) => void markAttempt(attemptId, input)} />
            {detail.selected_result && <p className="subtle">Selected result: Attempt {detail.selected_result.attempt_number}
              {' '}({detail.selected_result.status.replaceAll('_', ' ')}). Selected is not approved.</p>}
            {detail.batch_items.length > 0 && <p className="subtle">Batch history: {detail.batch_items
              .map(item => item.state).join(', ')}</p>}
          </Disclosure>
        </>
        : <PartialState title="No AI plan yet" action={<button type="button" disabled={working || detail.shot.locked}
            onClick={() => void direct(detail.shot.shot_id, true)}>Ask how to generate this</button>}>
            This Shot has no AI execution plan. TONDE will compile one from the Shot, the Scene and the locks you set.
          </PartialState>}
    </section>}
  </div>;
}
