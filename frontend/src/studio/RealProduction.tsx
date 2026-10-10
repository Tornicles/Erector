import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Camera, ChevronDown, ChevronRight, Lightbulb, ShieldAlert, Smartphone, Users } from 'lucide-react';
import {
  productionService, type DirectorStudio, type RealAlternative, type RealConstraint, type RealDeviation,
  type RealCaptureStatus, type RealPlan, type RealReadiness, type RealRequirement, type RealShotDetail,
  type RealShotSummary, type RealSurface, type RealTakeStatus, type StudioApproval, type StudioReadModel,
  type StudioTiming,
} from '../services/productions';
import { safeError } from '../services/errors';
import { ErrorState, LoadingState, PartialState } from '../components/StateComponents';
import { approvalLabel, formatMs } from './StudioTimeline';

// Real Production answers one question per Shot: how do I actually shoot this with
// what I have? Exposure values arrive from the plan already labelled as starting
// points, and this surface never upgrades them into measurements.

export const READINESS_LABEL: Record<RealReadiness, string> = {
  unplanned: 'Not planned',
  ready: 'Ready',
  ready_with_substitution: 'Ready with substitution',
  needs_decision: 'Needs decision',
  missing_resource: 'Missing resource',
  safety_blocked: 'Safety blocked',
};

const READINESS_CLASS: Record<RealReadiness, string> = {
  unplanned: 'readiness-unplanned',
  ready: 'readiness-ready',
  ready_with_substitution: 'readiness-substitute',
  needs_decision: 'readiness-decision',
  missing_resource: 'readiness-missing',
  safety_blocked: 'readiness-safety',
};

const CONSTRAINT_CHOICES: Array<{ value: RealConstraint; label: string }> = [
  { value: 'use_only_owned', label: 'Use only what I own' },
  { value: 'solo', label: 'I am shooting alone' },
  { value: 'one_light', label: 'I only have one light' },
  { value: 'no_gimbal', label: "I can't use a gimbal" },
  { value: 'available_light_only', label: 'Available light only' },
  { value: 'simplify', label: 'Make this easier' },
  { value: 'faster', label: 'I need this faster' },
  { value: 'safer', label: 'Make this safer' },
  { value: 'phone_only', label: 'Use only my phone' },
  { value: 'reduced_time', label: "I'm short on time" },
];

/** Shot completion vocabulary (§83): captured is never the same claim as approved. */
const CAPTURE_CHOICES: Array<{ value: RealCaptureStatus; label: string }> = [
  { value: 'not_started', label: 'Not started' },
  { value: 'setup', label: 'Setting up' },
  { value: 'shooting', label: 'Shooting' },
  { value: 'captured', label: 'Captured' },
  { value: 'pickup_needed', label: 'Needs a pickup' },
];

/** Exposure values are claims, and the UI has to say which kind. */
export function ExposureRow({ label, value, claim }: { label: string; value: string; claim: string }) {
  if (!value) return null;
  return (
    <div className="exposure-row">
      <dt>{label}</dt>
      <dd>{value}<span className="claim">{claim}</span></dd>
    </div>
  );
}

export function ReadinessBadge({ readiness }: { readiness: RealReadiness }) {
  return <span className={`readiness ${READINESS_CLASS[readiness]}`}>{READINESS_LABEL[readiness]}</span>;
}

function Disclosure({ title, children, defaultOpen = false, count }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean; count?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="real-section">
      <h4>
        <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {title}{typeof count === 'number' ? ` (${count})` : ''}
        </button>
      </h4>
      {open && <div className="real-body">{children}</div>}
    </section>
  );
}

function RequirementTable({ requirements }: { requirements: RealRequirement[] }) {
  if (!requirements.length) return <p className="subtle">This plan needs nothing beyond the camera itself.</p>;
  return <table className="real-table">
    <caption className="sr-only">Setup matching for this Shot</caption>
    <thead><tr><th scope="col">Need</th><th scope="col">State</th><th scope="col">Claim</th><th scope="col">Detail</th></tr></thead>
    <tbody>{requirements.map((item, index) => <tr key={item.id ?? `${item.kind}-${index}`}>
      <td><strong>{item.label}</strong>{item.ideal_name && <span className="subtle"> · wants {item.ideal_name}</span>}</td>
      <td><span className={`requirement requirement-${item.status}`}>{item.status.replaceAll('_', ' ')}</span>
        {item.resource_name && <span className="subtle"> {item.resource_name}</span>}
        {item.substitute_name && <span className="subtle"> using {item.substitute_name}</span>}</td>
      <td><span className="claim">{item.epistemic}</span></td>
      <td>{item.detail}{item.alternative && <span className="subtle"> {item.alternative}</span>}</td>
    </tr>)}</tbody>
  </table>;
}

function AlternativeList({ alternatives }: { alternatives: RealAlternative[] }) {
  if (!alternatives.length) return <p className="subtle">No alternative routes were needed for this Shot.</p>;
  return <ul className="real-alternatives">{alternatives.map((option, index) => <li key={option.id ?? index}>
    <p><strong>{option.label}</strong> · <span className="claim">{option.kind.replaceAll('_', ' ')}</span></p>
    <p>{option.description}</p>
    {option.expected_impact && <p className="subtle">{option.expected_impact}</p>}
    {option.tradeoffs.length > 0 && <p className="subtle">Costs: {option.tradeoffs.join('; ')}</p>}
  </li>)}</ul>;
}

function PlanSections({ plan }: { plan: RealPlan }) {
  return <>
    <Disclosure title="Shot intent" defaultOpen>
      <p><strong>{plan.shot_size || 'Framing not set'}</strong>{plan.editorial_intent && ` · ${plan.editorial_intent} coverage`}</p>
      {plan.framing && <p>{plan.framing}</p>}
      {plan.composition && <p>{plan.composition}</p>}
    </Disclosure>
    <Disclosure title="Camera" defaultOpen>
      <p>{plan.camera_position}</p>
      {plan.camera_height && <p className="subtle">Height: {plan.camera_height}</p>}
      {plan.camera_angle && <p className="subtle">Angle: {plan.camera_angle}</p>}
    </Disclosure>
    <Disclosure title="Lens and perspective" defaultOpen>
      <p>{plan.perspective_note || 'Perspective follows camera position, not focal length alone.'}</p>
    </Disclosure>
    <Disclosure title="Movement" defaultOpen>
      <p><strong>{plan.movement || 'locked'}</strong> · {plan.stabilization}</p>
      {plan.movement_purpose && <p className="subtle">{plan.movement_purpose}</p>}
    </Disclosure>
    <Disclosure title="Exposure starting point" defaultOpen>
      <dl className="exposure-table">
        <ExposureRow label="Capture rate" value={plan.capture_fps} claim="STARTING POINT" />
        <ExposureRow label="Delivery" value={plan.delivery_fps} claim="REQUIRED" />
        <ExposureRow label="Shutter" value={plan.shutter} claim="STARTING POINT" />
        <ExposureRow label="Aperture" value={plan.aperture} claim="STARTING POINT" />
        <ExposureRow label="ISO" value={plan.iso_range} claim="STARTING POINT" />
        <ExposureRow label="White balance" value={plan.white_balance} claim="RECOMMENDED" />
        <ExposureRow label="ND / filter" value={plan.nd_filter} claim="RECOMMENDED" />
      </dl>
      <p className="truthfulness">{plan.exposure_note}</p>
    </Disclosure>
    <Disclosure title="Focus" defaultOpen>
      <p>{plan.focus_strategy}</p>
      {plan.depth_of_field && <p className="subtle">{plan.depth_of_field}</p>}
    </Disclosure>
    <Disclosure title="Lighting" count={plan.lighting_diagram && Object.keys(plan.lighting_diagram).length ? 1 : 0}>
      <p><strong>{plan.lighting_intent}</strong></p>
      <p>{plan.lighting_plan}</p>
      {Boolean(plan.lighting_diagram && Object.keys(plan.lighting_diagram).length) &&
        <p className="subtle">Diagram: {JSON.stringify(plan.lighting_diagram)}</p>}
    </Disclosure>
    <Disclosure title="Blocking">
      <p>{plan.blocking}</p>
    </Disclosure>
    <Disclosure title="Performance">
      <p>{plan.performance}</p>
    </Disclosure>
    {plan.product_direction && <Disclosure title="Product direction"><p>{plan.product_direction}</p></Disclosure>}
    <Disclosure title="Sound">
      <p>{plan.sound_plan}</p>
      {plan.microphone_plan && <p className="subtle">{plan.microphone_plan}</p>}
      {plan.sync_strategy && <p className="subtle">Sync: {plan.sync_strategy}</p>}
    </Disclosure>
    <Disclosure title="Crew and solo feasibility">
      <p><strong>{plan.solo_feasibility ? plan.solo_feasibility.replaceAll('_', ' ') : 'not judged'}</strong>
        {plan.crew_roles.length > 0 && ` · ${plan.crew_roles.join(', ')}`}</p>
    </Disclosure>
    <Disclosure title="Setup check" count={plan.setup_steps.length}>
      <ol className="real-steps">{plan.setup_steps.map(step => <li key={step}>{step}</li>)}</ol>
    </Disclosure>
    <Disclosure title="Location and environment">
      {plan.environment_requirements.length > 0 && <ul className="directive-list">
        {plan.environment_requirements.map(item => <li key={item}>Environment: {item}</li>)}</ul>}
      {plan.location_requirements.length > 0 && <ul className="directive-list">
        {plan.location_requirements.map(item => <li key={item}>Location: {item}</li>)}</ul>}
    </Disclosure>
    <Disclosure title="Safety" defaultOpen={plan.safety_flags.length > 0} count={plan.safety_notes.length}>
      {plan.safety_flags.length > 0 && <p className="safety-flags">{plan.safety_flags.map(flag =>
        <span key={flag} className="safety-flag">{flag.replaceAll('-', ' ')}</span>)}</p>}
      {plan.safety_notes.length > 0
        ? <ul className="directive-list">{plan.safety_notes.map(note => <li key={note}>{note}</li>)}</ul>
        : <p className="subtle">No specific safety concern was identified from this Shot and Setup.</p>}
      <p className="subtle">Planning guidance only. It is not a substitute for licensed specialists, stunt
        coordinators, qualified drone operators, electricians or venue authorities.</p>
    </Disclosure>
    <Disclosure title="Capture checklist" count={plan.capture_checklist.length}>
      <ul className="real-checklist">{plan.capture_checklist.map(item => <li key={item}>{item}</li>)}</ul>
    </Disclosure>
  </>;
}

export function RealProductionCanvas({ workspaceId, productionId, model, timing, surface, busy,
  selectedShotId = null, onSelectShot, onChanged }: {
  workspaceId: string; productionId: string; model: StudioReadModel; timing: StudioTiming;
  surface: DirectorStudio | null; busy: boolean; selectedShotId?: string | null;
  onSelectShot: (sceneId: string | null, shotId: string) => void; onChanged: () => void;
}) {
  const [data, setData] = useState<RealSurface | null>(null);
  const [detail, setDetail] = useState<RealShotDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [directing, setDirecting] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [constraints, setConstraints] = useState<RealConstraint[]>([]);
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    let active = true; setError(null);
    productionService.realSurface(workspaceId, productionId)
      .then(result => { if (active) setData(result); })
      .catch(failure => { if (active) setError(safeError(failure).message); });
    return () => { active = false; };
  }, [workspaceId, productionId, attempt]);

  // Reloading a Shot keeps the last result message, so the Director's answer stays
  // readable after the plan it describes is re-read.
  const openShot = useCallback(async (shotId: string) => {
    setWorking(true); setError(null);
    try { setDetail(await productionService.realShotDetail(workspaceId, productionId, shotId)); }
    catch (failure) { setError(safeError(failure).message); setDetail(null); }
    finally { setWorking(false); }
  }, [workspaceId, productionId]);

  // A Shot chosen anywhere else in Studio opens its practical plan here (§64).
  useEffect(() => {
    if (selectedShotId && selectedShotId !== detail?.shot.shot_id) void openShot(selectedShotId);
  }, [selectedShotId, detail, openShot]);

  const direct = async (shotId: string, apply: boolean) => {
    setWorking(true); setError(null); setNotice(null);
    try {
      const result = await productionService.directRealShot(workspaceId, productionId, shotId,
        { text, constraints, apply, expected_shot_revision: detail?.shot.revision ?? null });
      setNotice(`${result.answer.summary} ${apply ? 'Applied to this Production.' : 'Preview only — nothing is written yet.'}`);
      await openShot(shotId);
      if (apply) { load(); onChanged(); }
    } catch (failure) { setError(safeError(failure).message); }
    finally { setWorking(false); }
  };

  const directScene = async (sceneId: string, apply: boolean) => {
    setWorking(true); setError(null); setNotice(null);
    try {
      const result = await productionService.directRealScene(workspaceId, productionId, sceneId,
        { text, constraints, apply });
      setNotice(`${result.summary.directed} Shot(s) planned for this Scene, ${result.summary.skipped} skipped.
        ${apply ? 'Applied to this Production.' : 'Preview only — nothing is written yet.'}`
        + (result.skipped.length ? ` Skipped: ${result.skipped.map(item => item.reason).join('; ')}.` : ''));
      if (detail?.scene?.scene_id === sceneId) await openShot(detail.shot.shot_id);
      if (apply) { load(); onChanged(); }
    } catch (failure) { setError(safeError(failure).message); }
    finally { setWorking(false); }
  };

  // Production scope is planned Scene by Scene rather than in one blocking request (§70).
  const directProduction = async () => {
    setWorking(true); setError(null); setNotice(null);
    let directed = 0; let skipped = 0;
    try {
      for (const scene of data?.scenes ?? []) {
        setNotice(`Planning Scene ${scene.order}: ${directed} Shot(s) done, ${skipped} skipped…`);
        const result = await productionService.directRealScene(workspaceId, productionId, scene.scene_id,
          { text, constraints, apply: true });
        directed += result.summary.directed; skipped += result.summary.skipped;
      }
      setNotice(`Planned ${directed} Shot(s) across the Production; ${skipped} skipped (locked or absent).`);
      load(); onChanged();
    } catch (failure) { setError(safeError(failure).message); }
    finally { setWorking(false); }
  };

  const saveEdited = async (plan: RealPlan) => {
    if (!detail) return;
    setWorking(true); setError(null); setNotice(null);
    try {
      const result = await productionService.saveRealPlan(workspaceId, productionId, detail.shot.shot_id,
        { plan, requirements: detail.requirements, alternatives: detail.alternatives,
          expected_shot_revision: detail.shot.revision });
      // A material edit to an approved plan must not look approved any more (§98).
      const approvalNote = result.approval === 'changed_after_approval'
        ? ` ${approvalLabel(result.approval)} — this plan no longer matches what was approved.` : '';
      setNotice(`Plan saved as revision ${result.plan_revision}. Readiness: ${READINESS_LABEL[result.readiness]}.${approvalNote}`);
      await openShot(detail.shot.shot_id);
      load(); onChanged();
    } catch (failure) { setError(safeError(failure).message); }
    finally { setWorking(false); }
  };

  const setApproval = async (approval: StudioApproval) => {
    if (!detail) return;
    setWorking(true); setError(null);
    try {
      const result = await productionService.setRealPlanApproval(workspaceId, productionId,
        detail.shot.shot_id, approval, detail.shot.revision);
      setNotice(`Plan is ${approvalLabel(result.approval)}.`);
      await openShot(detail.shot.shot_id); load();
    } catch (failure) { setError(safeError(failure).message); }
    finally { setWorking(false); }
  };

  const setLock = async (locked: boolean) => {
    if (!detail) return;
    setWorking(true); setError(null);
    try {
      const result = await productionService.setRealPlanLock(workspaceId, productionId,
        detail.shot.shot_id, locked, detail.shot.revision);
      setNotice(result.locked ? 'Plan locked. The Director cannot rewrite it until you unlock it.'
        : 'Plan unlocked.');
      await openShot(detail.shot.shot_id); load();
    } catch (failure) { setError(safeError(failure).message); }
    finally { setWorking(false); }
  };

  const setCapture = async (status: RealCaptureStatus) => {
    if (!detail) return;
    setWorking(true); setError(null); setNotice(null);
    try {
      const result = await productionService.setShotCaptureState(workspaceId, productionId,
        detail.shot.shot_id, status, detail.capture?.notes ?? '', detail.capture?.revision ?? null);
      setNotice(status === 'captured'
        ? 'Marked captured. Captured is not approved — approve the plan or review the Take in Studio.'
        : `Shot is ${result.status.replaceAll('_', ' ')}.`);
      await openShot(detail.shot.shot_id); load();
    } catch (failure) { setError(safeError(failure).message); }
    finally { setWorking(false); }
  };

  const logTake = async (status: RealTakeStatus, notes: string) => {
    if (!detail) return;
    setWorking(true); setError(null); setNotice(null);
    try {
      const next = (detail.takes.at(-1)?.take_number ?? 0) + 1;
      await productionService.saveShotTake(workspaceId, productionId, detail.shot.shot_id,
        { take_number: next, status, notes });
      setNotice(`Take ${next} logged as ${status.replaceAll('_', ' ')}.`);
      await openShot(detail.shot.shot_id); load();
    } catch (failure) { setError(safeError(failure).message); }
    finally { setWorking(false); }
  };

  const preferTake = async (takeNumber: number) => {
    if (!detail) return;
    setWorking(true); setError(null);
    try {
      await productionService.saveShotTake(workspaceId, productionId, detail.shot.shot_id,
        { take_number: takeNumber, status: 'preferred' });
      setNotice(`Take ${takeNumber} is preferred.`);
      await openShot(detail.shot.shot_id); load();
    } catch (failure) { setError(safeError(failure).message); }
    finally { setWorking(false); }
  };

  const recordDeviation = async (deviation: { field: RealDeviation['field']; planned_value: string; actual_value: string; reason: string }) => {
    if (!detail) return;
    setWorking(true); setError(null);
    try {
      await productionService.recordShotDeviation(workspaceId, productionId, detail.shot.shot_id, deviation);
      setNotice('Deviation recorded. The original plan is unchanged.');
      await openShot(detail.shot.shot_id); load();
    } catch (failure) { setError(safeError(failure).message); }
    finally { setWorking(false); }
  };

  if (error && !data) return <ErrorState message={error} retry={load} />;
  if (!data) return <LoadingState label="Reading your Setup against this Production…" />;
  const shots = data.shots;
  const queue = data.readiness_queue;

  return <div className="intel-panel real-canvas" role="region" aria-label="Real Production">
    <header className="intel-heading">
      <div><p className="eyebrow">REAL PRODUCTION · SETUP-AWARE</p><h3>{data.production.title}</h3></div>
      <span className="pill">{data.summary.shots} Shot(s) · {data.summary.planned} planned</span>
      <div className="intel-actions">
        <button type="button" disabled={working || busy || data.summary.shots === 0}
          onClick={() => void directProduction()}>Plan every Shot</button>
        <Link className="text-link" to={`/on-set/${data.production.id}`}>
          <Smartphone size={13} /> On-Set Mode
        </Link>
      </div>
    </header>
    <p className="subtle">{data.summary.captured} of {data.summary.shots} Shots captured
      {data.summary.pickup_needed > 0 && ` · ${data.summary.pickup_needed} need a pickup`}
      {data.summary.safety_blocked > 0 && ` · ${data.summary.safety_blocked} blocked for safety`}.
      {data.capabilities.note}</p>
    {error && <p role="alert" className="error-text">{error}</p>}
    {notice && <p role="status" className="subtle">{notice}</p>}

    <section className="real-queue" aria-label="Readiness queue">
      <h4>Readiness queue</h4>
      <ul>
        <li><strong>Ready to shoot</strong><span>{queue.ready_to_shoot.length}</span></li>
        <li><strong>Needs decision</strong><span>{queue.needs_decision.length}</span></li>
        <li><strong>Missing resource</strong><span>{queue.missing_resource.length}</span></li>
        <li><strong>Pickup required</strong><span>{queue.pickup_required.length}</span></li>
      </ul>
      <p className="subtle">Explicit requirement facts, not a readiness score.</p>
    </section>

    <Disclosure title="Setup being matched" count={data.setup.length}>
      {data.setup.length === 0
        ? <PartialState title="Setup is empty">Add the equipment you actually own in Setup. Until then every
            recommendation is marked unverified rather than assumed.</PartialState>
        : <ul className="real-setup">{data.setup.map(item => <li key={item.id}>
            <strong>{item.name}</strong> · {item.resource_type.replaceAll('_', ' ')}
            {item.model && ` · ${item.model}`}
          </li>)}</ul>}
    </Disclosure>

    <section aria-label="Shot plans">
      <h4>Shots</h4>
      {shots.length === 0
        ? <PartialState title="No Shots yet">Create Shots in the Scenes and Shots tools, then ask the Director
            how to shoot each one.</PartialState>
        : <ul className="real-shot-cards">{shots.map(shot => <li key={shot.shot_id}>
            <RealShotCard shot={shot} setup={data.setup} onOpen={() => {
              setNotice(null); onSelectShot(shot.scene_id, shot.shot_id); void openShot(shot.shot_id); }} />
          </li>)}</ul>}
    </section>

    {detail && <section className="real-detail" aria-label={`Real plan for ${detail.shot.title}`}>
      <header className="intel-heading">
        <div><p className="eyebrow">{detail.scene ? `SCENE ${detail.scene.order} · ` : ''}REAL EXECUTION PLAN</p>
          <h3>{detail.shot.title}</h3></div>
        <ReadinessBadge readiness={detail.readiness} />
      </header>
      <p className="subtle">{formatMs(detail.shot.planned_duration_ms)} planned · {approvalLabel(detail.shot.approval)}
        {detail.shot.locked && ' · Shot locked'}</p>

      <div className="real-direct" role="group" aria-label="Direct this Shot">
        <label htmlFor="real-direction">Tell the Director what you actually have</label>
        <textarea id="real-direction" rows={3} value={text} onChange={event => setText(event.target.value)}
          placeholder="How do I shoot this? I am shooting alone and I only have one light." />
        <div className="real-constraints" role="group" aria-label="Practical constraints">
          {CONSTRAINT_CHOICES.map(choice => <button type="button" key={choice.value}
            aria-pressed={constraints.includes(choice.value)}
            className={constraints.includes(choice.value) ? 'selected' : ''}
            onClick={() => setConstraints(current => current.includes(choice.value)
              ? current.filter(value => value !== choice.value) : [...current, choice.value])}>{choice.label}</button>)}
        </div>
        <div className="intel-actions">
          <button type="button" disabled={working || busy} onClick={() => void direct(detail.shot.shot_id, false)}>
            <Lightbulb size={14} />{working ? 'Directing…' : 'Preview how to shoot this'}</button>
          <button type="button" className="primary" disabled={working || busy || detail.shot.locked}
            onClick={() => void direct(detail.shot.shot_id, true)}>Apply to this Shot</button>
          {detail.scene && <button type="button" disabled={working || busy}
            onClick={() => void directScene(detail.scene!.scene_id, false)}>Preview this whole Scene</button>}
          {detail.scene && <button type="button" disabled={working || busy}
            onClick={() => void directScene(detail.scene!.scene_id, true)}>Apply to every Shot in this Scene</button>}
        </div>
      </div>

      {detail.plan
        ? <>
          <div className="real-plan-actions">
            <span className="pill">{approvalLabel(detail.plan.approval ?? detail.shot.approval)}</span>
            <button type="button" disabled={working || detail.shot.locked}
              onClick={() => void setApproval('approved')}>Approve plan</button>
            <button type="button" disabled={working || detail.shot.locked}
              onClick={() => void setApproval('needs_review')}>Needs review</button>
            <button type="button" disabled={working}
              onClick={() => void setLock(!(detail.plan?.locked ?? false))}>
              {detail.plan.locked ? 'Unlock plan' : 'Lock plan'}</button>
          </div>
          {detail.plan.readiness_note && <p className="readiness-note" role="status">{detail.plan.readiness_note}</p>}
          <PlanSections plan={detail.plan} />
          <Disclosure title="Setup check — what you own for this Shot" defaultOpen count={detail.requirements.length}>
            <RequirementTable requirements={detail.requirements} />
          </Disclosure>
          <Disclosure title="Alternatives" count={detail.alternatives.length}>
            <AlternativeList alternatives={detail.alternatives} />
          </Disclosure>
          <Disclosure title="Edit this plan by hand">
            <PlanEditor plan={detail.plan} busy={working} onSave={saveEdited} />
          </Disclosure>
        </>
        : <PartialState title="No Real plan yet" action={<button type="button" disabled={working || detail.shot.locked}
            onClick={() => void direct(detail.shot.shot_id, true)}>Direct this Shot</button>}>
            This Shot has no execution plan. TONDE will build one from the Shot and the Setup you own.</PartialState>}

      <section className="real-capture" aria-label="Capture status">
        <h4>Did you get it?</h4>
        <div className="real-constraints" role="group" aria-label="Shot capture status">
          {CAPTURE_CHOICES.map(choice => <button type="button" key={choice.value} disabled={working}
            aria-pressed={detail.capture?.status === choice.value}
            className={detail.capture?.status === choice.value ? 'selected' : ''}
            onClick={() => void setCapture(choice.value)}>{choice.label}</button>)}
        </div>
        <p className="subtle">Captured means recorded, not approved. Approval stays with the plan.</p>
      </section>

      <Disclosure title="Takes" count={detail.takes.length}>
        <ul className="real-takes">{detail.takes.map(take => <li key={take.take_id ?? take.id ?? take.take_number}>
          <strong>Take {take.take_number}</strong> · {take.status.replaceAll('_', ' ')}
          {take.preferred && ' · preferred'}
          {take.notes && <span className="subtle"> · {take.notes}</span>}
          {!take.preferred && <button type="button" className="text-link" disabled={working}
            onClick={() => void preferTake(take.take_number)}>Prefer this take</button>}
        </li>)}</ul>
        {detail.takes.length === 0 && <p className="subtle">No Takes logged for this Shot yet.</p>}
        <form className="real-deviation" onSubmit={event => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void logTake(String(form.get('status') ?? 'recorded') as RealTakeStatus,
            String(form.get('notes') ?? ''));
          event.currentTarget.reset();
        }}>
          <label htmlFor="take-status">Log a Take</label>
          <select id="take-status" name="status" defaultValue="recorded">
            {['recorded', 'review', 'good', 'unusable', 'pickup_required'].map(status =>
              <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}
          </select>
          <input name="notes" placeholder="What happened on this Take" aria-label="Take note" />
          <button type="submit" disabled={working}>Log take</button>
        </form>
      </Disclosure>

      <Disclosure title="Field deviations" count={detail.deviations.length}>
        {detail.deviations.length === 0
          ? <p className="subtle">Nothing has deviated from the plan yet.</p>
          : <ul className="directive-list">{detail.deviations.map(item => <li key={item.id ?? item.field}>
              <strong>{item.field.replaceAll('_', ' ')}</strong>: planned “{item.planned_value || '—'}”,
              actually “{item.actual_value || '—'}”{item.reason && ` — ${item.reason}`}</li>)}</ul>}
        <form className="real-deviation" onSubmit={event => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void recordDeviation({ field: String(form.get('field')) as RealDeviation['field'],
            planned_value: String(form.get('planned') ?? ''), actual_value: String(form.get('actual') ?? ''),
            reason: String(form.get('reason') ?? '') });
        }}>
          <label htmlFor="deviation-field">Record what actually happened</label>
          <select id="deviation-field" name="field" defaultValue="movement">
            {['camera', 'lens', 'movement', 'stabilization', 'camera_position', 'lighting', 'sound', 'location',
              'performance', 'product', 'duration', 'other'].map(field =>
              <option key={field} value={field}>{field.replaceAll('_', ' ')}</option>)}
          </select>
          <input name="planned" placeholder="Planned" aria-label="Planned value" />
          <input name="actual" placeholder="Actually" aria-label="Actual value" />
          <input name="reason" placeholder="Why" aria-label="Reason" />
          <button type="submit" disabled={working}>Record deviation</button>
        </form>
        <p className="subtle">Recording a deviation never rewrites the plan.</p>
      </Disclosure>
    </section>}
  </div>;
}

export function RealShotCard({ shot, setup, onOpen }: { shot: RealShotSummary; setup: RealSurface['setup']; onOpen: () => void }) {
  const camera = setup.find(item => item.id === shot.camera_resource_id);
  const lens = setup.find(item => item.id === shot.lens_resource_id);
  return <article className="real-shot-card">
    <header>
      <p className="eyebrow">SCENE {shot.scene_order} · SHOT {shot.order}</p>
      <h4>{shot.title}</h4>
      <ReadinessBadge readiness={shot.readiness} />
    </header>
    <dl className="real-card-facts">
      <div><dt>Duration</dt><dd>{formatMs(shot.planned_duration_ms)}</dd></div>
      <div><dt>Framing</dt><dd>{shot.framing || 'not set'}</dd></div>
      <div><dt>Movement</dt><dd>{shot.movement || 'locked'}</dd></div>
      <div><dt>Camera</dt><dd>{camera ? camera.name : 'not chosen yet'}</dd></div>
      <div><dt>Lens</dt><dd>{lens ? lens.name : 'not chosen yet'}</dd></div>
      <div><dt>Light</dt><dd>{shot.lighting_intent || 'not planned yet'}</dd></div>
      <div><dt>Sound</dt><dd>{shot.sound_plan ? 'planned' : 'not planned yet'}</dd></div>
      <div><dt>Solo</dt><dd>{shot.solo_feasibility ? shot.solo_feasibility.replaceAll('_', ' ') : 'not judged'}</dd></div>
      <div><dt>Capture</dt><dd>{shot.capture ? shot.capture.status.replaceAll('_', ' ') : 'not started'}</dd></div>
      <div><dt>Takes</dt><dd>{shot.takes.count}</dd></div>
    </dl>
    {shot.requirements.missing > 0 && <p className="readiness-note">
      <AlertTriangle size={13} /> {shot.requirements.missing} requirement(s) missing from Setup.</p>}
    {shot.safety_flags.length > 0 && <p className="readiness-note">
      <ShieldAlert size={13} /> {shot.safety_flags.join(', ').replaceAll('-', ' ')}</p>}
    {shot.crew_roles.length > 0 && <p className="subtle"><Users size={12} /> {shot.crew_roles.join(', ')}</p>}
    <button type="button" className="text-link" onClick={onOpen}>
      <Camera size={13} /> Open the Real plan
    </button>
  </article>;
}

/** Manual Real plan editing (§72): the creator can always overrule the Director. */
function PlanEditor({ plan, busy, onSave }: { plan: RealPlan; busy: boolean; onSave: (plan: RealPlan) => void }) {
  const [draft, setDraft] = useState<RealPlan>(plan);
  useEffect(() => { setDraft(plan); }, [plan]);
  const field = (label: string, key: keyof RealPlan) => <label>{label}
    <textarea rows={2} value={String(draft[key] ?? '')}
      onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))} /></label>;
  return <form onSubmit={event => { event.preventDefault(); onSave({ ...draft, generated_by: 'creator' }); }}>
    <div className="intel-grid">
      {field('Camera position', 'camera_position')}
      {field('Movement', 'movement')}
      {field('Exposure note', 'exposure_note')}
      {field('Focus strategy', 'focus_strategy')}
      {field('Lighting intent', 'lighting_intent')}
      {field('Lighting plan', 'lighting_plan')}
      {field('Blocking', 'blocking')}
      {field('Performance', 'performance')}
      {field('Sound plan', 'sound_plan')}
    </div>
    <p className="subtle">Editing writes your wording as the plan, marked as creator-authored.</p>
    <button type="submit" className="primary" disabled={busy}>Save my version</button>
  </form>;
}
