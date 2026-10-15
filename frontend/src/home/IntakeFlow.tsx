import { useCallback, useEffect, useMemo, useState } from 'react';
import type { IntakeAnalysisState, IntakeDecision } from '../services/productions';

/** Normalize the two server shapes: client payloads (`id`) and raw analysis
 *  entries (`decision_id`). Local (not via the mocked service module) so the
 *  component renders with production data and in mocked test environments. */
function normalizeIntakeDecision(raw: IntakeDecision | Record<string, unknown>): IntakeDecision {
  if ('id' in raw && typeof (raw as IntakeDecision).id === 'string') return raw as IntakeDecision;
  const item = raw as Record<string, unknown>;
  const options = Array.isArray(item.options) ? (item.options as IntakeDecision['options']) : [];
  const recommendation = (item.recommendation as IntakeDecision['recommendation']) ?? { option_ids: [], reason: '' };
  const state = (item.state as IntakeDecision['state']) ?? 'open';
  const impact = (item.impact as IntakeDecision['impact']) ?? 'high';
  return {
    id: String(item.decision_id ?? item.id ?? ''),
    topic: String(item.topic ?? ''),
    question: String(item.question ?? ''),
    why: String(item.why ?? ''),
    answer_mode: (item.answer_mode as IntakeDecision['answer_mode']) ?? 'single_select',
    options, recommendation, state, impact,
    answer: (item.answer as string | null) ?? null,
    answered_by: (item.answered_by as string | null) ?? null,
    allow_tonde_decides: true,
    blocking: impact === 'critical',
    answered: state !== 'open',
  };
}
function normalizeIntakeDecisions(raw: Array<IntakeDecision | Record<string, unknown>> | undefined): IntakeDecision[] {
  return (raw ?? []).map(normalizeIntakeDecision);
}

export interface BuildPhase {
  state: 'idle' | 'building' | 'ready' | 'failed';
  productionId: string | null;
  cardCount: number | null;
  error: string | null;
}

const SOURCE_MARK: Record<string, string> = {
  user_said: '✓',
  user_confirmed: '✓',
  reference_shows: '▣',
  script_establishes: '▤',
  tonde_inferred: '≈',
  tonde_recommended: '✦',
};

function FactChip({ label, value, source }: { label: string; value: string; source: string }) {
  return <span className="in-fact" title={source.replaceAll('_', ' ')}>
    {SOURCE_MARK[source] ?? '·'} {label}: {value}
  </span>;
}

function KnownStrip({ analysis }: { analysis: IntakeAnalysisState }) {
  const facts = [...analysis.known, ...analysis.inferred].slice(0, 8);
  if (facts.length === 0) return null;
  return <div className="in-known-wrap">
    <p className="in-caption">TONDE already understands</p>
    <div className="in-known">
      {facts.map(fact => <FactChip key={`${fact.key}-${fact.label}`} label={fact.label} value={fact.value} source={fact.source} />)}
    </div>
  </div>;
}

function QuestionCard({ decision, index, total, busy, onAnswer, autoAdvanceKey, onAutoAdvance }: {
  decision: IntakeDecision; index: number; total: number; busy: boolean;
  onAnswer: (id: string, value: string) => void;
  autoAdvanceKey: number; onAutoAdvance: (decisionId: string, value: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>(() => {
    if (!decision.answer || decision.state === 'open') return [];
    return decision.options.filter(option => decision.answer?.includes(option.label)).map(option => option.id);
  });
  const [recommendOpen, setRecommendOpen] = useState(false);
  const [freeText, setFreeText] = useState('');
  const [selectedAt, setSelectedAt] = useState(0);
  const [tondeDecision, setTondeDecision] = useState(false);
  const [tondeAnswer, setTondeAnswer] = useState<string | null>(null);
  useEffect(() => {
    setSelected(!decision.answer || decision.state === 'open'
      ? []
      : decision.options.filter(option => decision.answer?.includes(option.label)).map(option => option.id));
    setRecommendOpen(false);
    setFreeText('');
    setSelectedAt(0);
    setTondeDecision(false);
    setTondeAnswer(null);
  }, [decision.id, decision.answer, decision.state]); // eslint-disable-line react-hooks/exhaustive-deps
  const multi = decision.answer_mode === 'multi_select';
  const toggle = (id: string) => {
    setSelected(current => multi
      ? (current.includes(id) ? current.filter(item => item !== id) : [...current, id])
      : [id]);
  };
  const labels = useMemo(() => decision.options
    .filter(option => selected.includes(option.id)).map(option => option.label), [decision.options, selected]);
  useEffect(() => {
    if ((!selectedAt && !tondeDecision) || busy || (!tondeDecision && multi)) return;
    const value = tondeDecision ? tondeAnswer : labels.join(' + ');
    if (!value) return;
    const timer = window.setTimeout(() => onAutoAdvance(decision.id, value), tondeDecision ? 760 : 320);
    return () => window.clearTimeout(timer);
  }, [selectedAt, labels, multi, busy, tondeDecision, tondeAnswer, onAutoAdvance, decision.id, autoAdvanceKey]);
  const canContinue = labels.length > 0 || freeText.trim().length > 0;
  const submitLabels = () => {
    if (freeText.trim()) onAnswer(decision.id, freeText.trim());
    else if (labels.length > 0) onAnswer(decision.id, labels.join(' + '));
  };
  const useRecommendation = () => {
    const ids = decision.recommendation.option_ids
      .map(wanted => decision.options.find(option => option.id === wanted || option.label === wanted)?.id)
      .filter((id): id is string => Boolean(id));
    if (ids.length > 0) {
      const recommendation = multi ? ids : ids.slice(0, 1);
      setSelected(recommendation);
      setFreeText('');
      // A recommended single answer follows the same visible confirmation +
      // automatic advance as a directly selected single-choice option.
      if (!multi) setSelectedAt(value => value + 1);
    }
  };
  return <article className="in-question" aria-label={`Decision ${index + 1} of ${total}`}>
    <div className="in-question-head">
      <p className="eyebrow">{decision.topic}</p>
      <h2>{decision.question}</h2>
      <p className="in-why">{decision.why}</p>
      <p className="in-impact">{decision.blocking ? 'Changes the whole production' : 'High-impact decision'}</p>
    </div>
    {decision.options.length > 0 && <div className="in-choices" role="group" aria-label={decision.question}>
      {decision.options.map((option, position) => {
        const active = selected.includes(option.id);
        return <button key={option.id} type="button" className={`in-choice${active ? ' selected' : ''}`}
          aria-pressed={active} disabled={busy} onClick={() => {
            toggle(option.id);
            if (!multi) { setSelectedAt(value => value + 1); setTondeDecision(false); }
          }}>
          <span className="in-num" aria-hidden="true">{String(position + 1).padStart(2, '0')}</span>
          <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
          <span className="in-check" aria-hidden="true">✓</span>
        </button>;
      })}
    </div>}
    <div className="in-decision-actions">
      {decision.allow_tonde_decides && <button type="button" className="in-btn" disabled={busy || tondeDecision}
        onClick={() => {
          const ids = decision.recommendation.option_ids
            .map(wanted => decision.options.find(option => option.id === wanted || option.label === wanted)?.id)
            .filter((id): id is string => Boolean(id));
          const recommendation = multi ? ids : ids.slice(0, 1);
          const labels = decision.options.filter(option => recommendation.includes(option.id)).map(option => option.label);
          setTondeDecision(true);
          setSelected(recommendation);
          setTondeAnswer(labels.join(' + ') || 'TONDE decides');
          setRecommendOpen(true);
        }}>✦ TONDE DECIDE</button>}
      {decision.recommendation.option_ids.length > 0 && <button type="button" className="in-ghost" disabled={busy}
        onClick={() => setRecommendOpen(open => !open)} aria-expanded={recommendOpen}>
        What do you recommend?</button>}
    </div>
    {recommendOpen && decision.recommendation.option_ids.length > 0 && <div className="in-recommend" role="status">
      <div><strong>{tondeDecision ? 'TONDE chose: ' : 'TONDE recommends: '}{decision.recommendation.option_ids.map(id =>
        decision.options.find(option => option.id === id)?.label ?? id).join(' + ')}</strong>
        <p>{decision.recommendation.reason}</p></div>
      <button type="button" className="hm-primary" disabled={busy} onClick={useRecommendation}>USE THIS</button>
    </div>}
    <div className="in-freeform">
      <label className="sr-only" htmlFor={`in-free-${decision.id}`}>Something else? Answer naturally</label>
      <input id={`in-free-${decision.id}`} value={freeText} disabled={busy}
        onChange={event => setFreeText(event.target.value)}
        placeholder="Something else? Answer naturally…"
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (canContinue && !busy) submitLabels(); } }} />
      {(freeText.trim() || multi) && <button type="button" className="in-btn" disabled={busy || !canContinue} onClick={submitLabels}>
        {freeText.trim() ? 'Use answer →' : 'Continue →'}</button>}
    </div>
  </article>;
}

export function IntakeFlow({ analysis, decisions, deterministicNote, busy, build, buildBlocked, onAnswer, onBuild, onOpenStudio }: {
  analysis: IntakeAnalysisState;
  decisions: IntakeAnalysisState['decisions'];
  deterministicNote: string | null;
  busy: boolean;
  build: BuildPhase;
  buildBlocked: string | null;
  onAnswer: (id: string, value: string) => void;
  onBuild: () => void;
  onOpenStudio: () => void;
}) {
  const normalizedDecisions = useMemo(() => normalizeIntakeDecisions(decisions as Array<IntakeDecision | Record<string, unknown>>), [decisions]);
  const open = useMemo(() => normalizeIntakeDecisions(analysis.material_unknowns as Array<IntakeDecision | Record<string, unknown>>), [analysis]);
  const answered = useMemo(() => normalizedDecisions.filter(item => item.answered), [normalizedDecisions]);
  const [index, setIndex] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [setAside, setSetAside] = useState(false);
  const [autoAdvanceKey, setAutoAdvanceKey] = useState(0);
  const onAutoAdvance = useCallback((decisionId: string, value: string) => {
    if (busy) return;
    onAnswer(decisionId, value);
    if (editingId === decisionId) {
      setEditingId(null);
      setIndex(0);
    }
    setAutoAdvanceKey(current => current + 1);
  }, [busy, editingId, onAnswer]);
  const goBack = () => {
    if (busy) return;
    setAutoAdvanceKey(current => current + 1);
    if (index > 0) {
      setIndex(currentIndex => currentIndex - 1);
      return;
    }
    const previous = [...answered].reverse().find(item => item.id !== editingId);
    if (previous) setEditingId(previous.id);
  };
  useEffect(() => {
    setIndex(current => Math.min(current, Math.max(open.length - 1, 0)));
    if (editingId && !normalizedDecisions.some(item => item.id === editingId)) setEditingId(null);
  }, [open.length, normalizedDecisions, editingId]);
  const editing = editingId ? normalizedDecisions.find(item => item.id === editingId) ?? null : null;
  const current = editing ?? open[Math.min(index, Math.max(open.length - 1, 0))] ?? null;

  if (setAside && build.state === 'idle') {
    return <section className="in-panel" aria-label="Adaptive creative intake">
      <div className="in-resume">
        <div><strong>Intake in progress — {open.length} decision{open.length === 1 ? '' : 's'} left.</strong>
          <small>Your answers are saved. Resume any time; nothing duplicates.</small></div>
        <button type="button" className="hm-primary" onClick={() => setSetAside(false)}>Resume intake →</button>
      </div>
    </section>;
  }

  return <section className="in-panel" aria-label="Adaptive creative intake">
    <header className="in-progress">
      <p className="eyebrow">{build.state !== 'idle' ? 'TONDE IS DIRECTING'
        : open.length > 0 ? `DECISION ${Math.min(index + 1, open.length)} OF ${open.length}` : 'DIRECTION READY'}</p>
      <div className="in-bars" aria-hidden="true">
        {open.map(item => <span key={item.id} className={item.state !== 'open' ? 'done' : undefined} />)}
      </div>
      {build.state === 'idle' && <button type="button" className="in-ghost" onClick={() => setSetAside(true)}>Set aside</button>}
    </header>

    {build.state === 'idle' && current && <>
      <KnownStrip analysis={analysis} />
      <QuestionCard key={current.id} decision={current}
        index={editing ? answered.findIndex(item => item.id === current.id) : index}
        total={editing ? answered.length : open.length} busy={busy} onAnswer={onAnswer}
        autoAdvanceKey={autoAdvanceKey} onAutoAdvance={onAutoAdvance} />
      <footer className="in-foot">
        <small>Typical intake: 1–3 decisions. Zero questions when TONDE already has enough.</small>
        <div className="in-nav">
          {!editing && <button type="button" className="in-btn" disabled={busy || (index === 0 && answered.length === 0)} onClick={goBack}>← Back</button>}
          {editing && <button type="button" className="in-btn" onClick={() => setEditingId(null)}>Done editing</button>}
          {!editing && index < open.length - 1 && <span className="in-hint">Answer to continue — the queue re-evaluates every time.</span>}
        </div>
      </footer>
    </>}

    {build.state === 'idle' && !current && <article className="in-confirm" aria-label="Creative direction confirmation">
      <div className="in-confirm-title">
        <p className="eyebrow">TONDE</p>
        <h2>I have enough to direct this.</h2>
        <p>This is the production TONDE is about to build.</p>
      </div>
      <div className="in-summary">
        <p className="eyebrow">CREATIVE DIRECTION</p>
        <p className="in-summary-copy">{analysis.creative_direction_summary || 'Direction confirmed from your intake.'}</p>
        {analysis.creative_facts.length > 0 && <div className="in-facts">
          {analysis.creative_facts.map(fact => <span key={fact}>{fact}</span>)}
        </div>}
      </div>
      {deterministicNote && <p className="subtle" role="status">{deterministicNote}</p>}
      {answered.length > 0 && <details className="in-decided">
        <summary>Decided ({answered.length}) — change something</summary>
        <ul>{answered.map(item => <li key={item.id}>
          <span><strong>{item.question}</strong> — {item.answer}</span>
          <button type="button" className="in-ghost" disabled={busy} onClick={() => setEditingId(item.id)}>Edit</button>
        </li>)}</ul>
      </details>}
      {buildBlocked && <p role="alert" className="in-error">{buildBlocked}</p>}
      <div className="in-confirm-actions">
        {answered.length === 0 && <button type="button" className="in-btn" disabled={busy} onClick={() => setSetAside(true)}>Not yet</button>}
        <button type="button" className="hm-primary" disabled={busy || Boolean(buildBlocked)} onClick={onBuild}>
          {busy ? 'Building…' : 'BUILD PRODUCTION →'}</button>
      </div>
    </article>}

    {build.state !== 'idle' && <BuildView build={build} answeredCount={answered.length} busy={busy} onBuild={onBuild} onOpenStudio={onOpenStudio} />}
  </section>;
}

function BuildView({ build, answeredCount, busy, onBuild, onOpenStudio }: {
  build: BuildPhase; answeredCount: number; busy: boolean; onBuild: () => void; onOpenStudio: () => void;
}) {
  const cardsReady = (build.cardCount ?? 0) > 0;
  const steps = [
    { label: 'Master Production created', detail: build.productionId ? `Production ${build.productionId.slice(0, 8)}…` : 'Authenticated production record', state: build.state === 'failed' ? 'failed' : 'done' },
    { label: 'Creative direction saved', detail: answeredCount > 0 ? `${answeredCount} confirmed decision${answeredCount === 1 ? '' : 's'} plus intake` : 'Intake goal plus attached sources', state: build.state === 'failed' ? 'failed' : 'done' },
    { label: 'First production cards', detail: cardsReady ? `${build.cardCount} card${build.cardCount === 1 ? '' : 's'} ready — enough to enter Studio` : 'Waiting for the first meaningful card', state: cardsReady ? 'done' : build.state === 'building' ? 'working' : 'waiting' },
  ];
  const done = steps.filter(step => step.state === 'done').length;
  return <article className="in-build" aria-label="Production build progress" aria-live="polite">
    <p className="eyebrow">TONDE IS DIRECTING</p>
    <h2>Building the production.</h2>
    <p className="subtle">Every state below comes from real backend work — no simulated progress.</p>
    <div className="in-steps">{steps.map(step => <div key={step.label} className="in-step">
      <div><strong>{step.label}</strong><small>{step.detail}</small></div>
      <span className={`in-state ${step.state}`}>{step.state === 'done' ? '✓ Done' : step.state === 'working' ? '◌ Working' : step.state === 'failed' ? '✕ Failed' : 'Waiting'}</span>
    </div>)}</div>
    <div className="in-progress-line" aria-hidden="true"><span style={{ width: `${(done / steps.length) * 100}%` }} /></div>
    {build.state === 'failed' && <>
      <p role="alert" className="in-error">{build.error ?? 'The build failed before any cards existed. Nothing was opened.'}</p>
      <button type="button" className="hm-primary" disabled={busy} onClick={onBuild}>Retry build</button>
    </>}
    {build.state !== 'failed' && cardsReady && <div className="in-early" role="status">
      <div><strong>Your first cards are ready.</strong><small>The saved Cards are available in Studio. No background expansion is claimed.</small></div>
      <button type="button" className="hm-primary" onClick={onOpenStudio}>OPEN STUDIO NOW →</button>
    </div>}
    {build.state === 'building' && !cardsReady && <p className="subtle" role="status">Checking for the first cards… Studio opens as soon as one meaningful card exists.</p>}
  </article>;
}
