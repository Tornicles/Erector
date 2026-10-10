import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, GitBranch, Link2, RefreshCw, ScanLine, Undo2 } from 'lucide-react';
import { safeError } from '../services/errors';
import {
  productionIntelligenceService, type ArtifactKind, type DependencyEdgeList, type DependencyGraph,
  type ImpactApplyResult, type ImpactHistoryRow, type ImpactMode, type ImpactModesPayload, type ImpactPreview,
  type StaleMarkerList, type StaleState,
} from '../services/productionIntelligence';
import { LoadingState } from '../components/StateComponents';

/**
 * Production Intelligence: what a change actually affects, and what is waiting to be resolved.
 *
 * The screen is built around three deliberate separations. Computing an impact changes
 * nothing, so preview and apply are different actions here and the apply button stays dead
 * until a real propagation choice exists. Locked objects are reported rather than changed and
 * approved content needs a creator's review, so protected dependents are always shown. An
 * inferred dependency is a proposal, so it is labelled POTENTIAL and can never be applied.
 */

type Source = { id: string; label: string; kind: string; group: string };

const STALE_FILTERS: Array<{ value: '' | StaleState; label: string }> = [
  { value: 'stale', label: 'Stale only' },
  { value: 'conflicted', label: 'Conflicted only' },
  { value: 'current', label: 'Resolved' },
  { value: '', label: 'Everything' },
];

const ARTIFACT_KINDS: ArtifactKind[] = ['dependent_object', 'continuity_state', 'continuity_analysis', 'real_plan',
  'ai_plan', 'prompt', 'first_frame', 'last_frame', 'generation_context', 'result_comparison', 'derived_summary',
  'deliverable', 'other'];

export function ProductionIntelligenceCanvas({ workspaceId, productionId, assets, selectedSceneId, selectedShotId,
  sceneTitle, shotTitle, productionTitle, busy, onChanged }: {
  workspaceId: string; productionId: string;
  assets: Array<{ id: string; name: string; asset_type: string }>;
  selectedSceneId: string | null; selectedShotId: string | null;
  sceneTitle?: string | null; shotTitle?: string | null; productionTitle?: string | null;
  busy: boolean; onChanged: () => void;
}) {
  const [vocabulary, setVocabulary] = useState<ImpactModesPayload | null>(null);
  const [targetId, setTargetId] = useState<string>(selectedShotId ?? selectedSceneId ?? productionId);
  const [depth, setDepth] = useState(2);
  const [direction, setDirection] = useState<'forward' | 'reverse'>('forward');
  const [graph, setGraph] = useState<DependencyGraph | null>(null);
  const [edgeList, setEdgeList] = useState<DependencyEdgeList | null>(null);
  const [preview, setPreview] = useState<ImpactPreview | null>(null);
  const [applied, setApplied] = useState<ImpactApplyResult | null>(null);
  const [mode, setMode] = useState<Exclude<ImpactMode, 'preview'> | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [markers, setMarkers] = useState<StaleMarkerList | null>(null);
  const [staleFilter, setStaleFilter] = useState<'' | StaleState>('stale');
  const [history, setHistory] = useState<ImpactHistoryRow[]>([]);
  const [markKind, setMarkKind] = useState<ArtifactKind>('dependent_object');
  const [markReason, setMarkReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const sources = useMemo<Source[]>(() => {
    const list: Source[] = [];
    if (selectedShotId) list.push({ id: selectedShotId, label: shotTitle ?? 'Selected Shot', kind: 'shot', group: 'This Production' });
    if (selectedSceneId) list.push({ id: selectedSceneId, label: sceneTitle ?? 'Selected Scene', kind: 'scene', group: 'This Production' });
    list.push({ id: productionId, label: productionTitle ?? 'This Production', kind: 'production', group: 'This Production' });
    for (const asset of assets) list.push({ id: asset.id, label: asset.name, kind: asset.asset_type, group: 'Reusable Assets' });
    return list;
  }, [assets, selectedShotId, selectedSceneId, productionId, shotTitle, sceneTitle, productionTitle]);

  useEffect(() => {
    if (!sources.some(item => item.id === targetId)) setTargetId(selectedShotId ?? selectedSceneId ?? productionId);
  }, [sources, targetId, selectedShotId, selectedSceneId, productionId]);

  const refresh = useCallback(() => { setReloadKey(value => value + 1); onChanged(); }, [onChanged]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      productionIntelligenceService.modes(workspaceId, productionId),
      productionIntelligenceService.graph(workspaceId, productionId, targetId, { direction, depth }),
      productionIntelligenceService.dependencies(workspaceId, productionId, targetId),
      productionIntelligenceService.stale(workspaceId, productionId, staleFilter || null),
      productionIntelligenceService.history(workspaceId, productionId),
    ]).then(([modes, graphData, edgeData, markerData, historyData]) => {
      if (!active) return;
      setVocabulary(modes); setGraph(graphData); setEdgeList(edgeData); setMarkers(markerData);
      setHistory(historyData.items); setError(null);
    }).catch(failure => { if (active) setError(safeError(failure).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceId, productionId, targetId, direction, depth, staleFilter, reloadKey]);

  const run = useCallback(async (action: () => Promise<string>) => {
    setWorking(true); setError(null); setNote(null);
    try { setNote(await action()); refresh(); }
    catch (failure) { setError(safeError(failure).message); }
    finally { setWorking(false); }
  }, [refresh]);

  const target = sources.find(item => item.id === targetId) ?? null;
  const guard = busy || working;
  const modes = preview?.modes ?? vocabulary?.modes ?? [];
  const applicable = (preview?.nodes ?? []).filter(node => node.classification === 'direct' || node.classification === 'downstream');

  const resetPreview = () => { setPreview(null); setApplied(null); setMode(null); setSelected([]); };

  const apply = () => run(async () => {
    const result = await productionIntelligenceService.apply(workspaceId, productionId, {
      analysisId: preview!.analysis_id, mode: mode!, selectedIds: selected, expectedRootRevision: preview!.root_revision,
    });
    setApplied(result);
    return result.summary_line;
  });

  return <section className="intel" aria-label="Production Intelligence">
    <header className="intel-head">
      <div>
        <p className="eyebrow">PRODUCTION INTELLIGENCE</p>
        <h3>What does this change affect?</h3>
      </div>
      <div className="intel-rules">
        <p className="subtle">{vocabulary?.rule ?? 'Impact is computed, never applied by computing it.'}</p>
        {vocabulary?.direction && <p className="subtle">{vocabulary.direction}</p>}
      </div>
    </header>

    <div className="intel-controls">
      <label>Source object
        <select value={targetId} aria-label="Source object" onChange={event => { setTargetId(event.target.value); resetPreview(); }}>
          {['This Production', 'Reusable Assets'].map(group => <optgroup key={group} label={group}>
            {sources.filter(item => item.group === group).map(item => <option key={item.id} value={item.id}>{item.label} · {item.kind}</option>)}
          </optgroup>)}
        </select>
      </label>
      <div className="intel-direction" role="group" aria-label="Traversal direction">
        {(['forward', 'reverse'] as const).map(value => <button key={value} type="button" aria-pressed={direction === value}
          className={direction === value ? 'selected' : ''} onClick={() => setDirection(value)}>
          {value === 'forward' ? 'What this affects' : 'What this depends on'}</button>)}
      </div>
      <label>Depth
        <select value={depth} aria-label="Traversal depth" onChange={event => setDepth(Number(event.target.value))}>
          {[1, 2, 3, 4].map(value => <option key={value} value={value}>{value} level(s)</option>)}
        </select>
      </label>
      <button type="button" disabled={guard} onClick={() => void run(async () => {
        const result = await productionIntelligenceService.sync(workspaceId, productionId);
        return `${result.edges_considered} dependency edge(s) re-derived from your bindings, plans and dialogue.`;
      })}><RefreshCw size={14} /> Sync derived dependencies</button>
      <button type="button" disabled={guard} onClick={() => void run(async () => {
        const result = await productionIntelligenceService.preview(workspaceId, productionId, targetId, depth);
        setPreview(result); setApplied(null); setMode(null); setSelected([]);
        return result.summary_line;
      })}><ScanLine size={14} /> Preview impact</button>
    </div>

    {error && <div className="save-error" role="alert">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div>}
    {note && <p className="studio5-note" role="status">{note}</p>}

    {loading && !graph ? <LoadingState label="Reading this Production's dependency graph…" /> : null}

    {graph && <section className="intel-graph" aria-label="Dependency graph">
      <p className="eyebrow">{graph.direction_label ?? 'Impact'} · {graph.root_label}</p>
      <p className="subtle" role="status">{graph.total_label ?? `${graph.total} reachable object(s)`}
        {graph.truncated ? ' · this page is truncated; the traversal stayed bounded' : ''}
        {' · '}{graph.cycles_safe ? 'cycle-safe traversal' : 'cycles were not checked'}.</p>
      {graph.nodes.length === 0
        ? <p className="studio5-empty">Nothing depends on this yet. Derived edges come from real bindings, plans and dialogue — sync them, or declare a relationship.</p>
        : <ul className="intel-nodes">
          {graph.nodes.map(node => <li key={node.object_id}>
            <span className={`pill impact-${node.classification}`}>{node.classification_label ?? node.classification}</span>
            <strong>{node.label}</strong>
            <span className="pill subtle">{node.level_label ?? node.level}</span>
            {node.relation_label && <span className="pill subtle">{node.relation_label}</span>}
            <span className="pill subtle">depth {node.depth}</span>
            {node.status && node.status !== 'Open' && <span className="pill"><AlertTriangle size={11} /> {node.status.toLowerCase()}</span>}
            {node.revision !== null && <span className="pill subtle">revision {node.revision}</span>}
          </li>)}
        </ul>}
      <p className="subtle" role="note">{graph.note}</p>
    </section>}

    {edgeList && <section className="intel-edges" aria-label="Stored relationships">
      <p className="eyebrow">STORED RELATIONSHIPS</p>
      {edgeList.items.length === 0 ? <p className="subtle">No relationship is stored for this object yet.</p>
        : <table className="intel-table">
          <caption>{edgeList.items.length} relationship(s) touching {graph?.root_label ?? 'this object'}. Deactivating keeps the history readable.</caption>
          <thead><tr><th scope="col">Source</th><th scope="col">Depends on</th><th scope="col">Relation</th><th scope="col">Strength</th><th scope="col">Origin</th><th scope="col">State</th><th scope="col">Action</th></tr></thead>
          <tbody>{edgeList.items.map(edge => <tr key={`${edge.source_object_id}-${edge.target_object_id}-${edge.relation}`}>
            <td>{edge.source_label ?? edge.source_object_id.slice(0, 8)}</td>
            <td>{edge.target_label ?? edge.target_object_id.slice(0, 8)}</td>
            <td>{edge.relation_label ?? edge.relation}</td>
            <td>{edge.strength_label ?? edge.strength}</td>
            <td>{edge.origin_label ?? edge.origin}</td>
            <td>{edge.state_label ?? (edge.active ? 'Active' : 'Inactive')}</td>
            <td><button type="button" disabled={guard} onClick={() => void run(async () => {
              const result = await productionIntelligenceService.setDependenciesActive(workspaceId, productionId, {
                edgeIds: [edge.source_object_id, edge.target_object_id], active: !edge.active,
                note: edge.active ? 'Deactivated from Studio.' : 'Reactivated from Studio.',
              });
              return `${result.changed} relationship(s) ${edge.active ? 'deactivated' : 'reactivated'}.`;
            })}>{edge.active ? <><Undo2 size={12} /> Deactivate</> : <><Link2 size={12} /> Reactivate</>}</button></td>
          </tr>)}</tbody>
        </table>}
      <p className="subtle" role="note">{edgeList.note}</p>
    </section>}

    {preview && <section className="intel-impact" aria-label="Impact preview">
      <p className="eyebrow">IMPACT PREVIEW · {preview.root_label}</p>
      <p className="intel-summary" role="status">{preview.summary_line}</p>
      <p className="subtle">{preview.explanation}</p>
      <dl className="intel-counts" aria-label="Affected objects">
        <div><dt>Direct</dt><dd>{preview.counts.direct}</dd></div>
        <div><dt>Downstream</dt><dd>{preview.counts.downstream}</dd></div>
        <div><dt>Potential</dt><dd>{preview.counts.potential}</dd></div>
        <div><dt>Locked</dt><dd>{preview.counts.locked}</dd></div>
        <div><dt>Approved</dt><dd>{preview.counts.approved}</dd></div>
        <div><dt>Levels</dt><dd>{Object.entries(preview.counts.by_level ?? {}).map(([level, count]) => `${count} ${level}`).join(' · ') || 'none'}</dd></div>
      </dl>
      <p className="subtle" role="note">{preview.rule}</p>

      <fieldset className="intel-modes">
        <legend>Choose what TONDE does with this change</legend>
        {modes.map(option => <label key={option.mode} className={mode === option.mode ? 'selected' : ''}>
          <input type="radio" name="impact-mode" value={option.mode} checked={mode === option.mode} disabled={guard || applied !== null}
            onChange={() => { setMode(option.mode as Exclude<ImpactMode, 'preview'>); if (option.mode !== 'review_changes') setSelected([]); }} />
          <span><strong>{option.label}</strong> — {option.description}</span>
        </label>)}
      </fieldset>

      {mode === 'review_changes' && <div className="intel-review" role="group" aria-label="Dependents to change">
        <p className="subtle">Pick the dependents that should change. Nothing else is touched.</p>
        {applicable.length === 0 ? <p className="subtle">There is no direct or downstream dependent to select.</p>
          : applicable.map(node => <label key={node.object_id}>
            <input type="checkbox" checked={selected.includes(node.object_id)} disabled={guard || applied !== null}
              onChange={event => setSelected(current => event.target.checked
                ? [...current, node.object_id] : current.filter(id => id !== node.object_id))} />
            <span>{node.label} <span className="subtle">· {node.classification_label ?? node.classification}</span></span>
          </label>)}
        {(preview.nodes ?? []).some(node => node.classification === 'potential') &&
          <p className="subtle" role="note">A potential dependency is a proposal, so it is never applied.</p>}
      </div>}

      <div className="intel-apply">
        <button type="button" disabled={guard || applied !== null || !mode || (mode === 'review_changes' && selected.length === 0)}
          onClick={() => void apply()}>
          <CheckCircle2 size={14} /> Apply {modes.find(option => option.mode === mode)?.label ?? ''}
        </button>
        <button type="button" disabled={guard} onClick={resetPreview}>Discard this preview</button>
        {applied === null && <span className="subtle" role="status">
          {mode === null ? 'Choose a propagation choice first — TONDE will not apply this on its own.'
            : mode === 'review_changes' && selected.length === 0 ? 'Select at least one dependent to change.'
              : 'Ready to apply against revision ' + preview.root_revision + '.'}</span>}
      </div>

      {applied && <div className="intel-applied" role="status">
        <p className="intel-summary"><strong>{applied.mode_label}</strong> · {applied.summary_line}</p>
        <p className="subtle">{applied.note}</p>
        {applied.locked_skipped.length > 0 && <div>
          <p className="eyebrow">REPORTED, NOT CHANGED</p>
          <ul>{applied.locked_skipped.map(item => <li key={item.object_id}>{item.label} — {item.reason}</li>)}</ul>
        </div>}
        {applied.requiring_review.length > 0 && <div>
          <p className="eyebrow">NEEDS YOUR REVIEW</p>
          <ul>{applied.requiring_review.map(item => <li key={item.object_id}>{item.label} — {item.reason}</li>)}</ul>
        </div>}
        {applied.unresolved_count > 0 && <p className="studio5-warn" role="note">
          {applied.unresolved_count} downstream change(s) stay unresolved until you preview and choose again.</p>}
      </div>}
    </section>}

    <section className="intel-stale" aria-label="Stale artifacts">
      <p className="eyebrow">WAITING ON YOU</p>
      <label>Show
        <select value={staleFilter} aria-label="Stale artifact filter"
          onChange={event => { setStaleFilter(event.target.value as '' | StaleState); resetPreview(); }}>
          {STALE_FILTERS.map(item => <option key={item.label} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      <p className="subtle" role="status">{markers?.open_label ?? 'Reading stale markers…'}</p>
      {markers && markers.items.length === 0 ? <p className="studio5-empty">Nothing in this filter is waiting. Nothing is deleted when it is.</p>
        : <ul className="intel-markers">
          {(markers?.items ?? []).map(marker => <li key={marker.artifact_id} className={marker.state}>
            <span className={`pill stale-${marker.state}`}>{marker.state_label ?? marker.state}</span>
            <strong>{marker.object_label ?? marker.object_id.slice(0, 8)}</strong>
            <span className="pill subtle">{marker.artifact_kind_label ?? marker.artifact_kind}</span>
            <p className="subtle">{marker.reason}
              {marker.caused_by_label ? ` Caused by ${marker.caused_by_label}` : ''}
              {marker.current_revision !== null && marker.source_revision !== null ? ` (revision ${marker.source_revision} → ${marker.current_revision}).` : '.'}</p>
            {marker.resolved_at
              ? <p className="subtle">Resolved {marker.resolved_at}</p>
              : <button type="button" disabled={guard} onClick={() => void run(async () => {
                const result = await productionIntelligenceService.resolveStale(workspaceId, productionId, marker.artifact_id);
                return result.note;
              })}>Mark resolved</button>}
          </li>)}
        </ul>}
      {markers && <form className="intel-mark" onSubmit={event => {
        event.preventDefault();
        if (!markReason.trim()) return;
        void run(async () => {
          const result = await productionIntelligenceService.markStale(workspaceId, productionId, {
            objectId: targetId, artifactKind: markKind, reason: markReason.trim(),
          });
          setMarkReason('');
          return result.note;
        });
      }}>
        <p className="eyebrow">RECORD SOMETHING THAT MAY NO LONGER MATCH</p>
        <label>Artifact
          <select value={markKind} aria-label="Artifact kind" onChange={event => setMarkKind(event.target.value as ArtifactKind)}>
            {ARTIFACT_KINDS.map(kind => <option key={kind} value={kind}>{kind}</option>)}
          </select>
        </label>
        <label>Reason<textarea rows={2} maxLength={600} value={markReason} aria-label="Stale reason"
          onChange={event => setMarkReason(event.target.value)} placeholder="Marcus is injured from Scene 4." /></label>
        <button type="submit" disabled={guard || !markReason.trim()}>Mark stale</button>
        <p className="subtle">Marking records the reason and the revision it no longer matches. It never rewrites the artifact.</p>
      </form>}
    </section>

    {history.length > 0 && <section className="intel-history" aria-label="Impact history">
      <p className="eyebrow">IMPACT HISTORY</p>
      <ul>
        {history.map(row => <li key={row.analysis_id}>
          <strong>{row.root_label}</strong> · <span className="pill subtle">{row.mode_label ?? row.mode}</span>
          {' '}{row.applied_mode_label ?? 'Not applied'} · {row.affected_label ?? ''}
          {' '}<span className="subtle">{row.created_at}{row.unresolved_count ? ` · ${row.unresolved_count} unresolved` : ''}</span>
        </li>)}
      </ul>
      <p className="subtle" role="note"><GitBranch size={12} aria-hidden="true" /> An analysis is a snapshot; a new preview never overwrites a previous one.</p>
    </section>}
  </section>;
}
