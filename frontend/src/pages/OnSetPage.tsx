import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, Camera, Check, ChevronLeft, ChevronRight, ClipboardList, RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  productionService, type RealCaptureStatus, type RealConstraint, type RealShotDetail, type RealSurface,
  type RealTakeStatus,
} from '../services/productions';
import { safeError } from '../services/errors';
import { ErrorState, LoadingState, PartialState } from '../components/StateComponents';
import { READINESS_LABEL, ReadinessBadge } from '../studio/RealProduction';
import { formatMs } from '../studio/StudioTimeline';

// On-Set Mode is the field half of Real Production: what Shot is next, how to set it
// up, and did I get it. It is deliberately small enough to use on a phone.
const CAPTURE_CHOICES: Array<{ value: RealCaptureStatus; label: string }> = [
  { value: 'setup', label: 'Setting up' },
  { value: 'shooting', label: 'Shooting' },
  { value: 'captured', label: 'Captured' },
  { value: 'pickup_needed', label: 'Needs a pickup' },
];

const FIELD_PROBLEMS: Array<{ value: RealConstraint; label: string }> = [
  { value: 'lost_location', label: 'We lost the location' },
  { value: 'available_light_only', label: 'My light died' },
  { value: 'reduced_time', label: 'We have 20 minutes' },
  { value: 'safer', label: 'Make this safer' },
  { value: 'simplify', label: 'Make this easier' },
  { value: 'solo', label: 'Everyone else left, I am alone' },
];

export function OnSetPage() {
  const { productionId } = useParams();
  const { workspaceId } = useAuth();
  const [surface, setSurface] = useState<RealSurface | null>(null);
  const [detail, setDetail] = useState<RealShotDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [takeNotes, setTakeNotes] = useState('');
  const [fieldText, setFieldText] = useState('');
  const [fieldConstraints, setFieldConstraints] = useState<RealConstraint[]>([]);

  const load = useCallback(async () => {
    if (!workspaceId || !productionId) return;
    setError(null);
    try { setSurface(await productionService.realSurface(workspaceId, productionId)); }
    catch (failure) { setSurface(null); setError(safeError(failure).message); }
  }, [workspaceId, productionId]);
  useEffect(() => { void load(); }, [load, attempt]);

  const shots = surface?.shots ?? [];
  const ordered = useMemo(() => shots.map(shot => shot.shot_id), [shots]);
  const currentIndex = detail ? ordered.indexOf(detail.shot.shot_id) : -1;

  const open = useCallback(async (shotId: string) => {
    if (!workspaceId || !productionId) return;
    setBusy(true); setError(null);
    try { setDetail(await productionService.realShotDetail(workspaceId, productionId, shotId)); }
    catch (failure) { setError(safeError(failure).message); }
    finally { setBusy(false); }
  }, [workspaceId, productionId]);

  const step = (offset: number) => {
    if (currentIndex < 0) return;
    const target = ordered[currentIndex + offset];
    if (target) void open(target);
  };

  const setCapture = async (status: RealCaptureStatus) => {
    if (!workspaceId || !productionId || !detail) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await productionService.setShotCaptureState(workspaceId, productionId,
        detail.shot.shot_id, status, detail.capture?.notes ?? '', detail.capture?.revision ?? null);
      setNotice(status === 'captured'
        ? 'Marked captured. Captured is not approved — review the Take before it is final.'
        : `Shot is ${result.status.replaceAll('_', ' ')}.`);
      await open(detail.shot.shot_id); await load();
    } catch (failure) { setError(safeError(failure).message); }
    finally { setBusy(false); }
  };

  const logTake = async (status: RealTakeStatus) => {
    if (!workspaceId || !productionId || !detail) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const next = (detail.takes.at(-1)?.take_number ?? 0) + 1;
      await productionService.saveShotTake(workspaceId, productionId, detail.shot.shot_id,
        { take_number: next, status, notes: takeNotes });
      setTakeNotes('');
      setNotice(`Take ${next} logged as ${status.replaceAll('_', ' ')}.`);
      await open(detail.shot.shot_id); await load();
    } catch (failure) { setError(safeError(failure).message); }
    finally { setBusy(false); }
  };

  const preferTake = async (takeNumber: number) => {
    if (!workspaceId || !productionId || !detail) return;
    setBusy(true); setError(null);
    try {
      await productionService.saveShotTake(workspaceId, productionId, detail.shot.shot_id,
        { take_number: takeNumber, status: 'preferred' });
      setNotice(`Take ${takeNumber} is preferred.`);
      await open(detail.shot.shot_id); await load();
    } catch (failure) { setError(safeError(failure).message); }
    finally { setBusy(false); }
  };

  const replan = async (button?: RealConstraint) => {
    if (!workspaceId || !productionId || !detail) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await productionService.directRealShot(workspaceId, productionId, detail.shot.shot_id,
        { text: fieldText, constraints: button ? [...fieldConstraints, button] : fieldConstraints,
          apply: false, expected_shot_revision: detail.shot.revision });
      setNotice(`Replan suggests: ${result.answer.summary} ${result.answer.readiness_note}`
        + (result.answer.missing.length ? ` Missing: ${result.answer.missing.join(', ')}.` : ''));
      setFieldText('');
    } catch (failure) { setError(safeError(failure).message); }
    finally { setBusy(false); }
  };

  if (error && !surface) return <ErrorState message={error} retry={() => setAttempt(value => value + 1)} />;
  if (!surface) return <LoadingState label="Opening On-Set Mode…" />;
  const captured = surface.summary.captured;

  return <div className="on-set" role="region" aria-label="On-Set Mode">
    <header className="on-set-header">
      <div>
        <p className="eyebrow">ON-SET MODE · REAL PRODUCTION</p>
        <h1>{surface.production.title}</h1>
        <p className="subtle" role="status">{captured} of {surface.summary.shots} Shots captured
          {surface.summary.pickup_needed > 0 && ` · ${surface.summary.pickup_needed} pickup(s)`}
          {surface.summary.safety_blocked > 0 && ` · ${surface.summary.safety_blocked} blocked for safety`}</p>
      </div>
      <nav aria-label="On-set navigation">
        <Link className="text-link" to={`/studio/${surface.production.id}?tool=Real Production`}>Full Studio</Link>
        <button type="button" onClick={() => setAttempt(value => value + 1)} aria-label="Refresh on-set data">
          <RefreshCw size={14} /> Refresh</button>
      </nav>
    </header>
    {error && <p role="alert" className="error-text">{error}</p>}
    {notice && <p role="status" className="on-set-note">{notice}</p>}

    {shots.length === 0
      ? <PartialState title="Nothing to shoot yet">This Production has no Shots. Build Scenes and Shots in Studio
          first.</PartialState>
      : <> 
        <section aria-label="Shot list" className="on-set-list">
          <h2>Shot list</h2>
          <ol>{shots.map(shot => <li key={shot.shot_id}>
            <button type="button" className={detail?.shot.shot_id === shot.shot_id ? 'selected' : ''}
              aria-pressed={detail?.shot.shot_id === shot.shot_id}
              aria-label={`Scene ${shot.scene_order} Shot ${shot.order}: ${shot.title}, ${shot.capture ? shot.capture.status.replaceAll('_', ' ') : 'not started'}, ${READINESS_LABEL[shot.readiness]}`}
              onClick={() => void open(shot.shot_id)}>
              <span className="on-set-order">{shot.scene_order}.{shot.order}</span>
              <span>{shot.title}</span>
              <span className="subtle">{formatMs(shot.planned_duration_ms)}</span>
              <span className="subtle">{shot.capture ? shot.capture.status.replaceAll('_', ' ') : 'not started'}</span>
            </button>
          </li>)}</ol>
        </section>

        {!detail
          ? <PartialState title="Pick the Shot you are standing in front of"
              action={<button type="button" className="primary" onClick={() => void open(ordered[0])}>
                Open the first Shot</button>}>
              On-Set Mode shows one Shot at a time: how to set it, and whether you got it.</PartialState>
          : <article className="on-set-shot" aria-label={`On-set card for ${detail.shot.title}`}>
            <header>
              <p className="eyebrow">{detail.scene ? `SCENE ${detail.scene.order} · ` : ''}SHOT {detail.shot.shot_id.slice(-4)}</p>
              <h2>{detail.shot.title}</h2>
              <ReadinessBadge readiness={detail.readiness} />
            </header>
            <div className="on-set-nav" role="group" aria-label="Move between Shots">
              <button type="button" disabled={currentIndex <= 0 || busy} onClick={() => step(-1)}>
                <ChevronLeft size={14} /> Previous</button>
              <span className="pill">{currentIndex + 1} of {ordered.length}</span>
              <button type="button" disabled={currentIndex < 0 || currentIndex >= ordered.length - 1 || busy}
                onClick={() => step(1)}>Next <ChevronRight size={14} /></button>
            </div>

            <dl className="on-set-facts">
              <div><dt>Framing</dt><dd>{detail.plan?.shot_size || detail.shot.framing || 'not planned'}</dd></div>
              <div><dt>Duration</dt><dd>{formatMs(detail.shot.planned_duration_ms)}</dd></div>
              <div><dt>Camera</dt><dd>{detail.setup.find(item => item.id === detail.plan?.camera_resource_id)?.name || 'not chosen'}</dd></div>
              <div><dt>Lens</dt><dd>{detail.setup.find(item => item.id === detail.plan?.lens_resource_id)?.name || 'not chosen'}</dd></div>
              <div><dt>Movement</dt><dd>{detail.plan?.movement || detail.shot.movement || 'locked'}</dd></div>
              <div><dt>Exposure</dt><dd>{detail.plan?.aperture || 'not planned'} <span className="claim">STARTING POINT</span></dd></div>
            </dl>

            {detail.plan
              ? <>
                <section className="on-set-block"><h3><Camera size={14} /> How to set it up</h3>
                  <p>{detail.plan.camera_position}</p>
                  {detail.plan.stabilization && <p className="subtle">{detail.plan.stabilization}</p>}
                  {detail.plan.focus_strategy && <p>{detail.plan.focus_strategy}</p>}
                </section>
                <section className="on-set-block"><h3>Lighting</h3>
                  <p><strong>{detail.plan.lighting_intent}</strong></p>
                  <p>{detail.plan.lighting_plan}</p>
                </section>
                <section className="on-set-block"><h3>Blocking and performance</h3>
                  <p>{detail.plan.blocking}</p>
                  <p>{detail.plan.performance}</p>
                </section>
                <section className="on-set-block"><h3>Sound</h3>
                  <p>{detail.plan.sound_plan}</p>
                  {detail.plan.sync_strategy && <p className="subtle">{detail.plan.sync_strategy}</p>}
                </section>
                {detail.plan.safety_notes.length > 0 && <section className="on-set-block on-set-safety">
                  <h3><AlertTriangle size={14} /> Safety</h3>
                  <ul className="directive-list">{detail.plan.safety_notes.map(note => <li key={note}>{note}</li>)}</ul>
                </section>}
                <section className="on-set-block"><h3><ClipboardList size={14} /> Checklist</h3>
                  <ul className="real-checklist">{detail.plan.capture_checklist.map(item => <li key={item}>{item}</li>)}</ul>
                </section>
                {detail.requirements.some(item => item.status !== 'owned' && item.status !== 'not_required') &&
                  <section className="on-set-block"><h3>Watch out for</h3>
                    <ul className="directive-list">{detail.requirements
                      .filter(item => item.status !== 'owned' && item.status !== 'not_required')
                      .map(item => <li key={item.id ?? item.label}>{item.label}: {item.status.replaceAll('_', ' ')}
                        {item.alternative && ` — ${item.alternative}`}</li>)}</ul>
                  </section>}
              </>
              : <PartialState title="No plan for this Shot yet" action={
                  <Link className="text-link" to={`/studio/${surface.production.id}?tool=Real Production&shot=${detail.shot.shot_id}`}>
                    Direct this Shot in Studio</Link>}>
                  This Shot has no Real execution plan, so On-Set Mode will not invent one.</PartialState>}

            <section className="on-set-block" aria-label="Shot status">
              <h3>Did I get it?</h3>
              <div className="on-set-actions" role="group">
                {CAPTURE_CHOICES.map(choice => <button type="button" key={choice.value} disabled={busy}
                  aria-pressed={detail.capture?.status === choice.value}
                  className={detail.capture?.status === choice.value ? 'selected' : ''}
                  onClick={() => void setCapture(choice.value)}>{choice.label}</button>)}
              </div>
              <p className="subtle">Captured means recorded, not approved. Approval stays in Studio.</p>
            </section>

            <section className="on-set-block" aria-label="Take log">
              <h3>Takes</h3>
              <ul className="real-takes">{detail.takes.map(take => <li key={take.id ?? take.take_number}>
                <strong>Take {take.take_number}</strong> · {take.status.replaceAll('_', ' ')}
                {take.preferred && ' · preferred'}
                {take.notes && <span className="subtle"> · {take.notes}</span>}
                {!take.preferred && <button type="button" className="text-link" disabled={busy}
                  onClick={() => void preferTake(take.take_number)}>Prefer this take</button>}
              </li>)}</ul>
              {detail.takes.length === 0 && <p className="subtle">No Takes logged yet.</p>}
              <label htmlFor="take-notes">Take note</label>
              <input id="take-notes" value={takeNotes} onChange={event => setTakeNotes(event.target.value)}
                placeholder="e.g. good, but the light flickered" />
              <div className="on-set-actions" role="group">
                <button type="button" className="primary" disabled={busy}
                  onClick={() => void logTake('recorded')}><Check size={14} /> Log take</button>
                <button type="button" disabled={busy} onClick={() => void logTake('good')}>Log as good</button>
                <button type="button" disabled={busy} onClick={() => void logTake('pickup_required')}>Log as pickup</button>
              </div>
            </section>

            <section className="on-set-block" aria-label="Field changes">
              <h3>Something changed</h3>
              <label htmlFor="field-change">Tell TONDE what changed on set</label>
              <textarea id="field-change" rows={2} value={fieldText}
                onChange={event => setFieldText(event.target.value)}
                placeholder="It started raining and we lost the window." />
              <div className="on-set-actions" role="group" aria-label="Quick problems">
                {FIELD_PROBLEMS.map(problem => <button type="button" key={problem.value} disabled={busy}
                  onClick={() => void replan(problem.value)}>{problem.label}</button>)}
              </div>
              <button type="button" disabled={busy} onClick={() => void replan()}>Ask for a practical replan</button>
              <p className="subtle">This proposes a change. Your approved Production is not rewritten on set.</p>
            </section>

            {detail.deviations.length > 0 && <section className="on-set-block" aria-label="Recorded deviations">
              <h3>Deviations recorded</h3>
              <ul className="directive-list">{detail.deviations.map(item => <li key={item.id ?? item.field}>
                <strong>{item.field.replaceAll('_', ' ')}</strong>: planned “{item.planned_value || '—'}”,
                actually “{item.actual_value || '—'}”</li>)}</ul>
            </section>}
          </article>}
      </>}
  </div>;
}
