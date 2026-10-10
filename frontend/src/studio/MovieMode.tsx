import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown, ArrowUp, CheckCircle2, ChevronRight, Layers, Lock, Plus, Search, SplitSquareHorizontal, Unlock,
} from 'lucide-react';
import { safeError } from '../services/errors';
import {
  longFormService, type LongFormDirectorAnswer, type LongFormTiming, type SearchItem, type StructureItem,
  type StructureLevel, type StructurePage, type StructureSummaryRow,
} from '../services/longForm';
import { formatMs, approvalLabel } from './StudioTimeline';
import { LoadingState } from '../components/StateComponents';

/**
 * Movie Mode: the long-form hierarchy navigator for ONE Master Production.
 *
 * Production -> Act -> Sequence -> Scene -> Shot is loaded one bounded level at a time, so a
 * 90-minute film is never expanded eagerly. Runtime rollups are calculated from real Shots and
 * reported against the planned target with the real gap, and a locked Act or Sequence can only
 * be changed after an explicit unlock.
 */

type TrailStep = { level: 'act' | 'sequence' | 'scene'; id: string; title: string; revision: number };
type Zoom = 'act' | 'sequence' | 'scene' | 'shot';

const ZOOMS: Array<{ zoom: Zoom; label: string; needs: number }> = [
  { zoom: 'act', label: 'Act', needs: 0 },
  { zoom: 'sequence', label: 'Sequence', needs: 1 },
  { zoom: 'scene', label: 'Scene', needs: 1 },
  { zoom: 'shot', label: 'Shot', needs: 3 },
];

const VIEW_LABEL: Record<StructureLevel, string> = {
  production: 'Acts of this Production', act: 'Sequences and Scenes of this Act',
  sequence: 'Scenes of this Sequence', scene: 'Shots of this Scene', shot: 'Shots',
};

export function MovieModeCanvas({ workspaceId, productionId, selectedSceneId, selectedShotId,
  onSelectScene, onSelectShot, onChanged, busy }: {
  workspaceId: string; productionId: string;
  selectedSceneId: string | null; selectedShotId: string | null;
  onSelectScene: (sceneId: string) => void; onSelectShot: (sceneId: string, shotId: string) => void;
  onChanged: () => void; busy: boolean;
}) {
  const [trail, setTrail] = useState<TrailStep[]>([]);
  const [page, setPage] = useState<StructurePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [summaries, setSummaries] = useState<StructureSummaryRow[]>([]);

  const [actTitle, setActTitle] = useState('');
  const [actGoal, setActGoal] = useState('');
  const [sequenceTitle, setSequenceTitle] = useState('');
  const [sequenceKind, setSequenceKind] = useState('narrative');
  const [summaryText, setSummaryText] = useState('');
  const [query, setQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [methodFilter, setMethodFilter] = useState('');
  const [results, setResults] = useState<SearchItem[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [directorText, setDirectorText] = useState('');
  const [directorAnswer, setDirectorAnswer] = useState<LongFormDirectorAnswer | null>(null);

  const scopeStep = trail[trail.length - 1] ?? null;
  const view = useMemo<{ level: StructureLevel; scopeId: string | null }>(() => {
    if (!scopeStep) return { level: 'production', scopeId: null };
    return { level: scopeStep.level, scopeId: scopeStep.id };
  }, [scopeStep]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setPage(await longFormService.structure(workspaceId, productionId, { level: view.level, scopeId: view.scopeId, limit: 50 }));
    } catch (failure) { setPage(null); setError(safeError(failure).message); }
    finally { setLoading(false); }
  }, [workspaceId, productionId, view.level, view.scopeId]);

  useEffect(() => { void load(); }, [load, reloadKey]);
  useEffect(() => {
    let active = true;
    longFormService.summaries(workspaceId, productionId).then(data => { if (active) setSummaries(data.items); }).catch(() => { if (active) setSummaries([]); });
    return () => { active = false; };
  }, [workspaceId, productionId, reloadKey]);

  const refresh = useCallback(() => { setReloadKey(value => value + 1); onChanged(); }, [onChanged]);
  const run = useCallback(async (action: () => Promise<unknown>, describe: (result: unknown) => string) => {
    setWorking(true); setError(null); setNote(null);
    try {
      const result = await action();
      setNote(describe(result)); refresh();
      return result;
    } catch (failure) {
      setError(safeError(failure).message);
      return null;
    } finally { setWorking(false); }
  }, [refresh]);

  const items = page?.items ?? [];
  const timing = page?.timing ?? null;
  const guard = busy || working;
  const barLevel: StructureLevel = items.length > 0 ? items[0].level : (view.level === 'production' ? 'act' : view.level);

  const drill = (item: StructureItem) => {
    if (item.level === 'shot') {
      if (scopeStep?.level === 'scene') onSelectShot(scopeStep.id, item.id);
      return;
    }
    if (item.level === 'scene') {
      onSelectScene(item.id);
      setTrail(current => [...current, { level: 'scene', id: item.id, title: item.title, revision: item.revision }]);
      return;
    }
    if (item.level === 'sequence') {
      setTrail(current => {
        const act = current.find(step => step.level === 'act');
        return [...(act ? [act] : []), { level: 'sequence', id: item.id, title: item.title, revision: item.revision }];
      });
      return;
    }
    setTrail([{ level: 'act', id: item.id, title: item.title, revision: item.revision }]);
  };

  // The semantic timeline zoom moves through Production -> Act -> Sequence -> Scene -> Shot.
  // Each zoom shows one real level of the hierarchy; it never invents a flattened summary.
  const setZoom = (zoom: Zoom) => {
    setTrail(current => {
      const act = current.find(step => step.level === 'act');
      const sequence = current.find(step => step.level === 'sequence');
      const scene = current.find(step => step.level === 'scene');
      if (zoom === 'act') return [];
      if (zoom === 'sequence') return act ? [act] : [];
      if (zoom === 'scene') return sequence ? [act!, sequence] : act ? [act] : [];
      return scene ? ([act, sequence, scene].filter(Boolean) as TrailStep[]) : current;
    });
  };

  const zoomReady = (zoom: Zoom) => trail.filter(step => step.level === 'act').length >= (zoom === 'act' ? 0 : 1)
    && (zoom !== 'shot' || Boolean(selectedSceneId ?? trail.find(step => step.level === 'scene')));

  const total = timing?.production?.calculated_ms ?? 0;
  const target = timing?.production?.target_ms ?? null;

  return <section className="movie-mode" aria-label="Movie Mode">
    <header className="movie-mode-head">
      <div>
        <p className="eyebrow">MOVIE MODE</p>
        <h3>Long-form structure</h3>
      </div>
      {timing && <dl className="movie-mode-timing" aria-label="Runtime rollup">
        <div><dt>Planned target</dt><dd>{timing.production?.target_label ?? 'not set'}</dd></div>
        <div><dt>Calculated from children</dt><dd>{timing.production?.calculated_label ?? '—'}</dd></div>
        <div><dt>Real difference</dt><dd className={timing.production?.status === 'fits' ? '' : 'studio5-warn'}>
          {timing.production?.delta_ms === null || timing.production?.delta_ms === undefined ? '—'
            : `${timing.production.delta_ms > 0 ? 'over by ' : 'under by '}${timing.production.delta_label ?? formatMs(Math.abs(timing.production.delta_ms))}`}
        </dd></div>
        <div><dt>Counts</dt><dd>{(timing.counts?.acts ?? 0)} Acts · {(timing.counts?.sequences ?? 0)} Sequences · {(timing.counts?.scenes ?? 0)} Scenes · {(timing.counts?.shots ?? 0)} Shots</dd></div>
      </dl>}
    </header>

    <nav className="movie-mode-breadcrumb" aria-label="Structure breadcrumb">
      <button type="button" aria-current={trail.length === 0 ? 'page' : undefined} onClick={() => setTrail([])}>
        <Layers size={14} /> {page?.breadcrumb[0]?.title ?? 'Production'}</button>
      {trail.map(step => <span key={`${step.level}-${step.id}`}>
        <ChevronRight size={13} aria-hidden="true" />
        <button type="button" aria-current={scopeStep?.id === step.id ? 'page' : undefined}
          onClick={() => setTrail(current => current.slice(0, current.findIndex(item => item.id === step.id) + 1))}>
          {step.title}</button>
      </span>)}
    </nav>

    <div className="movie-mode-controls">
      <div className="studio5-zoom" role="group" aria-label="Semantic timeline zoom">
        {ZOOMS.map(({ zoom, label }) => <button key={zoom} type="button" disabled={!zoomReady(zoom)}
          aria-pressed={barLevel === zoom || (zoom === 'act' && view.level === 'production')}
          className={barLevel === zoom || (zoom === 'act' && view.level === 'production') ? 'selected' : ''}
          onClick={() => setZoom(zoom)}>{label}</button>)}
      </div>
      <p className="subtle" role="status">Showing {VIEW_LABEL[page?.level ?? 'production']} · one level at a time. {page?.lazy ?? ''}</p>
    </div>

    {error && <div className="save-error" role="alert">{error}<button onClick={() => setError(null)}>Dismiss</button></div>}
    {note && <p className="studio5-note" role="status">{note}</p>}

    {loading && !page ? <LoadingState label="Reading this Production's structure…" />
      : !page ? null
        : <>
          <ol className="movie-mode-bars" aria-label="Structure timeline">
            {items.length === 0 && <li className="studio5-empty">No structure at this level yet. Add an Act, or ask the Director to plan it — nothing is invented here.</li>}
            {items.map((item, index, all) => {
              const share = total > 0 ? Math.max(2, Math.round(((item.calculated_duration_ms ?? 0) / total) * 100)) : Math.max(2, Math.round(100 / Math.max(1, all.length)));
              const selected = item.id === selectedSceneId || item.id === selectedShotId;
              return <li key={item.id} style={{ flexBasis: `${share}%` }}>
                <button type="button" className={`movie-mode-bar ${selected ? 'selected' : ''}`}
                  aria-pressed={selected} aria-label={`${item.display}: ${item.title}, ${item.label ?? formatMs(item.calculated_duration_ms ?? 0)}, ${approvalLabel(item.approval)}`}
                  onClick={() => drill(item)}>
                  <span className="movie-mode-bar-level">{item.display}</span>
                  <span className="movie-mode-bar-title">{item.title}</span>
                  <span className="movie-mode-bar-duration">{item.label ?? formatMs(item.calculated_duration_ms ?? 0)}</span>
                  <span className={`movie-mode-bar-status status-${item.status ?? 'fits'}`}>{item.status === 'fits' ? 'fits' : item.status === 'unresolved' ? 'timing unknown' : `${item.status} by ${formatMs(Math.abs(item.delta_ms ?? 0))}`}</span>
                </button>
              </li>;
            })}
          </ol>

          {timing?.conflicts && timing.conflicts.length > 0 && <div className="studio5-runtime-warning" role="status">
            <strong>Target and child total differ</strong>
            <ul>{timing.conflicts.map(conflict => <li key={conflict.id}>{conflict.title}: planned {formatMs(conflict.target_ms ?? 0)},
              children {formatMs(conflict.calculated_ms ?? 0)} — {conflict.over_by_label ? `${conflict.over_by_label} over` : 'difference'}. {conflict.reason}</li>)}</ul>
          </div>}

          <ul className="movie-mode-list" aria-label="Structure objects">
            {items.map(item => {
              const summary = item.summary;
              // Reordering is scoped to this item's own level, so an Act's position is never
              // confused with a Sequence's when both appear on the same page.
              const sameLevel = items.filter(row => row.level === item.level);
              const position = sameLevel.findIndex(row => row.id === item.id);
              return <li key={`row-${item.id}`} className={item.locked ? 'locked' : ''}>
                <div className="movie-mode-row-head">
                  <strong>{item.display} · {item.title}</strong>
                  <span className="pill">{approvalLabel(item.approval)}</span>
                  {item.locked && <span className="pill"><Lock size={11} /> locked</span>}
                  {item.depth_label && <span className="pill subtle">{item.depth_label}</span>}
                  <span className="pill subtle">{item.label ?? formatMs(item.calculated_duration_ms ?? 0)}</span>
                  {Object.entries(item.child_counts ?? {}).map(([child, count]) => <span key={child} className="pill subtle">{count} {child}</span>)}
                </div>
                {item.purpose && <p className="subtle">{item.purpose}</p>}
                {summary && <p className="movie-mode-summary">
                  <span className={summary.stale ? 'studio5-warn' : ''}>{summary.stale_label ?? (summary.stale ? 'STALE' : 'CURRENT')}</span>
                  {summary.text ? <> · {summary.text}</> : ' · no summary text yet'}
                  {summary.source_revision ? <span className="subtle"> · derived from revision {summary.source_revision}</span> : null}
                </p>}
                <div className="movie-mode-actions">
                  {(['act', 'sequence'] as Array<'act' | 'sequence'>).includes(item.level as 'act' | 'sequence') && <>
                    <button type="button" disabled={guard} onClick={() => void run(
                      () => longFormService.setApproval(workspaceId, productionId, {
                        level: item.level as 'act' | 'sequence', id: item.id,
                        approval: item.approval === 'approved' ? 'needs_review' : 'approved', expectedRevision: item.revision }),
                      result => `${item.display} is now ${approvalLabel(String((result as { approval?: string }).approval ?? item.approval))}.`)}>
                      <CheckCircle2 size={13} /> {item.approval === 'approved' ? 'Reopen for review' : 'Approve'}</button>
                    <button type="button" disabled={guard} onClick={() => void run(
                      () => longFormService.setLock(workspaceId, productionId, {
                        level: item.level as 'act' | 'sequence', id: item.id, locked: !item.locked, expectedRevision: item.revision }),
                      result => `${item.display} is ${(result as { locked?: boolean }).locked ? 'locked' : 'unlocked'}.`)}>
                      {item.locked ? <Unlock size={13} /> : <Lock size={13} />} {item.locked ? 'Unlock' : 'Lock'}</button>
                    <button type="button" disabled={guard || position === 0} aria-label={`Move ${item.display} earlier`}
                      onClick={() => void run(() => longFormService.reorder(workspaceId, productionId, {
                        level: item.level as 'act' | 'sequence',
                        orderedIds: moveWithin(sameLevel.map(row => row.id), item.id, -1),
                        expectedStructureRevision: page.structure_revision,
                        parentId: item.level === 'sequence' ? scopeStep?.id ?? null : null,
                      }), () => `${item.display} moved earlier.`)}><ArrowUp size={13} /></button>
                    <button type="button" disabled={guard || position === sameLevel.length - 1}
                      aria-label={`Move ${item.display} later`}
                      onClick={() => void run(() => longFormService.reorder(workspaceId, productionId, {
                        level: item.level as 'act' | 'sequence',
                        orderedIds: moveWithin(sameLevel.map(row => row.id), item.id, 1),
                        expectedStructureRevision: page.structure_revision,
                        parentId: item.level === 'sequence' ? scopeStep?.id ?? null : null,
                      }), () => `${item.display} moved later.`)}><ArrowDown size={13} /></button>
                  </>}
                  {item.level === 'scene' && view.level === 'act' && <>
                    <label>Move to Sequence
                      <select disabled={guard} defaultValue="" aria-label={`Move ${item.title} to a Sequence`}
                        onChange={event => { const target = event.target.value; if (!target) return;
                          void run(() => longFormService.moveScene(workspaceId, productionId, item.id, {
                            expectedRevision: item.revision, sequenceId: target === 'none' ? null : target, actId: scopeStep?.id ?? null }),
                          () => 'Moved the Scene. Its UUID and Shots are preserved.'); }}>
                        <option value="">Choose…</option>
                        {items.filter(row => row.level === 'sequence').map(row => <option key={row.id} value={row.id}>{row.display} · {row.title}</option>)}
                        <option value="none">No Sequence (directly in the Act)</option>
                      </select></label>
                    <button type="button" disabled={guard} onClick={() => void run(
                      () => longFormService.split(workspaceId, productionId, { level: 'act', id: scopeStep!.id,
                        splitOrder: item.order, expectedRevision: scopeStep!.revision, title: `${scopeStep!.title} B` }),
                      () => 'Split the Act at this Scene. No Scene or Shot was duplicated.')}>
                      <SplitSquareHorizontal size={13} /> Split Act here</button>
                  </>}
                  {(item.level === 'scene' || item.level === 'shot') && <button type="button"
                    onClick={() => drill(item)}>Open</button>}
                </div>
              </li>;
            })}
          </ul>

          <div className="movie-mode-writes">
            {view.level === 'production' && <form onSubmit={event => { event.preventDefault(); if (!actTitle.trim()) return;
              void run(() => longFormService.createAct(workspaceId, productionId, { title: actTitle.trim(), narrative_goal: actGoal.trim() },
                page.production_revision), () => 'Created the Act.').then(() => { setActTitle(''); setActGoal(''); }); }}>
              <p className="eyebrow">ADD AN ACT (OPTIONAL)</p>
              <label>Act title<input value={actTitle} maxLength={160} onChange={event => setActTitle(event.target.value)} /></label>
              <label>Narrative goal<input value={actGoal} maxLength={1200} onChange={event => setActGoal(event.target.value)} /></label>
              <button type="submit" disabled={guard || !actTitle.trim()}><Plus size={14} /> Add Act</button>
              <p className="subtle">A Production may have no Acts at all: a 3-minute YouTube video does not need them.</p>
            </form>}
            {view.level === 'act' && <form onSubmit={event => { event.preventDefault(); if (!sequenceTitle.trim()) return;
              void run(() => longFormService.createSequence(workspaceId, productionId, { title: sequenceTitle.trim(),
                kind: sequenceKind, act_id: scopeStep?.id ?? null }, page.production_revision), () => 'Created the Sequence.')
                .then(() => setSequenceTitle('')); }}>
              <p className="eyebrow">ADD A SEQUENCE</p>
              <label>Sequence title<input value={sequenceTitle} maxLength={160} onChange={event => setSequenceTitle(event.target.value)} /></label>
              <label>Kind<select value={sequenceKind} onChange={event => setSequenceKind(event.target.value)}>
                {['narrative', 'mission', 'location', 'topic', 'montage', 'action', 'documentary', 'thematic', 'custom']
                  .map(kind => <option key={kind} value={kind}>{kind}</option>)}</select></label>
              <button type="submit" disabled={guard || !sequenceTitle.trim()}><Plus size={14} /> Add Sequence</button>
            </form>}
            {view.level !== 'production' && page.scope && <form onSubmit={event => { event.preventDefault(); if (!summaryText.trim()) return;
              void run(() => longFormService.saveSummary(workspaceId, productionId, {
                level: page.scope.level as Exclude<StructureLevel, 'shot'>, id: String(page.scope.id),
                text: summaryText.trim(), expectedProductionRevision: page.production_revision }),
                () => 'Saved the summary against the revision it describes.').then(() => setSummaryText('')); }}>
              <p className="eyebrow">SUMMARY FOR {page.scope.title?.toUpperCase() ?? ''}</p>
              <label>Summary<textarea rows={2} maxLength={4000} value={summaryText} onChange={event => setSummaryText(event.target.value)} /></label>
              <button type="submit" disabled={guard || !summaryText.trim()}>Save summary</button>
              <p className="subtle">A summary records the revision it was derived from; it becomes STALE rather than silently wrong.</p>
            </form>}
          </div>

          <section className="movie-mode-search" aria-label="Structured search">
            <p className="eyebrow">FIND IN THIS PRODUCTION</p>
            <form onSubmit={event => { event.preventDefault(); setSearchError(null);
              longFormService.search(workspaceId, productionId, query, {
                levels: levelFilter ? [levelFilter as StructureLevel] : undefined, executionMethod: methodFilter || undefined,
              }).then(data => setResults(data.items)).catch(failure => setSearchError(safeError(failure).message)); }}>
              <label>Search<input value={query} onChange={event => setQuery(event.target.value)}
                placeholder="Marcus · 50mm · apartment · unapproved" /></label>
              <label>Level<select value={levelFilter} onChange={event => setLevelFilter(event.target.value)}>
                <option value="">All levels</option>
                {['act', 'sequence', 'scene', 'shot'].map(level => <option key={level} value={level}>{level}</option>)}
              </select></label>
              <label>Execution<select value={methodFilter} onChange={event => setMethodFilter(event.target.value)}>
                <option value="">Any</option><option value="real">SHOOT</option><option value="ai">AI PLAYBOOK</option><option value="hybrid">SHOOT + AI</option>
              </select></label>
              <button type="submit" disabled={guard}><Search size={14} /> Search</button>
            </form>
            {searchError && <p role="alert" className="error-text">{searchError}</p>}
            {results && <ul className="movie-mode-results">
              {results.length === 0 && <li className="subtle">Nothing matched those structured filters. Structured search never guesses.</li>}
              {results.map(result => <li key={`${result.level}-${result.id}`}>
                <button type="button" onClick={() => {
                  if (result.shot_id && result.scene_id) onSelectShot(result.scene_id, result.shot_id);
                  else if (result.level === 'scene') onSelectScene(result.id);
                }}>
                  <span className="pill">{result.level}</span> {result.title}
                  <span className="subtle"> · {result.snippet}{result.execution_method ? ` · ${result.execution_method}` : ''}{result.takes ? ` · ${result.takes} take(s)` : ''}</span>
                </button>
              </li>)}
            </ul>}
          </section>

          <section className="movie-mode-director" aria-label="Long-form Director scope">
            <p className="eyebrow">DIRECTOR · SCOPED COMMAND</p>
            <form onSubmit={event => { event.preventDefault(); setDirectorAnswer(null);
              void longFormService.directorScope(workspaceId, productionId, directorText, page.level, page.scope?.id ?? undefined)
                .then(setDirectorAnswer).catch(failure => setError(safeError(failure).message)); }}>
              <label>Direction<input value={directorText} onChange={event => setDirectorText(event.target.value)}
                placeholder="Make Act 2 shorter." /></label>
              <button type="submit" disabled={guard || !directorText.trim()}>Resolve scope</button>
            </form>
            {directorAnswer && <div role="status">
              <p className="breadcrumb-line">{directorAnswer.breadcrumb_line}</p>
              <p className="subtle">Operation {directorAnswer.resolution.operation ?? 'unresolved'}
                {directorAnswer.resolution.ambiguous ? ' · ambiguous: name the Act, Sequence or Scene.' : ' · explicit scope.'}</p>
              {directorAnswer.context?.siblings && <p className="subtle">Siblings considered: {directorAnswer.context.siblings.map(sibling => sibling.title).join(', ') || 'none'}.
                {' '}Depth {directorAnswer.context.depth ?? 'unknown'}{directorAnswer.context.truncated ? ' · context truncated to the budget' : ''}.</p>}
              <p className="subtle">{directorAnswer.rule}</p>
            </div>}
          </section>

          {summaries.length > 0 && <section aria-label="Derived summaries">
            <p className="eyebrow">DERIVED SUMMARIES</p>
            <ul className="movie-mode-summaries">
              {summaries.map(row => <li key={row.summary_id}>
                <strong>{row.scope_level}</strong> · <span className={row.stale ? 'studio5-warn' : ''}>{row.stale ? 'STALE' : 'CURRENT'}</span>
                {' '}· derived from revision {row.source_revision}, current {row.current_revision}
                {row.text ? <> — {row.text}</> : null}
              </li>)}
            </ul>
          </section>}

          {page.truncated && <p className="subtle" role="status">This level is longer than the page, so it is truncated. Paging keeps a large Production bounded.</p>}
          <TimingRule timing={timing} />
        </>}
  </section>;
}

export function TimingRule({ timing }: { timing: LongFormTiming | null }) {
  return <p className="subtle" role="note">{timing?.rule ?? 'A planned target is never overwritten by a calculated child total.'}</p>;
}

function moveWithin(ids: string[], id: string, direction: -1 | 1): string[] {
  const ordered = [...ids];
  const from = ordered.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= ordered.length) return ordered;
  [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
  return ordered;
}
