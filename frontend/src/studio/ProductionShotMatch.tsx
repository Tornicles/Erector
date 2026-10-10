import { useCallback, useEffect, useMemo, useState } from 'react';
import { Camera, GitCompare, Sparkles, Wand2 } from 'lucide-react';
import { safeError } from '../services/errors';
import {
  productionShotMatchService,
  type CorrectionRecommendation, type MatchConfidence, type MatchCorrection,
  type MatchReport, type MatchReportList, type MatchSeverity, type MatchVocabulary,
  type ResultDetail, type ResultList, type ResultState, type ShotMatchedResult,
} from '../services/productionShotMatch';
import { LoadingState } from '../components/StateComponents';

/**
 * Results and Shot Match: what was actually created, whether it matched what we directed, and how to
 * fix only this Shot.
 *
 * Four deliberate separations. A Result is what was actually created - it shows where it came from
 * and what the database verified about its media, and Final is never implied. Shot Match is a
 * diagnosis with evidence, not a score: every finding carries an epistemic state, a confidence and
 * the evidence it was seen on, and the surface states what it was unable to compare. A mismatch
 * produces a recommendation, never an action - recommending regeneration launches nothing, and
 * deciding an analysis is not an approval of the Result. FIX THIS SHOT is scoped to one object: the
 * impact is previewed before it is applied, and the previous plan, the Result and every earlier
 * analysis stay readable.
 */

type ShotTarget = { id: string; label: string; method: string; resultCount: number };
type CorrectionTarget = { id: string; label: string; kind: string };

const SEVERITY_TONE: Record<MatchSeverity, string> = { critical: 'bad', warning: 'warn', info: 'muted' };
const RECOMMENDATION_TONE: Record<CorrectionRecommendation, string> = {
  none: 'ok', pickup_required: 'bad', regeneration_recommended: 'warn', both: 'bad',
};
const STATE_TONE: Record<string, string> = {
  raw: 'muted', needs_review: 'warn', approved: 'ok', rejected: 'bad', final: 'ok',
};
const SEVERITY_LABEL: Record<MatchSeverity, string> = {
  critical: 'Critical', warning: 'Warning', info: 'Note',
};
const RECOMMENDATION_LABEL: Record<CorrectionRecommendation, string> = {
  none: 'No fix required', pickup_required: 'Pickup required',
  regeneration_recommended: 'Regeneration recommended', both: 'Pickup and regeneration',
};
const CONFIDENCE_LABEL: Record<MatchConfidence, string> = {
  high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence',
};
const RESULT_STATE_LABEL: Record<ResultState, string> = {
  raw: 'Raw', needs_review: 'Needs review', approved: 'Approved', rejected: 'Rejected', final: 'Final',
};
const EPISTEMIC_LABEL: Record<string, string> = {
  observed: 'Observed', estimated: 'Estimated', recommended: 'Recommended', unknown: 'Unknown',
};
const VERDICT_LABEL: Record<string, string> = {
  matches_intent: 'Matches intent', acceptable_variation: 'Acceptable variation',
  needs_attention: 'Needs attention', mismatch: 'Mismatch', unknown: 'Not enough evidence',
};

/** The comparison dimensions Shot Match may report on. A dimension is a name, never a score. */
const DIMENSIONS: Array<{ value: string; label: string }> = [
  { value: 'framing', label: 'Framing' }, { value: 'camera_height', label: 'Camera height' },
  { value: 'camera_angle', label: 'Camera angle' }, { value: 'subject_position', label: 'Subject position' },
  { value: 'composition', label: 'Composition' }, { value: 'screen_direction', label: 'Screen direction' },
  { value: 'lens_perspective', label: 'Lens / perspective look' }, { value: 'depth_of_field', label: 'Depth of field' },
  { value: 'camera_movement', label: 'Camera movement' }, { value: 'subject_movement', label: 'Subject movement' },
  { value: 'lighting', label: 'Lighting' }, { value: 'contrast', label: 'Contrast' }, { value: 'color', label: 'Color' },
  { value: 'background', label: 'Background' }, { value: 'environment', label: 'Environment' },
  { value: 'wardrobe', label: 'Wardrobe' }, { value: 'props', label: 'Props' },
  { value: 'character_consistency', label: 'Character consistency' }, { value: 'product_fidelity', label: 'Product fidelity' },
  { value: 'performance', label: 'Performance' }, { value: 'timing', label: 'Timing' },
  { value: 'transition', label: 'Transition' }, { value: 'continuity', label: 'Continuity' },
  { value: 'audio', label: 'Audio' },
];

/** The fields a scoped correction may change, by target kind. Identity, order and locks are absent. */
const CORRECTABLE_FIELDS: Record<string, Array<{ value: string; label: string }>> = {
  execution_plan: [
    { value: 'framing', label: 'Framing' }, { value: 'camera_height', label: 'Camera height' },
    { value: 'camera_position', label: 'Camera position' }, { value: 'camera_angle', label: 'Camera angle' },
    { value: 'movement', label: 'Movement' }, { value: 'composition', label: 'Composition' },
    { value: 'lighting_intent', label: 'Lighting intent' }, { value: 'performance', label: 'Performance' },
    { value: 'blocking', label: 'Blocking' }, { value: 'product_direction', label: 'Product direction' },
    { value: 'provider_prompt', label: 'Prompt' },
  ],
  shot: [
    { value: 'title', label: 'Title' }, { value: 'description', label: 'Description' },
    { value: 'action', label: 'Action' }, { value: 'purpose', label: 'Purpose' }, { value: 'subject', label: 'Subject' },
  ],
  scene: [
    { value: 'title', label: 'Title' }, { value: 'description', label: 'Description' },
    { value: 'purpose', label: 'Purpose' },
  ],
};

function when(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function provenanceLine(result: ShotMatchedResult): string {
  const provenance = result.provenance ?? {};
  if (provenance.origin === 'real_take') {
    return `Real Take ${provenance.take_number ?? '?'}${provenance.take_status ? ` · ${provenance.take_status}` : ''}`;
  }
  if (provenance.origin === 'ai_generation') {
    return `AI Attempt ${provenance.attempt_number ?? '?'}${provenance.provider ? ` · ${provenance.provider}` : ''}`;
  }
  return result.origin_label ?? 'Unrecorded source';
}

export function ProductionShotMatchCanvas({ workspaceId, productionId, shots, targets, busy, onChanged, onOpenShot }: {
  workspaceId: string; productionId: string; shots: ShotTarget[]; targets: CorrectionTarget[];
  busy: boolean; onChanged: () => void; onOpenShot?: (shotId: string) => void;
}) {
  const [vocabulary, setVocabulary] = useState<MatchVocabulary | null>(null);
  const [shotId, setShotId] = useState('');
  const [results, setResults] = useState<ResultList | null>(null);
  const [resultId, setResultId] = useState('');
  const [detail, setDetail] = useState<ResultDetail | null>(null);
  const [reports, setReports] = useState<MatchReportList | null>(null);
  const [report, setReport] = useState<MatchReport | null>(null);
  const [correction, setCorrection] = useState<MatchCorrection | null>(null);
  const [note, setNote] = useState('');
  const [dimension, setDimension] = useState('framing');
  const [difference, setDifference] = useState('');
  const [evidence, setEvidence] = useState('');
  const [severity, setSeverity] = useState<MatchSeverity>('warning');
  const [suggestedFix, setSuggestedFix] = useState('');
  const [targetId, setTargetId] = useState('');
  const [field, setField] = useState('framing');
  const [fieldValue, setFieldValue] = useState('');
  const [rootCause, setRootCause] = useState('');
  const [affected, setAffected] = useState('');
  const [remember, setRemember] = useState(false);
  const [working, setWorking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const refresh = useCallback(() => { setReloadKey(current => current + 1); onChanged(); }, [onChanged]);

  useEffect(() => {
    if (!shotId && shots.length > 0) setShotId(shots[0].id);
  }, [shots, shotId]);

  useEffect(() => {
    if (!targetId && targets.length > 0) setTargetId(targets[0].id);
  }, [targets, targetId]);


  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    productionShotMatchService.vocabulary(workspaceId, productionId)
      .then(loaded => { if (active) setVocabulary(loaded); })
      .catch(failure => { if (active) setError(safeError(failure).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceId, productionId, reloadKey]);

  useEffect(() => {
    if (!shotId) { setResults(null); return; }
    let active = true;
    Promise.all([
      productionShotMatchService.results(workspaceId, productionId, { shotId }),
      productionShotMatchService.reports(workspaceId, productionId, { shotId }),
    ]).then(([loadedResults, loadedReports]) => {
      if (!active) return;
      setResults(loadedResults); setReports(loadedReports);
      setResultId(current => loadedResults.items.some(item => item.result_id === current)
        ? current : (loadedResults.items[0]?.result_id ?? ''));
    }).catch(failure => { if (active) setError(safeError(failure).message); });
    return () => { active = false; };
  }, [workspaceId, productionId, shotId, reloadKey]);

  useEffect(() => {
    if (!resultId) { setDetail(null); return; }
    let active = true;
    productionShotMatchService.result(workspaceId, productionId, resultId)
      .then(loaded => { if (active) setDetail(loaded); })
      .catch(failure => { if (active) setDetail(null); setNotice(safeError(failure).message); });
    return () => { active = false; };
  }, [workspaceId, productionId, resultId, reloadKey]);

  useEffect(() => {
    const newest = reports?.items?.[0];
    if (!newest) { setReport(null); return; }
    let active = true;
    productionShotMatchService.report(workspaceId, productionId, newest.report_id)
      .then(loaded => { if (active) setReport(loaded); })
      .catch(() => { if (active) setReport(null); });
    return () => { active = false; };
  }, [workspaceId, productionId, reports, reloadKey]);

  // A correction targets the smallest correct scope. Besides the Shot and Scene the caller offers,
  // the execution plan the Result was actually made against is a legitimate target - and it is known
  // from the Result itself, so it is always available even when the caller cannot list plans.
  const correctionTargets = useMemo(() => {
    const list = [...targets];
    const plan = detail?.plan;
    if (plan && !list.some(target => target.id === plan.plan_id)) {
      list.push({ id: plan.plan_id,
        label: `Execution plan (${plan.execution_method.toUpperCase()} · revision ${plan.revision})`,
        kind: 'execution_plan' });
    }
    return list;
  }, [targets, detail]);

  const selectedShot = shots.find(shot => shot.id === shotId) ?? null;
  const selectedTarget = correctionTargets.find(target => target.id === targetId) ?? null;
  const currentResult = results?.items.find(item => item.result_id === resultId) ?? null;
  const fieldOptions = useMemo(() => CORRECTABLE_FIELDS[selectedTarget?.kind ?? ''] ?? [], [selectedTarget]);
  const blocked = working || busy;

  useEffect(() => {
    if (fieldOptions.length > 0 && !fieldOptions.some(option => option.value === field)) {
      setField(fieldOptions[0].value);
    }
  }, [fieldOptions, field]);

  async function changeState(state: ResultState) {
    if (blocked || !resultId) return;
    setWorking(true); setError(null); setNotice(null);
    try {
      const result = await productionShotMatchService.setResultState(workspaceId, productionId, resultId, {
        state, expectedRevision: currentResult?.revision ?? null, note,
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

  async function analyze() {
    if (blocked || !shotId || !resultId) return;
    if (!evidence.trim()) { setError('An observed difference must cite the evidence it was seen on.'); return; }
    if (!difference.trim()) { setError('Say what is different before recording the analysis.'); return; }
    setWorking(true); setError(null); setNotice(null);
    try {
      const loaded = await productionShotMatchService.analyze(workspaceId, productionId, shotId, {
        resultId, origin: 'creator',
        findings: [{
          category: dimension, difference, evidence: [evidence], severity,
          epistemic: 'observed', confidence: 'high',
          suggested_correction: suggestedFix,
        }],
      });
      setReport(loaded);
      setNotice(`${SEVERITY_LABEL[loaded.severity]}: ${RECOMMENDATION_LABEL[loaded.recommendation]}. The analysis recorded what is different; the Result is unchanged.`);
      setDifference(''); setEvidence(''); setSuggestedFix('');
      refresh();
    } catch (failure) {
      setError(safeError(failure).message);
    } finally {
      setWorking(false);
    }
  }

  async function decide(decision: 'pickup' | 'regeneration' | 'accepted' | 'dismiss') {
    if (blocked || !report) return;
    setWorking(true); setError(null); setNotice(null);
    try {
      const result = await productionShotMatchService.decide(workspaceId, productionId, report.report_id, {
        decision, note,
      });
      setNotice(result.note);
      setNote('');
      refresh();
    } catch (failure) {
      setError(safeError(failure).message);
    } finally {
      setWorking(false);
    }
  }

  async function propose() {
    if (blocked || !report || !targetId) return;
    if (rootCause.trim().length < 12) {
      setError('Explain the production cause, not only which dimension differs.');
      return;
    }
    if (!fieldValue.trim()) { setError('Say what the corrected value should be.'); return; }
    setWorking(true); setError(null); setNotice(null);
    try {
      const proposed = await productionShotMatchService.proposeCorrection(workspaceId, productionId,
        report.report_id, {
          targetObjectId: targetId, patch: { [field]: fieldValue }, rootCause,
          why: difference || report.headline || '', affected: `Scoped to ${selectedTarget?.label ?? 'the chosen target'} only`,
        });
      setCorrection(proposed);
      setNotice(proposed.impact_line ?? 'The correction is a proposal. Nothing has changed yet.');
      refresh();
    } catch (failure) {
      setError(safeError(failure).message);
    } finally {
      setWorking(false);
    }
  }

  async function applyCorrection() {
    if (blocked || !correction) return;
    setWorking(true); setError(null); setNotice(null);
    try {
      const applied = await productionShotMatchService.applyCorrection(workspaceId, productionId,
        correction.correction_id, {
          expectedRevision: correction.source_revision, propagation: 'change_only_this',
          note, recordCandidate: remember,
        });
      setCorrection(applied);
      setNotice(applied.preserved_line ?? 'A new revision was created.');
      setNote(''); setRemember(false);
      refresh();
    } catch (failure) {
      setError(safeError(failure).message);
    } finally {
      setWorking(false);
    }
  }

  async function rejectCorrection() {
    if (blocked || !correction) return;
    setWorking(true); setError(null); setNotice(null);
    try {
      const rejected = await productionShotMatchService.rejectCorrection(workspaceId, productionId,
        correction.correction_id, { note });
      setCorrection(rejected);
      setNotice(rejected.note ?? 'The correction was rejected. Nothing changed.');
      setNote('');
      refresh();
    } catch (failure) {
      setError(safeError(failure).message);
    } finally {
      setWorking(false);
    }
  }

  if (loading) return <LoadingState label="Loading what was actually created…" />;

  return (
    <section className="ms" aria-label="Results and Shot Match">
      {error && <p className="ms-alert" role="alert">{error}</p>}
      {notice && <p className="ms-note" role="status">{notice}</p>}

      <div className="ms-shot" role="region" aria-label="Shot to check">
        <label className="ms-field">
          <span>Shot</span>
          <select aria-label="Shot to check" value={shotId} onChange={event => { setShotId(event.target.value); setCorrection(null); }}>
            {shots.map(shot => (
              <option key={shot.id} value={shot.id}>
                {shot.label} · {shot.method.toUpperCase()} · {shot.resultCount} result(s)
              </option>
            ))}
          </select>
        </label>
        {shots.length === 0 && (
          <p className="ms-muted">No Shot exists yet, so there is nothing to compare.</p>
        )}
        {onOpenShot && selectedShot && (
          <button type="button" className="ms-open" onClick={() => onOpenShot(selectedShot.id)}>
            Open {selectedShot.label}
          </button>
        )}
      </div>

      <div className="ms-results" role="region" aria-label="Results">
        <header className="ms-head">
          <Camera size={16} aria-hidden />
          <h3>Results</h3>
          <span className="ms-muted">What was actually created — not the plan.</span>
        </header>

        {results && results.items.length === 0 && (
          <p className="ms-empty">
            No Result is recorded for this Shot. A Result is registered where the media is captured: a
            Real Take on set, or an AI Attempt. Nothing is simulated here.
          </p>
        )}

        {results && results.items.length > 0 && (
          <ul className="ms-list" aria-label="Recorded results">
            {results.items.map(item => (
              <li key={item.result_id} className={item.result_id === resultId ? 'ms-item ms-item-on' : 'ms-item'}>
                <button type="button" className="ms-item-pick" onClick={() => setResultId(item.result_id)}>
                  <span className={`ms-badge ms-${STATE_TONE[item.state] ?? 'muted'}`}>
                    {item.state_label ?? RESULT_STATE_LABEL[item.state]}
                  </span>
                  <span className="ms-item-title">{provenanceLine(item)}</span>
                  {item.match_worst_severity && (
                    <span className={`ms-badge ms-${SEVERITY_TONE[item.match_worst_severity]}`}>
                      {item.match_severity_label ?? SEVERITY_LABEL[item.match_worst_severity]}
                    </span>
                  )}
                  {item.match_recommendation && item.match_recommendation !== 'none' && (
                    <span className={`ms-badge ms-${RECOMMENDATION_TONE[item.match_recommendation]}`}>
                      {item.match_recommendation_label ?? RECOMMENDATION_LABEL[item.match_recommendation]}
                    </span>
                  )}
                </button>
                {item.capability_line && <p className="ms-cap">{item.capability_line}</p>}
              </li>
            ))}
          </ul>
        )}

        {detail && (
          <dl className="ms-detail" aria-label="Selected Result">
            <div><dt>Revision</dt><dd>{detail.revision}</dd></div>
            <div><dt>Analyses</dt><dd>{detail.match_reports.length}</dd></div>
            <div><dt>Plan</dt><dd>{detail.plan ? `${detail.plan.execution_method.toUpperCase()} · ${detail.plan.approval} · revision ${detail.plan.revision}` : '—'}</dd></div>
            <div><dt>Media</dt><dd>{detail.capabilities.media_state ?? '—'}</dd></div>
          </dl>
        )}

        {detail && (
          <>
            <label className="ms-field">
              <span>Reason (recorded with your decision)</span>
              <input aria-label="Result decision reason" value={note} maxLength={800}
                onChange={event => setNote(event.target.value)}
                placeholder="Why are you accepting, rejecting, reopening or finalizing this Result?" />
            </label>
            <div className="ms-actions">
              <button type="button" disabled={blocked} onClick={() => changeState('approved')}>Accept Result</button>
              <button type="button" disabled={blocked} onClick={() => changeState('rejected')}>Reject Result</button>
              <button type="button" disabled={blocked} onClick={() => changeState('needs_review')}>Needs review</button>
              <button type="button" disabled={blocked} onClick={() => changeState('final')}>Mark Final</button>
            </div>
            <p className="ms-meaning">
              {detail.final_line ?? 'Final is explicitly accepted evidence or deliverable state; generation completion never sets it.'}
            </p>
          </>
        )}
      </div>

      <div className="ms-analyze" role="region" aria-label="Record what is different">
        <header className="ms-head">
          <GitCompare size={16} aria-hidden />
          <h3>Shot Match</h3>
          <span className="ms-muted">A diagnosis, not a similarity score.</span>
        </header>
        <p className="ms-muted">
          {vocabulary?.limitation ?? 'Comparison only uses the modalities verified from real media rows.'}
        </p>
        <div className="ms-grid">
          <label className="ms-field">
            <span>Dimension</span>
            <select aria-label="Dimension compared" value={dimension} onChange={event => setDimension(event.target.value)}>
              {DIMENSIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="ms-field">
            <span>Severity</span>
            <select aria-label="Finding severity" value={severity} onChange={event => setSeverity(event.target.value as MatchSeverity)}>
              {(['info', 'warning', 'critical'] as MatchSeverity[]).map(value => (
                <option key={value} value={value}>{SEVERITY_LABEL[value]}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="ms-field">
          <span>What is different</span>
          <input aria-label="Difference" value={difference} maxLength={600}
            onChange={event => setDifference(event.target.value)}
            placeholder="The Product is higher than the planned lower third" />
        </label>
        <label className="ms-field">
          <span>Evidence (frame, time range, region or transcript)</span>
          <input aria-label="Evidence" value={evidence} maxLength={120}
            onChange={event => setEvidence(event.target.value)} placeholder="frame 0-48" />
        </label>
        <label className="ms-field">
          <span>Suggested correction</span>
          <input aria-label="Suggested correction" value={suggestedFix} maxLength={600}
            onChange={event => setSuggestedFix(event.target.value)}
            placeholder="Lower the camera about 20 cm" />
        </label>
        <div className="ms-actions">
          <button type="button" disabled={blocked || !resultId} onClick={analyze}>Record this analysis</button>
        </div>
        <p className="ms-meaning">
          A measured lens or an identified person is never reported here: report an estimated look, and
          compare only an authorized Character reference.
        </p>
      </div>

      {report && (
        <div className="ms-report" role="region" aria-label="Shot Match analysis">
          <header className="ms-head">
            <span className={`ms-badge ms-${SEVERITY_TONE[report.severity]}`}>
              {report.severity_label ?? SEVERITY_LABEL[report.severity]}
            </span>
            <span className={`ms-badge ms-${RECOMMENDATION_TONE[report.recommendation]}`}>
              {report.recommendation_label ?? RECOMMENDATION_LABEL[report.recommendation]}
            </span>
            <span className="ms-muted">{report.origin_label ?? report.origin} · {when(report.iteration_chain[0]?.created_at)}</span>
          </header>
          {report.headline && <p className="ms-headline">{report.headline}</p>}
          {report.capability_line && (
            <p className="ms-cap">
              This analysis was based on {report.capability_line.replace(/^Compared from /, '')}
            </p>
          )}

          <div className="ms-summary" role="region" aria-label="Summary">
            <div><h4>What worked</h4>
              <ul>{report.summary.what_worked.map((entry, index) => (
                <li key={`${entry.category}-${index}`}>{entry.category.replace(/_/g, ' ')} — {VERDICT_LABEL[entry.verdict] ?? entry.verdict}</li>))}
                {report.summary.what_worked.length === 0 && <li className="ms-muted">Nothing matched yet.</li>}</ul></div>
            <div><h4>What drifted</h4>
              <ul>{report.summary.what_drifted.map((entry, index) => (
                <li key={`${entry.category}-${index}`}>{entry.category.replace(/_/g, ' ')} — {entry.difference}</li>))}
                {report.summary.what_drifted.length === 0 && <li className="ms-muted">No drift recorded.</li>}</ul></div>
            <div><h4>What matters most</h4>
              <ul>{report.summary.what_matters_most.map((entry, index) => (
                <li key={`${entry.category}-${index}`}>{entry.difference}</li>))}</ul></div>
            <div><h4>What to fix next</h4>
              <ul>{report.summary.what_to_fix_next.map((entry, index) => (
                <li key={`${entry.category}-${index}`}>{entry.fix}</li>))}</ul></div>
          </div>
          <p className="ms-meaning">{report.summary.note}</p>

          <ul className="ms-dims" aria-label="Dimension verdicts">
            {report.dimensions.map(entry => (
              <li key={entry.dimension}>
                <span className="ms-dim-name">{entry.dimension.replace(/_/g, ' ')}</span>
                <span className="ms-dim-verdict">{entry.verdict_label ?? VERDICT_LABEL[entry.verdict] ?? entry.verdict}</span>
              </li>
            ))}
          </ul>

          <ol className="ms-findings" aria-label="Findings">
            {report.findings.map((finding, index) => (
              <li key={`${finding.category}-${index}`}>
                <div className="ms-finding-head">
                  <span className={`ms-badge ms-${SEVERITY_TONE[finding.severity]}`}>
                    {finding.severity_label ?? SEVERITY_LABEL[finding.severity]}
                  </span>
                  <strong>{finding.category.replace(/_/g, ' ')}</strong>
                  <span className="ms-muted">
                    {finding.epistemic_label ?? EPISTEMIC_LABEL[finding.epistemic] ?? finding.epistemic} ·{' '}
                    {finding.confidence_label ?? CONFIDENCE_LABEL[finding.confidence] ?? finding.confidence}
                  </span>
                </div>
                <p className="ms-finding-difference">{finding.difference}</p>
                {finding.evidence.length > 0 && (
                  <p className="ms-finding-evidence">Evidence: {finding.evidence.join(', ')}</p>
                )}
                {finding.suggested_correction && (
                  <p className="ms-finding-fix">Suggested fix: {finding.suggested_correction}</p>
                )}
                {finding.continuity_finding_id && (
                  <p className="ms-finding-continuity">Raised as a continuity finding.</p>
                )}
              </li>
            ))}
          </ol>

          {report.limitations.length > 0 && (
            <div className="ms-limits" role="note" aria-label="What this comparison could not see">
              <h4>What this comparison could not see</h4>
              <ul>{report.limitations.map(item => <li key={item}>{item}</li>)}</ul>
            </div>
          )}

          <div className="ms-actions">
            <button type="button" disabled={blocked} onClick={() => decide('pickup')}>Request pickup</button>
            <button type="button" disabled={blocked} onClick={() => decide('regeneration')}>Recommend regeneration</button>
            <button type="button" disabled={blocked} onClick={() => decide('accepted')}>Accept diagnosis</button>
            <button type="button" disabled={blocked} onClick={() => decide('dismiss')}>Dismiss</button>
          </div>
          <p className="ms-meaning">
            Deciding an analysis is not an approval of the Result, and recommending regeneration launches
            nothing: paid generation still needs its normal explicit confirmation.
          </p>

          {report.iteration_chain.length > 1 && (
            <ol className="ms-chain" aria-label="Iteration history">
              {report.iteration_chain.map((entry, index) => (
                <li key={entry.report_id}>
                  <span className="ms-chain-index">{index + 1}</span>
                  <span className={`ms-badge ms-${SEVERITY_TONE[entry.severity]}`}>
                    {SEVERITY_LABEL[entry.severity]}
                  </span>
                  <span className="ms-muted">{when(entry.created_at)}</span>
                  <span className="ms-chain-decision">
                    {entry.decision ? `decided: ${entry.decision}` : 'no decision yet'}
                  </span>
                </li>
              ))}
            </ol>
          )}

          <div className="ms-fix" role="region" aria-label="Fix this shot">
            <header className="ms-head">
              <Wand2 size={16} aria-hidden />
              <h3>Fix this shot</h3>
              <span className="ms-muted">One scoped correction. Never a whole-Production regeneration.</span>
            </header>
            <div className="ms-grid">
              <label className="ms-field">
                <span>Target</span>
                <select aria-label="Correction target" value={targetId} onChange={event => setTargetId(event.target.value)}>
                  {correctionTargets.map(target => (
                    <option key={target.id} value={target.id}>{target.label} ({target.kind})</option>
                  ))}
                </select>
              </label>
              <label className="ms-field">
                <span>Field</span>
                <select aria-label="Field to correct" value={field} onChange={event => setField(event.target.value)}>
                  {fieldOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            </div>
            {fieldOptions.length === 0 && (
              <p className="ms-muted">
                This target cannot be corrected this way. Choose the Shot, the Real or AI execution plan or the Story.
              </p>
            )}
            <label className="ms-field">
              <span>Corrected value</span>
              <input aria-label="Corrected value" value={fieldValue} maxLength={600}
                onChange={event => setFieldValue(event.target.value)} placeholder="low, at product level" />
            </label>
            <label className="ms-field">
              <span>Root cause</span>
              <input aria-label="Root cause" value={rootCause} maxLength={800}
                onChange={event => setRootCause(event.target.value)}
                placeholder="The camera was higher than planned, so the Product read as secondary" />
            </label>
            <label className="ms-field">
              <span>Affected</span>
              <input aria-label="Affected scope" value={affected} maxLength={400}
                onChange={event => setAffected(event.target.value)}
                placeholder="Shot 4 Real Execution Plan only" />
            </label>
            <div className="ms-actions">
              <button type="button" disabled={blocked || fieldOptions.length === 0} onClick={propose}>
                Propose correction
              </button>
            </div>
          </div>

          {correction && (
            <div className="ms-correction" role="region" aria-label="Correction proposal">
              <header className="ms-head">
                <span className="ms-badge ms-muted">{correction.state_label ?? correction.state}</span>
                <strong>{correction.target_label}</strong>
                <span className="ms-muted">{correction.target_kind.replace(/_/g, ' ')} · revision {correction.source_revision}</span>
              </header>
              <p className="ms-correction-change">
                Change: {Object.entries(correction.patch).map(([key, value]) => `${key.replace(/_/g, ' ')} → ${String(value)}`).join('; ')}
              </p>
              <p className="ms-correction-why">Why: {correction.root_cause}</p>
              {correction.affected && <p className="ms-correction-affected">Affected: {correction.affected}</p>}
              {correction.preview?.counts && (
                <p className="ms-correction-impact">
                  Previewed impact: {correction.preview.counts.direct ?? 0} direct ·{' '}
                  {correction.preview.counts.downstream ?? 0} downstream ·{' '}
                  {correction.preview.counts.potential ?? 0} potential — computed, not applied.
                </p>
              )}
              {correction.state === 'proposed' && (
                <>
                  <label className="ms-check">
                    <input type="checkbox" checked={remember} disabled={blocked}
                      onChange={event => setRemember(event.target.checked)} />
                    <span>Remember this fix for later Shots — only after a later analysis confirms it helped.</span>
                  </label>
                  <div className="ms-actions">
                    <button type="button" disabled={blocked} onClick={applyCorrection}>Apply to this Shot</button>
                    <button type="button" disabled={blocked} onClick={rejectCorrection}>
                      <Sparkles size={14} aria-hidden /> Reject
                    </button>
                  </div>
                  <p className="ms-meaning">
                    Applying creates a new revision and preserves the previous plan, the Result and every
                    earlier analysis. A locked object is never corrected incidentally.
                  </p>
                </>
              )}
              {correction.state === 'applied' && (
                <p className="ms-meaning">Applied. Revision {correction.applied_revision}.</p>
              )}
              {correction.state === 'rejected' && (
                <p className="ms-meaning">Rejected. The proposal is closed and the plan is unchanged.</p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
