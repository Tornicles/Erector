import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, GitCompare, ShieldCheck, Undo2 } from 'lucide-react';
import { safeError } from '../services/errors';
import {
  productionContinuityService, type ContinuityAnchor, type ContinuityChain,
  type ContinuityCheckResult, type ContinuityDomain, type ContinuityFinding,
  type ContinuityFindingList, type ContinuityFindingState, type ContinuitySeverity,
  type ContinuityStatementList, type ContinuitySummary, type ContinuityTransition,
  type ContinuityVocabulary,
} from '../services/productionContinuity';
import { LoadingState } from '../components/StateComponents';

/**
 * Continuity: what is true about a Production at each point in it, and what does not add up.
 *
 * The screen is built around four deliberate separations. A statement is a declaration at a point
 * in Production order, so recording a different value supersedes the older statement and the
 * history stays readable. Running the check changes no statement - it records what the
 * declarations say - and the surface says out loud what a check cannot see: it does not analyse
 * media, so an unrecorded trait is unknown rather than consistent. A finding is decided by the
 * creator; there is no "approved" finding. And a proposal is a proposal, so it is labelled
 * INFERRED and carries its own basis.
 */

const SEVERITIES: ContinuitySeverity[] = ['critical', 'warning', 'info'];

const ANCHOR_TARGETS: Array<{ value: ContinuityAnchor; label: string }> = [
  { value: 'production', label: 'Whole Production' },
  { value: 'scene_opening', label: 'Scene opening' },
  { value: 'scene_ending', label: 'Scene ending' },
  { value: 'shot', label: 'Shot' },
];

const TRANSITIONS: Array<{ value: ContinuityTransition; label: string }> = [
  { value: 'baseline', label: 'First statement of this trait' },
  { value: 'continuous', label: 'Continues unchanged' },
  { value: 'changed', label: 'Declared change' },
];

export function ProductionContinuityCanvas({ workspaceId, productionId, assets, selectedSceneId, selectedShotId,
  sceneTitle, shotTitle, busy, onChanged }: {
  workspaceId: string; productionId: string;
  assets: Array<{ id: string; name: string; asset_type: string }>;
  selectedSceneId: string | null; selectedShotId: string | null;
  sceneTitle?: string | null; shotTitle?: string | null;
  busy: boolean; onChanged: () => void;
}) {
  const [vocabulary, setVocabulary] = useState<ContinuityVocabulary | null>(null);
  const [summary, setSummary] = useState<ContinuitySummary | null>(null);
  const [statements, setStatements] = useState<ContinuityStatementList | null>(null);
  const [chain, setChain] = useState<ContinuityChain | null>(null);
  const [findings, setFindings] = useState<ContinuityFindingList | null>(null);
  const [check, setCheck] = useState<ContinuityCheckResult | null>(null);
  const [severityFilter, setSeverityFilter] = useState<'' | ContinuitySeverity>('');
  const [showRetired, setShowRetired] = useState(false);
  const [working, setWorking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // The declaration form.
  const [subjectId, setSubjectId] = useState<string>(assets[0]?.id ?? '');
  const [domain, setDomain] = useState<ContinuityDomain>('character');
  const [trait, setTrait] = useState('');
  const [value, setValue] = useState('');
  const [anchor, setAnchor] = useState<ContinuityAnchor>('scene_ending');
  const [transition, setTransition] = useState<ContinuityTransition>('changed');
  const [reason, setReason] = useState('');

  const [reloadKey, setReloadKey] = useState(0);

  const anchorTargetId = anchor === 'shot' ? selectedShotId : anchor === 'production' ? null : selectedSceneId;
  const anchorReady = anchor === 'production' || Boolean(anchorTargetId);
  const anchorLabel = anchor === 'shot' ? (shotTitle ?? 'the selected Shot')
    : anchor === 'production' ? 'the whole Production' : `${sceneTitle ?? 'the selected Scene'} (${anchor === 'scene_opening' ? 'opening' : 'ending'})`;

  const refresh = useCallback(() => { setReloadKey(current => current + 1); onChanged(); }, [onChanged]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      productionContinuityService.vocabulary(workspaceId, productionId),
      productionContinuityService.summary(workspaceId, productionId),
      productionContinuityService.states(workspaceId, productionId, { includeRetired: showRetired }),
      productionContinuityService.findings(workspaceId, productionId, { severity: severityFilter || null }),
    ]).then(([vocab, summaryData, statementData, findingData]) => {
      if (!active) return;
      setVocabulary(vocab); setSummary(summaryData); setStatements(statementData); setFindings(findingData);
      setError(null);
    }).catch(failure => { if (active) setError(safeError(failure).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceId, productionId, showRetired, severityFilter, reloadKey]);

  const run = useCallback(async (action: () => Promise<string>) => {
    setWorking(true); setError(null); setNote(null);
    try { setNote(await action()); refresh(); }
    catch (failure) { setError(safeError(failure).message); }
    finally { setWorking(false); }
  }, [refresh]);

  const guard = busy || working;

  const loadChain = useCallback(() => run(async () => {
    const result = await productionContinuityService.chain(workspaceId, productionId, subjectId);
    setChain(result);
    return `${result.statement_count} recorded statement(s) for ${result.subject_label ?? 'this subject'}, in Production order.`;
  }), [workspaceId, productionId, subjectId, run]);

  const decide = (finding: ContinuityFinding, state: ContinuityFindingState) => run(async () => {
    const result = await productionContinuityService.updateFinding(workspaceId, productionId, finding.finding_id,
      { state, note: `Decided from Studio: ${state}.` });
    return result.note;
  });

  return <section className="cont" aria-label="Continuity">
    <header className="cont-head">
      <div>
        <p className="eyebrow">CONTINUITY</p>
        <h3>What does this Production say is true, and where does it stop adding up?</h3>
      </div>
      <div className="cont-rules">
        <p className="subtle">{vocabulary?.rule ?? 'Continuity is temporal: a change is declared, not inferred.'}</p>
        <p className="subtle">{vocabulary?.limitation ?? 'A check reads declarations; it does not analyse media.'}</p>
      </div>
    </header>

    {error && <div className="save-error" role="alert">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div>}
    {note && <p className="studio5-note" role="status">{note}</p>}

    {loading && !summary ? <LoadingState label="Reading this Production's continuity…" /> : null}

    {summary && <section className="cont-summary" aria-label="Continuity summary">
      <dl className="cont-counts">
        <div><dt>Live statements</dt><dd>{summary.live_states}</dd></div>
        <div><dt>Superseded or retired</dt><dd>{summary.retired_states}</dd></div>
        <div><dt>Subjects tracked</dt><dd>{summary.subject_count}</dd></div>
        <div><dt>Open findings</dt><dd>{summary.findings.open}</dd></div>
        <div><dt>Conflicts open</dt><dd>{summary.findings.critical_open}</dd></div>
      </dl>
      <p className="subtle" role="status">{summary.stale_label ?? 'Reading the recorded analysis…'}</p>
      {summary.check
        ? <p className="cont-verdict"><span className={`pill verdict-${summary.check.verdict}`}>{summary.check.verdict_label ?? summary.check.verdict}</span>
            {' '}{summary.check.summary ?? summary.check.explanation}
            {summary.check.is_current === false && <span className="subtle"> · {summary.check.freshness}</span>}</p>
        : <p className="studio5-empty">No continuity check has been recorded for this Production yet.</p>}
      {summary.domains.length > 0 && <p className="subtle">
        {summary.domains.map(item => `${item.label ?? item.domain} (${item.count})`).join(' · ')}</p>}
      <p className="subtle" role="note">{summary.limitations}</p>
    </section>}

    {vocabulary && <section className="cont-ruleset" aria-label="Deterministic continuity rules">
      <p className="eyebrow">WHAT THE CHECK LOOKS FOR</p>
      <ul>
        {vocabulary.rules.map(rule => <li key={rule.kind}>
          <span className={`pill sev-${rule.severity}`}>{rule.severity}</span> {rule.description}
        </li>)}
      </ul>
    </section>}

    <form className="cont-declare" onSubmit={event => {
      event.preventDefault();
      if (!trait.trim() || !value.trim() || !anchorReady) return;
      void run(async () => {
        const result = await productionContinuityService.recordStatement(workspaceId, productionId, {
          domain, trait: trait.trim(), value: value.trim(), anchor,
          subjectObjectId: subjectId || null,
          sceneId: anchor === 'scene_opening' || anchor === 'scene_ending' ? selectedSceneId : null,
          shotId: anchor === 'shot' ? selectedShotId : null,
          transition, reason: reason.trim(),
        });
        setTrait(''); setValue(''); setReason('');
        return result.note;
      });
    }}>
      <p className="eyebrow">RECORD WHAT IS TRUE AT THIS POINT</p>
      <div className="cont-controls">
        <label>Subject
          <select value={subjectId} aria-label="Continuity subject" onChange={event => { setSubjectId(event.target.value); setChain(null); }}>
            <option value="">The Production itself</option>
            {assets.map(asset => <option key={asset.id} value={asset.id}>{asset.name} · {asset.asset_type}</option>)}
          </select>
        </label>
        <label>Trait domain
          <select value={domain} aria-label="Continuity domain" onChange={event => setDomain(event.target.value as ContinuityDomain)}>
            {(vocabulary?.domains ?? []).map(item => <option key={item.domain} value={item.domain}>{item.label}</option>)}
          </select>
        </label>
        <label>Trait
          <input value={trait} maxLength={120} aria-label="Continuity trait" placeholder="shirt condition"
            onChange={event => setTrait(event.target.value)} />
        </label>
        <label>Value
          <input value={value} maxLength={400} aria-label="Continuity value" placeholder="blood on the left shoulder"
            onChange={event => setValue(event.target.value)} />
        </label>
        <label>Where
          <select value={anchor} aria-label="Continuity anchor" onChange={event => setAnchor(event.target.value as ContinuityAnchor)}>
            {ANCHOR_TARGETS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>How
          <select value={transition} aria-label="Continuity transition" onChange={event => setTransition(event.target.value as ContinuityTransition)}>
            {TRANSITIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
      </div>
      <label className="cont-reason">Why (needed when the trait changes)
        <textarea rows={2} maxLength={600} value={reason} aria-label="Continuity reason"
          placeholder="Marcus is injured during the kitchen scene." onChange={event => setReason(event.target.value)} />
      </label>
      <div className="cont-actions">
        <button type="submit" disabled={guard || !trait.trim() || !value.trim() || !anchorReady}>
          <ShieldCheck size={14} /> Record statement for {anchorLabel}
        </button>
        {!anchorReady && <span className="subtle" role="status">
          Choose a {anchor === 'shot' ? 'Shot' : 'Scene'} in Studio first — a {anchor === 'shot' ? 'Shot' : 'Scene'} statement names a real {anchor === 'shot' ? 'Shot' : 'Scene'}.</span>}
        {transition === 'changed' && !reason.trim() && <span className="subtle" role="status">
          A declared change with no reason is reported as a finding, so later Shots cannot be checked against it.</span>}
      </div>
    </form>

    <section className="cont-statements" aria-label="Recorded continuity statements">
      <p className="eyebrow">RECORDED STATEMENTS</p>
      <label className="cont-toggle">
        <input type="checkbox" checked={showRetired} onChange={event => setShowRetired(event.target.checked)} />
        Include superseded and retired statements
      </label>
      <p className="subtle" role="status">{statements
        ? `${statements.live} live statement(s)${showRetired ? ` · ${statements.total} including history` : ''}.`
        : 'Reading statements…'}</p>
      {statements && statements.items.length === 0
        ? <p className="studio5-empty">Nothing is recorded yet. Record the state of a trait at a point and TONDE can compare it with every later point.</p>
        : <table className="cont-table">
          <caption>One live statement per trait per point. A different value supersedes the older one, which stays readable.</caption>
          <thead><tr><th scope="col">Subject</th><th scope="col">Trait</th><th scope="col">Where</th><th scope="col">Value</th><th scope="col">Change</th><th scope="col">Origin</th><th scope="col">Action</th></tr></thead>
          <tbody>{(statements?.items ?? []).map(statement => <tr key={statement.state_id} className={statement.retired ? 'retired' : ''}>
            <td>{statement.subject_label ?? 'Production'}</td>
            <td>{statement.trait} <span className="subtle">· {statement.domain_label ?? statement.domain}</span></td>
            <td>{statement.anchor_label ?? statement.anchor}
              {statement.shot_label ? ` · ${statement.shot_label}` : statement.scene_label ? ` · ${statement.scene_label}` : ''}</td>
            <td>{statement.value}</td>
            <td>{statement.transition_label ?? statement.transition}
              {statement.reason ? <span className="subtle"> · {statement.reason}</span> : null}</td>
            <td>{statement.retired ? <span className="pill subtle">superseded</span> : (statement.origin_label ?? statement.origin)}</td>
            <td>{statement.retired
              ? <span className="subtle">{statement.retire_reason}</span>
              : <button type="button" disabled={guard} onClick={() => void run(async () => {
                  const result = await productionContinuityService.retireStatement(workspaceId, productionId,
                    statement.state_id, 'Retired from Studio.');
                  return result.note;
                })}><Undo2 size={12} /> Retire</button>}</td>
          </tr>)}</tbody>
        </table>}
      <p className="subtle" role="note">{statements?.limitation}</p>
    </section>

    <section className="cont-chain" aria-label="Continuity timeline">
      <p className="eyebrow">ONE SUBJECT'S TIMELINE</p>
      {!subjectId ? <p className="subtle">Choose a subject to read its timeline in Production order.</p>
        : <div className="cont-actions">
          <button type="button" disabled={guard} onClick={() => void loadChain()}><GitCompare size={14} /> Read timeline for {assets.find(a => a.id === subjectId)?.name ?? 'this subject'}</button>
          {chain && <span className="subtle" role="status">{chain.statement_count} statement(s), earliest first.</span>}
        </div>}
      {chain && (chain.statements.length === 0
        ? <p className="studio5-empty">No statement is recorded for this subject yet, so its continuity is unknown rather than consistent.</p>
        : <ol className="cont-timeline">
          {chain.statements.map(item => <li key={item.state_id}>
            <span className="pill subtle">{item.position_label}</span>
            <strong>{item.trait}</strong> · {item.value}
            <span className="pill subtle">{item.transition_label ?? item.transition}</span>
            {item.reason && <p className="subtle">{item.reason}</p>}
          </li>)}
        </ol>)}
      {chain && <p className="subtle" role="note">{chain.note}</p>}
    </section>

    <section className="cont-check" aria-label="Continuity check">
      <p className="eyebrow">RUN THE CHECK</p>
      <div className="cont-actions">
        <button type="button" disabled={guard} onClick={() => void run(async () => {
          const result = await productionContinuityService.check(workspaceId, productionId, 'Run from Studio.');
          setCheck(result);
          return result.explanation;
        })}><AlertTriangle size={14} /> Check this Production</button>
        <span className="subtle" role="status">A check records what the declarations say. It changes no statement, and it does not analyse media.</span>
      </div>
      {check && <div className="cont-checked" role="status">
        <p className="cont-verdict"><span className={`pill verdict-${check.verdict}`}>{check.verdict_label ?? check.verdict}</span> {check.explanation}</p>
        <p className="subtle">{check.finding_count} finding(s) · {check.state_count} live statement(s) at revision {check.production_revision}.</p>
        <p className="subtle">{check.rule}</p>
        <p className="subtle" role="note">{check.limitations}</p>
        <ul className="cont-findings">
          {check.findings.map(finding => <li key={finding.finding_id} className={finding.severity}>
            <span className={`pill sev-${finding.severity}`}>{finding.severity_label ?? finding.severity}</span>
            <strong>{finding.kind_label ?? finding.kind}</strong>
            <span className="subtle">{finding.subject_line ?? finding.trait}</span>
            <p className="subtle">{finding.explanation}</p>
            <p className="subtle">{finding.suggested_resolution}</p>
          </li>)}
        </ul>
      </div>}
    </section>

    <section className="cont-findings-section" aria-label="Open continuity findings">
      <p className="eyebrow">WHAT NEEDS A CREATOR DECISION</p>
      <label className="cont-filter">Show
        <select value={severityFilter} aria-label="Finding severity filter"
          onChange={event => setSeverityFilter(event.target.value as '' | ContinuitySeverity)}>
          <option value="">Everything</option>
          {SEVERITIES.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
      <p className="subtle" role="status">{findings?.open_label ?? 'Reading findings…'}</p>
      {findings?.check && <p className="subtle">
        Recorded check: {findings.check.verdict_label ?? findings.check.verdict} · {findings.check.freshness}</p>}
      {findings && findings.items.length === 0
        ? <p className="studio5-empty">Nothing is waiting. A clean result means the declarations agree — not that the footage is consistent.</p>
        : <ul className="cont-finding-list">
          {(findings?.items ?? []).map(finding => <li key={finding.finding_id} className={finding.severity}>
            <span className={`pill sev-${finding.severity}`}>{finding.severity_label ?? finding.severity}</span>
            <strong>{finding.kind_label ?? finding.kind}</strong>
            <span className={`pill ${finding.origin === 'inferred' ? 'inferred' : 'subtle'}`}>{finding.origin_label ?? finding.origin}</span>
            <span className="pill subtle">{finding.epistemic_label ?? finding.epistemic} · {finding.confidence}</span>
            <span className="pill subtle">{finding.state_label ?? finding.state}</span>
            <p className="subtle">{finding.explanation}</p>
            <p className="subtle">{finding.suggested_resolution}</p>
            {finding.rationale && <p className="subtle">Basis: {finding.rationale}</p>}
            {finding.resolved_at
              ? <p className="subtle"><Clock size={12} aria-hidden="true" /> Decided {finding.resolved_at}{finding.resolution_note ? ` · ${finding.resolution_note}` : ''}</p>
              : <div className="cont-actions">
                <button type="button" disabled={guard} onClick={() => void decide(finding, 'acknowledged')}>Acknowledge</button>
                <button type="button" disabled={guard} onClick={() => void decide(finding, 'resolved')}><CheckCircle2 size={12} /> Mark resolved</button>
                <button type="button" disabled={guard} onClick={() => void decide(finding, 'waived')}>Waive</button>
              </div>}
          </li>)}
        </ul>}
      <p className="subtle" role="note">{findings?.note}</p>
    </section>
  </section>;
}
