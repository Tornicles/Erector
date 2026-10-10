import { useCallback, useEffect, useState } from 'react';
import { BookOpen, BookmarkPlus, Library, Search, Undo2 } from 'lucide-react';
import { safeError } from '../services/errors';
import {
  CANDIDATE_SOURCES, SEARCH_KINDS, WRITABLE_ORIGINS, productionMemoryService,
  type MemoryCandidateList, type MemoryItemList, type MemoryKind, type MemoryPolicyList,
  type MemoryResolution, type MemoryScope, type MemorySource, type MemoryStateFilter,
  type MemorySummary, type MemoryVocabulary, type ProductionSearchResult, type SearchKind,
} from '../services/productionMemory';
import { LoadingState } from '../components/StateComponents';

/**
 * Production Memory: what TONDE remembers about making this Production, why it is using it, and how
 * to find anything in the Production by what it actually is.
 *
 * The screen is built around four deliberate separations. Memory is inspectable: every item shows
 * its statement, its kind, its scope, the object and revision it was drawn from, and whether it is
 * in force - an outranked item is labelled outranked rather than hidden, and `Why TONDE is using
 * this` names what a preference outranked. Nothing becomes reusable memory from a single Shot: a
 * pattern candidate is labelled a proposal, says what evidence it was observed on, and only the
 * memory policy or an explicit creator decision turns it into memory. An inference is labelled an
 * inference everywhere, including when a policy accepted it automatically. And search is
 * structured: it reads real columns and returns real object references, so it never claims to be
 * semantic search and it never claims to have looked at media.
 */

const SEARCH_KIND_LABELS: Record<SearchKind, string> = {
  shot: 'Shots', scene: 'Scenes', plan: 'Execution plans', result: 'Results',
  continuity_finding: 'Continuity findings', continuity_state: 'Continuity statements',
  memory: 'Memory', asset: 'Assets',
};

const APPROVALS: Array<{ value: string; label: string }> = [
  { value: 'not_approved', label: 'Not approved' },
  { value: 'draft', label: 'Draft' },
  { value: 'needs_review', label: 'Needs review' },
  { value: 'approved', label: 'Approved' },
  { value: 'changed_after_approval', label: 'Changed after approval' },
];

const EXECUTION_FACES: Array<{ value: string; label: string }> = [
  { value: 'real', label: 'Real Production' },
  { value: 'ai', label: 'AI Creation' },
  { value: 'hybrid', label: 'Hybrid' },
];

const RESULT_STATES = ['raw', 'needs_review', 'approved', 'rejected', 'final'];
const CONTINUITY_STATES = ['open', 'acknowledged', 'resolved', 'waived'];
const SEVERITIES: Array<{ value: string; label: string }> = [
  { value: 'critical', label: 'Conflict' },
  { value: 'warning', label: 'Caution' },
  { value: 'info', label: 'Note' },
];

export function ProductionMemoryCanvas({ workspaceId, productionId, assets, busy, onChanged }: {
  workspaceId: string; productionId: string;
  assets: Array<{ id: string; name: string; asset_type: string }>;
  busy: boolean; onChanged: () => void;
}) {
  const [vocabulary, setVocabulary] = useState<MemoryVocabulary | null>(null);
  const [summary, setSummary] = useState<MemorySummary | null>(null);
  const [items, setItems] = useState<MemoryItemList | null>(null);
  const [policies, setPolicies] = useState<MemoryPolicyList | null>(null);
  const [candidates, setCandidates] = useState<MemoryCandidateList | null>(null);
  const [resolution, setResolution] = useState<MemoryResolution | null>(null);
  const [searchResult, setSearchResult] = useState<ProductionSearchResult | null>(null);
  const [stateFilter, setStateFilter] = useState<MemoryStateFilter>('active');
  const [working, setWorking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Remember form.
  const [scope, setScope] = useState<MemoryScope>('production');
  const [kind, setKind] = useState<MemoryKind>('preference');
  const [subjectKey, setSubjectKey] = useState('');
  const [statement, setStatement] = useState('');
  const [source, setSource] = useState<MemorySource>('saved_preference');
  const [origin, setOrigin] = useState<'declared' | 'inferred'>('declared');
  const [sourceObjectId, setSourceObjectId] = useState('');
  const [basis, setBasis] = useState('');

  // Resolve form.
  const [resolveSubject, setResolveSubject] = useState('camera_movement');

  // Search form.
  const [searchText, setSearchText] = useState('');
  const [searchKinds, setSearchKinds] = useState<SearchKind[]>(['shot', 'scene']);
  const [searchAsset, setSearchAsset] = useState('');
  const [searchApproval, setSearchApproval] = useState('');
  const [searchFace, setSearchFace] = useState('');
  const [searchProvider, setSearchProvider] = useState('');
  const [searchLens, setSearchLens] = useState('');
  const [searchContinuity, setSearchContinuity] = useState('');
  const [searchSeverity, setSearchSeverity] = useState('');
  const [searchResultState, setSearchResultState] = useState('');
  const [searchMemoryKind, setSearchMemoryKind] = useState<'' | MemoryKind>('');

  const [reloadKey, setReloadKey] = useState(0);

  const refresh = useCallback(() => { setReloadKey(current => current + 1); onChanged(); }, [onChanged]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      productionMemoryService.vocabulary(workspaceId, productionId),
      productionMemoryService.summary(workspaceId, productionId),
      productionMemoryService.items(workspaceId, productionId, { state: stateFilter }),
      productionMemoryService.policies(workspaceId, productionId),
      productionMemoryService.candidates(workspaceId, productionId, { state: 'proposed' }),
    ]).then(([vocab, summaryData, itemData, policyData, candidateData]) => {
      if (!active) return;
      setVocabulary(vocab); setSummary(summaryData); setItems(itemData);
      setPolicies(policyData); setCandidates(candidateData);
      setError(null);
    }).catch(failure => { if (active) setError(safeError(failure).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceId, productionId, stateFilter, reloadKey]);

  const run = useCallback(async (action: () => Promise<string>) => {
    setWorking(true); setError(null); setNote(null);
    try { setNote(await action()); refresh(); }
    catch (failure) { setError(safeError(failure).message); }
    finally { setWorking(false); }
  }, [refresh]);

  const guard = busy || working;

  const remember = () => {
    const evidence = origin === 'inferred' ? [{ kind: 'note', text: basis.trim() }] : [];
    return run(async () => {
      const result = await productionMemoryService.recordItem(workspaceId, productionId, {
        scope, kind, subjectKey: subjectKey.trim(), statement: statement.trim(), source, origin,
        sourceObjectId: sourceObjectId || null,
        rationale: origin === 'inferred' ? basis.trim() : '',
        evidence,
      });
      setSubjectKey(''); setStatement(''); setBasis('');
      return `${result.note_text}${result.superseded_id ? ' The previous statement of this tier was kept as history.' : ''}`;
    });
  };

  const runSearch = () => run(async () => {
    const result = await productionMemoryService.search(workspaceId, productionId, {
      text: searchText.trim() || null,
      kinds: searchKinds,
      assetName: searchAsset.trim() || null,
      approval: searchApproval || null,
      executionMethod: searchFace || null,
      provider: searchProvider.trim() || null,
      lens: searchLens.trim() || null,
      continuityState: searchContinuity || null,
      severity: searchSeverity || null,
      resultState: searchResultState || null,
      memoryKind: searchMemoryKind || null,
    });
    setSearchResult(result);
    return `${result.total} real object(s) matched. ${result.interpretation.facet_line ?? ''}`.trim();
  });

  const productionPolicy = policies?.policies.find(entry => entry.scope === 'production') ?? null;

  return <section className="mem" aria-label="Production memory">
    <header className="mem-head">
      <div>
        <p className="eyebrow">PRODUCTION MEMORY</p>
        <h3>What does TONDE remember about making this Production, and why is it using it?</h3>
      </div>
      <div className="mem-rules">
        <p className="subtle">{vocabulary?.rule ?? 'Memory is inspectable production knowledge with real provenance.'}</p>
        <p className="subtle">{vocabulary?.limitation ?? 'Memory is what this Production recorded and what you confirmed.'}</p>
      </div>
    </header>

    {error && <div className="save-error" role="alert">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div>}
    {note && <p className="studio5-note" role="status">{note}</p>}

    {loading && !summary ? <LoadingState label="Reading what this Production remembers…" /> : null}

    {summary && <section className="mem-summary" aria-label="Memory summary">
      <dl className="mem-counts">
        <div><dt>Active memories</dt><dd>{summary.items.active}</dd></div>
        <div><dt>Confirmed by you</dt><dd>{summary.items.creator_confirmed}</dd></div>
        <div><dt>Inferred, unconfirmed</dt><dd>{summary.items.inferred}</dd></div>
        <div><dt>Subjects remembered</dt><dd>{summary.items.subjects}</dd></div>
        <div><dt>Archived history</dt><dd>{summary.items.archived}</dd></div>
        <div><dt>Waiting for a decision</dt><dd>{summary.candidates.proposed}</dd></div>
      </dl>
      <p className="subtle" role="status">{summary.summary_line ?? ''} {summary.candidate_line ?? ''}</p>
      <p className="subtle" role="status">{summary.changed_line ?? ''}</p>
      {summary.policy && <p className="subtle">
        <span className="pill subtle">{summary.policy.explicit_label ?? (summary.policy.explicit ? 'Set by you' : 'Default policy')}</span>{' '}
        {summary.policy.capture_label ?? ''} {summary.policy.accept_label ?? ''}</p>}
      <p className="subtle" role="note">{summary.limitations}</p>
    </section>}

    {vocabulary && <section className="mem-authority" aria-label="Memory authority">
      <p className="eyebrow">WHICH MEMORY WINS</p>
      <ol className="mem-tiers">
        {vocabulary.sources.map(entry => <li key={entry.source}>
          <span className="pill subtle">Tier {entry.authority_rank}</span> {entry.label}
          {entry.authority_rank === 5 && <span className="subtle"> · inferred and unconfirmed</span>}
        </li>)}
      </ol>
      <p className="subtle" role="note">{vocabulary.authority_rule}</p>
    </section>}

    <form className="mem-remember" onSubmit={event => { event.preventDefault(); if (!subjectKey.trim() || !statement.trim()) return; void remember(); }}>
      <p className="eyebrow">REMEMBER SOMETHING</p>
      <div className="mem-controls">
        <label>Scope
          <select value={scope} aria-label="Memory scope" onChange={event => setScope(event.target.value as MemoryScope)}>
            {(vocabulary?.scopes ?? [{ scope: 'production' as MemoryScope, label: 'This Production' }])
              .map(item => <option key={item.scope} value={item.scope}>{item.label}</option>)}
          </select>
        </label>
        <label>Kind
          <select value={kind} aria-label="Memory kind" onChange={event => setKind(event.target.value as MemoryKind)}>
            {(vocabulary?.kinds ?? []).map(item => <option key={item.kind} value={item.kind}>{item.label}</option>)}
          </select>
        </label>
        <label>Subject
          <input value={subjectKey} maxLength={160} aria-label="Memory subject key" placeholder="camera_movement"
            onChange={event => setSubjectKey(event.target.value)} />
        </label>
        <label>Authority
          <select value={source} aria-label="Memory source" onChange={event => setSource(event.target.value as MemorySource)}>
            {(vocabulary?.sources ?? []).map(item => <option key={item.source} value={item.source}>{item.label}</option>)}
          </select>
        </label>
        <label>Origin
          <select value={origin} aria-label="Memory origin" onChange={event => setOrigin(event.target.value as 'declared' | 'inferred')}>
            {WRITABLE_ORIGINS.map(value => <option key={value} value={value}>
              {vocabulary?.origins.find(item => item.origin === value)?.label ?? value}</option>)}
          </select>
        </label>
        <label>Drawn from
          <select value={sourceObjectId} aria-label="Memory source object" onChange={event => setSourceObjectId(event.target.value)}>
            <option value="">Nothing specific</option>
            {(assets ?? []).map(asset => <option key={asset.id} value={asset.id}>{asset.name} · {asset.asset_type}</option>)}
          </select>
        </label>
      </div>
      <label className="mem-statement">What should TONDE remember?
        <textarea rows={2} maxLength={600} value={statement} aria-label="Memory statement"
          placeholder="For this kitchen, keep the key light soft and from camera left."
          onChange={event => setStatement(event.target.value)} />
      </label>
      {origin === 'inferred' && <label className="mem-statement">Basis (an inference has to show its evidence)
        <textarea rows={2} maxLength={800} value={basis} aria-label="Memory basis"
          placeholder="Observed on two accepted Results of this Production."
          onChange={event => setBasis(event.target.value)} />
      </label>}
      <div className="mem-actions">
        <button type="submit" disabled={guard || !subjectKey.trim() || !statement.trim() || (origin === 'inferred' && !basis.trim())}>
          <BookmarkPlus size={14} /> Remember this
        </button>
        {origin === 'inferred' && source === 'creator_instruction' && <span className="subtle" role="status">
          An inference cannot claim your authority — choose a saved preference, a historical pattern or an inference as the source.</span>}
        {origin === 'inferred' && !basis.trim() && <span className="subtle" role="status">
          An inference without a basis is refused, so give the evidence it came from.</span>}
        {source === 'creator_instruction' && origin === 'declared' && <span className="subtle" role="status">
          This outranks every earlier preference, decision and pattern for this subject.</span>}
      </div>
    </form>

    <section className="mem-items" aria-label="Remembered items">
      <p className="eyebrow">WHAT TONDE REMEMBERS</p>
      <label className="mem-filter">Show
        <select value={stateFilter} aria-label="Memory state filter" onChange={event => setStateFilter(event.target.value as MemoryStateFilter)}>
          <option value="active">Active</option>
          <option value="archived">Archived history</option>
          <option value="all">Everything</option>
        </select>
      </label>
      <p className="subtle" role="status">{items ? `${items.total} remembered item(s).` : 'Reading memory…'}</p>
      {items && items.items.length === 0
        ? <p className="studio5-empty">Nothing is remembered yet. TONDE starts from what you tell it and from candidates you accept — never from a hidden profile.</p>
        : <table className="mem-table">
          <caption>Every item shows its tier, the object it was drawn from, and whether it is in force.</caption>
          <thead><tr><th scope="col">Statement</th><th scope="col">Kind</th><th scope="col">Scope</th><th scope="col">Authority</th><th scope="col">In force</th><th scope="col">Source</th><th scope="col">Action</th></tr></thead>
          <tbody>{(items?.items ?? []).map(item => <tr key={item.item_id} className={item.retired_at ? 'retired' : ''}>
            <td>{item.statement}{item.rationale ? <span className="subtle"> · {item.rationale}</span> : null}
              <span className="subtle"> · {item.subject_key}</span></td>
            <td>{item.kind_label ?? item.kind}</td>
            <td>{item.scope_label ?? item.scope}</td>
            <td>{item.authority_line ?? `Tier ${item.authority_rank}`}</td>
            <td>{item.retired_at
              ? <span className="pill subtle">archived</span>
              : <span className={`pill ${item.in_force ? 'in-force' : 'outranked'}`}>{item.force_line ?? (item.in_force ? 'In force' : 'Outranked')}</span>}</td>
            <td>{item.source_object_label ?? '—'}
              {item.source_line ? <span className="subtle"> · {item.source_line}</span> : null}
              {item.origin === 'inferred' ? <span className="pill inferred">inferred</span> : null}</td>
            <td>{item.retired_at
              ? <span className="subtle">{item.retire_reason}</span>
              : <div className="mem-actions">
                <button type="button" disabled={guard} onClick={() => void run(async () => {
                  const result = await productionMemoryService.retireItem(workspaceId, productionId, item.item_id,
                    'Retired from Studio.');
                  return result.note_text;
                })}><Undo2 size={12} /> Retire</button>
                <button type="button" onClick={() => { setResolveSubject(item.subject_key); void run(async () => {
                  const result = await productionMemoryService.resolve(workspaceId, productionId, item.subject_key);
                  setResolution(result);
                  return result.explanation;
                }); }}><BookOpen size={12} /> Why this?</button>
              </div>}</td>
          </tr>)}</tbody>
        </table>}
      <p className="subtle" role="note">{items?.note}</p>
    </section>

    <section className="mem-resolve" aria-label="Why TONDE is using this">
      <p className="eyebrow">WHY IS TONDE USING THIS?</p>
      <div className="mem-actions">
        <label className="mem-filter">Subject
          <input value={resolveSubject} maxLength={160} aria-label="Resolution subject key"
            onChange={event => setResolveSubject(event.target.value)} />
        </label>
        <button type="button" disabled={guard || !resolveSubject.trim()} onClick={() => void run(async () => {
          const result = await productionMemoryService.resolve(workspaceId, productionId, resolveSubject.trim());
          setResolution(result);
          return result.explanation;
        })}><Library size={14} /> Explain the memory for this subject</button>
      </div>
      {resolution && <div className="mem-resolved" role="status">
        <p><strong>{resolution.explanation}</strong></p>
        {resolution.resolved
          ? <p className="subtle">In force: {resolution.resolved.statement}</p>
          : <p className="subtle">Nothing is being reused for this subject.</p>}
        {resolution.considered.length > 0 && <ul className="mem-considered">
          {resolution.considered.map(entry => <li key={entry.item_id}>
            <span className={`pill ${entry.in_force ? 'in-force' : 'outranked'}`}>{entry.force_line ?? (entry.in_force ? 'In force' : 'Outranked')}</span>
            <span className="subtle">{entry.authority_line ?? `Tier ${entry.authority_rank}`}</span> {entry.statement}
          </li>)}
        </ul>}
        {resolution.note_text && <p className="subtle" role="note">{resolution.note_text}</p>}
      </div>}
    </section>

    <section className="mem-candidates" aria-label="Successful pattern candidates">
      <p className="eyebrow">PATTERNS TONDE NOTICED — NOTHING IS REMEMBERED UNTIL YOU DECIDE</p>
      {productionPolicy && <div className="mem-policy">
        <p className="subtle">Memory policy for this Production:
          {' '}<span className="pill subtle">{productionPolicy.explicit ? 'Set by you' : 'Default policy'}</span>
          {' '}{productionPolicy.capture_label ?? ''} {productionPolicy.accept_label ?? ''}</p>
        <div className="mem-actions">
          <button type="button" disabled={guard} onClick={() => void run(async () => {
            const result = await productionMemoryService.setPolicy(workspaceId, productionId, {
              scope: 'production', candidateCapture: !productionPolicy.candidate_capture,
              autoAcceptCandidates: productionPolicy.auto_accept_candidates,
              note: productionPolicy.note,
            });
            return result.capture_label ?? 'Memory policy updated.';
          })}>{productionPolicy.candidate_capture ? 'Stop recording candidates here' : 'Allow candidate recording here'}</button>
          <button type="button" disabled={guard} onClick={() => void run(async () => {
            const result = await productionMemoryService.setPolicy(workspaceId, productionId, {
              scope: 'production', candidateCapture: true,
              autoAcceptCandidates: !productionPolicy.auto_accept_candidates,
              note: productionPolicy.note,
            });
            return 'Memory policy updated.';
          })}>{productionPolicy.auto_accept_candidates
            ? 'Require my decision before something becomes memory'
            : 'Accept candidates automatically in this scope'}</button>
        </div>
        {productionPolicy.auto_accept_candidates && <p className="subtle" role="status">
          Automatically accepted candidates are remembered as inferences, never as your confirmation.</p>}
      </div>}
      <p className="subtle" role="status">{candidates ? `${candidates.total} candidate(s) waiting.` : 'Reading candidates…'}</p>
      {candidates && candidates.items.length === 0
        ? <p className="studio5-empty">No pattern is waiting for a decision. A candidate needs real evidence before TONDE will even propose one.</p>
        : <ul className="mem-candidate-list">
          {(candidates?.items ?? []).map(candidate => <li key={candidate.candidate_id}>
            <span className="pill inferred">{candidate.proposed_source_label ?? candidate.proposed_source}</span>
            <span className="pill subtle">{candidate.state_label ?? candidate.state}</span>
            <strong>{candidate.statement}</strong>
            <p className="subtle">{candidate.kind_label ?? candidate.kind} · observed {candidate.observed_count} time(s)
              {candidate.source_object_label ? ` · drawn from ${candidate.source_object_label} at revision ${candidate.source_revision}` : ''}</p>
            {candidate.source_line && <p className="subtle">{candidate.source_line}</p>}
            {candidate.decision_note && <p className="subtle">{candidate.decision_note}</p>}
            {candidate.state === 'proposed' && <div className="mem-actions">
              <button type="button" disabled={guard} onClick={() => void run(async () => {
                const result = await productionMemoryService.decideCandidate(workspaceId, productionId, candidate.candidate_id,
                  { decision: 'accept', note: 'Accepted from Studio.' });
                return result.note_text;
              })}>Accept as memory</button>
              <button type="button" disabled={guard} onClick={() => void run(async () => {
                const result = await productionMemoryService.decideCandidate(workspaceId, productionId, candidate.candidate_id,
                  { decision: 'dismiss', note: 'Dismissed from Studio.' });
                return result.note_text;
              })}>Dismiss</button>
            </div>}
          </li>)}
        </ul>}
      <p className="subtle" role="note">{candidates?.note}</p>
    </section>

    <section className="mem-search" aria-label="Structured production search">
      <p className="eyebrow">FIND ANYTHING BY WHAT IT ACTUALLY IS</p>
      <fieldset className="mem-kinds">
        <legend>What to search</legend>
        {SEARCH_KINDS.map(value => <label key={value}>
          <input type="checkbox" checked={searchKinds.includes(value)} aria-label={`Search ${SEARCH_KIND_LABELS[value]}`}
            onChange={event => setSearchKinds(current => event.target.checked
              ? [...current, value] : current.filter(item => item !== value))} />
          {SEARCH_KIND_LABELS[value]}
        </label>)}
      </fieldset>
      <div className="mem-controls">
        <label>Words
          <input value={searchText} maxLength={400} aria-label="Search text" placeholder="kitchen reveal"
            onChange={event => setSearchText(event.target.value)} />
        </label>
        <label>Character or Product
          <input value={searchAsset} maxLength={160} aria-label="Search Asset name" placeholder="Marcus"
            onChange={event => setSearchAsset(event.target.value)} />
        </label>
        <label>Approval
          <select value={searchApproval} aria-label="Search approval" onChange={event => setSearchApproval(event.target.value)}>
            <option value="">Any</option>
            {APPROVALS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>Execution
          <select value={searchFace} aria-label="Search execution method" onChange={event => setSearchFace(event.target.value)}>
            <option value="">Any face</option>
            {EXECUTION_FACES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>AI provider
          <input value={searchProvider} maxLength={120} aria-label="Search provider" placeholder="veo"
            onChange={event => setSearchProvider(event.target.value)} />
        </label>
        <label>Lens
          <input value={searchLens} maxLength={120} aria-label="Search lens" placeholder="50mm"
            onChange={event => setSearchLens(event.target.value)} />
        </label>
        <label>Continuity
          <select value={searchContinuity} aria-label="Search continuity state" onChange={event => setSearchContinuity(event.target.value)}>
            <option value="">Any continuity state</option>
            {CONTINUITY_STATES.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>Severity
          <select value={searchSeverity} aria-label="Search severity" onChange={event => setSearchSeverity(event.target.value)}>
            <option value="">Any severity</option>
            {SEVERITIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>Result state
          <select value={searchResultState} aria-label="Search result state" onChange={event => setSearchResultState(event.target.value)}>
            <option value="">Any Result state</option>
            {RESULT_STATES.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>Memory kind
          <select value={searchMemoryKind} aria-label="Search memory kind"
            onChange={event => setSearchMemoryKind(event.target.value as '' | MemoryKind)}>
            <option value="">Any memory kind</option>
            {(vocabulary?.kinds ?? []).map(item => <option key={item.kind} value={item.kind}>{item.label}</option>)}
          </select>
        </label>
      </div>
      <div className="mem-actions">
        <button type="button" disabled={guard} onClick={() => void runSearch()}><Search size={14} /> Search this Production</button>
        <span className="subtle" role="status">{vocabulary?.search_limitation
          ?? 'Search reads structured production state and returns real object references.'}</span>
      </div>
      {searchResult && <div className="mem-results" role="status">
        <p className="subtle">{searchResult.total} object(s) matched · {searchResult.returned} shown
          {searchResult.truncated ? ' · more exist than are shown' : ''}.</p>
        <p className="subtle">{searchResult.interpretation.facet_line}</p>
        {searchResult.lanes.length > 0 && <p className="subtle">
          {searchResult.lanes.map(lane => `${lane.label ?? lane.lane}: ${lane.total}`).join(' · ')}</p>}
        {searchResult.results.length === 0
          ? <p className="studio5-empty">Nothing matched. A filter that names a Character or Product which does not exist returns nothing rather than everything.</p>
          : <ul className="mem-result-list">
            {searchResult.results.map(item => <li key={`${item.entity_type}-${item.entity_id}`}>
              <span className="pill subtle">{item.entity_label ?? item.entity_type}</span>
              <strong>{item.label}</strong>
              {item.context && <span className="subtle"> · {item.context}</span>}
              {item.state && <span className="pill subtle">{item.state_label ?? item.state}</span>}
              {item.in_force !== undefined && <span className={`pill ${item.in_force ? 'in-force' : 'outranked'}`}>
                {item.in_force ? 'In force' : 'Outranked'}</span>}
              {item.detail && <p className="subtle">{item.detail}</p>}
              <p className="subtle">Matched on: {item.matched_on ?? item.entity_type}</p>
            </li>)}
          </ul>}
        {searchResult.notes.map(text => <p className="subtle" key={text} role="note">{text}</p>)}
      </div>}
    </section>
  </section>;
}
