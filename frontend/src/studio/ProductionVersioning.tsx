import { useCallback, useEffect, useState } from 'react';
import { GitBranch, GitCompare, GitMerge, History, RotateCcw } from 'lucide-react';
import { safeError } from '../services/errors';
import {
  BRANCHABLE_FIELDS, BRANCH_SCOPES, PROPAGATION_MODES, productionVersioningService,
  type Branch, type BranchChange, type BranchDetail, type BranchList, type BranchScope,
  type MergeDecision, type MergePreview, type PropagationMode, type VersionComparison,
  type VersionEntry, type VersionList, type VersioningVocabulary,
} from '../services/productionVersioning';
import { LoadingState } from '../components/StateComponents';

/**
 * Versions: what version am I looking at, what changed, can I try an alternative without losing the
 * mainline, and what happens if I accept it.
 *
 * Four deliberate separations. Version history is history: it is listed, compared and restorable,
 * and a restore is labelled as a NEW revision rather than a rewind. A branch is an alternative: the
 * screen says so next to the branch, every proposed change is labelled a proposal, and the mainline
 * is reported as unchanged until a merge is accepted. A merge is a reviewed decision: a conflict is
 * shown with both values and is never resolved here on the creator's behalf, and propagation is a
 * creator choice rather than a default rewrite. And nothing on this screen is an approval: merging a
 * branch creates revisions and marks dependent artifacts, it never approves content.
 */

type Target = { id: string; label: string; kind: string; scope: BranchScope };

const FIELD_LABELS: Record<string, string> = {
  title: 'Title', content: 'Content', description: 'Description', purpose: 'Purpose',
  planned_duration_ms: 'Planned duration', subject: 'Subject', action: 'Action',
};

function fieldsFor(kind: string): Array<{ field: string; label: string }> {
  return BRANCHABLE_FIELDS[kind] ?? [];
}

function show(value: unknown): string {
  if (value === null || value === undefined) return 'Not set';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function ProductionVersioningCanvas({ workspaceId, productionId, targets, busy, onChanged }: {
  workspaceId: string; productionId: string; targets: Target[]; busy: boolean; onChanged: () => void;
}) {
  const [vocabulary, setVocabulary] = useState<VersioningVocabulary | null>(null);
  const [objectId, setObjectId] = useState('');
  const [history, setHistory] = useState<VersionList | null>(null);
  const [branches, setBranches] = useState<BranchList | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [branch, setBranch] = useState<BranchDetail | null>(null);
  const [comparison, setComparison] = useState<VersionComparison | null>(null);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [decision, setDecision] = useState<MergeDecision | null>(null);
  const [working, setWorking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // History form.
  const [leftVersion, setLeftVersion] = useState('');
  const [rightVersion, setRightVersion] = useState('');
  const [branchFilter, setBranchFilter] = useState('');

  // Branch form.
  const [branchName, setBranchName] = useState('');
  const [branchScope, setBranchScope] = useState<BranchScope>('scene');
  const [branchSource, setBranchSource] = useState('');
  const [branchReason, setBranchReason] = useState('');

  // Branch change form.
  const [changeTarget, setChangeTarget] = useState('');
  const [changeField, setChangeField] = useState('');
  const [changeValue, setChangeValue] = useState('');
  const [changeNote, setChangeNote] = useState('');

  // Merge decision form.
  const [propagation, setPropagation] = useState<PropagationMode>('change_only_this');
  const [selectedChanges, setSelectedChanges] = useState<string[]>([]);
  const [decisionNote, setDecisionNote] = useState('');

  const [reloadKey, setReloadKey] = useState(0);
  const refresh = useCallback(() => { setReloadKey(current => current + 1); onChanged(); }, [onChanged]);

  useEffect(() => {
    if (!objectId && targets.length > 0) setObjectId(targets[0].id);
  }, [targets, objectId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    productionVersioningService.vocabulary(workspaceId, productionId)
      .then(data => { if (active) { setVocabulary(data); setError(null); } })
      .catch(failure => { if (active) setError(safeError(failure).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceId, productionId]);

  useEffect(() => {
    if (!objectId) return;
    let active = true;
    Promise.all([
      productionVersioningService.versions(workspaceId, productionId, objectId, { branch: branchFilter.trim() || 'main' }),
      productionVersioningService.branches(workspaceId, productionId),
    ]).then(([historyData, branchData]) => {
      if (!active) return;
      setHistory(historyData); setBranches(branchData);
      setLeftVersion(current => current || (historyData.items[1]?.version_id ?? ''));
      setRightVersion(current => current || (historyData.items[0]?.version_id ?? ''));
      setError(null);
    }).catch(failure => { if (active) setError(safeError(failure).message); });
    return () => { active = false; };
  }, [workspaceId, productionId, objectId, branchFilter, reloadKey]);

  useEffect(() => {
    if (!selectedBranchId) { setBranch(null); return; }
    let active = true;
    productionVersioningService.branch(workspaceId, productionId, selectedBranchId)
      .then(data => { if (active) setBranch(data); })
      .catch(failure => { if (active) setError(safeError(failure).message); });
    return () => { active = false; };
  }, [workspaceId, productionId, selectedBranchId, reloadKey]);

  const run = useCallback(async (action: () => Promise<string>) => {
    setWorking(true); setError(null); setNote(null);
    try { const message = await action(); setNote(message); refresh(); }
    catch (failure) { setError(safeError(failure).message); }
    finally { setWorking(false); }
  }, [refresh]);

  const guard = busy || working;

  const target = targets.find(entry => entry.id === objectId) ?? null;
  const changeTargetEntry = targets.find(entry => entry.id === changeTarget) ?? null;
  const changeFields = changeTargetEntry ? fieldsFor(changeTargetEntry.kind) : [];

  const openBranches = (branches?.items ?? []).filter(entry => entry.state === 'open');

  const createBranch = () => run(async () => {
    const result = await productionVersioningService.createBranch(workspaceId, productionId, {
      scopeObjectId: objectId, scope: branchScope, name: branchName.trim(),
      sourceVersionId: branchSource || null, reason: branchReason.trim(),
    });
    setBranchName(''); setBranchReason(''); setBranchSource('');
    return `${result.name} is open as an alternative. ${result.note}`;
  });

  const proposeChange = () => run(async () => {
    if (!selectedBranchId) throw new Error('Choose a branch first.');
    const patch: Record<string, unknown> = {};
    if (changeField === 'planned_duration_ms') {
      patch[changeField] = changeValue.trim() === '' ? null : Number(changeValue.trim());
      if (changeValue.trim() !== '' && !Number.isFinite(patch[changeField] as number)) {
        throw new Error('A duration is a whole number of milliseconds.');
      }
    } else {
      patch[changeField] = changeValue;
    }
    const result = await productionVersioningService.setChange(workspaceId, productionId, selectedBranchId, {
      targetObjectId: changeTarget, patch, note: changeNote.trim(),
    });
    setChangeValue(''); setChangeNote('');
    return `${(result.changed_field_labels ?? []).join(', ') || 'Change'} recorded on the branch. ${result.note ?? ''}`.trim();
  });

  const compare = () => run(async () => {
    const result = await productionVersioningService.compare(workspaceId, productionId, leftVersion, rightVersion);
    setComparison(result);
    return result.change_count === 0
      ? 'No meaningful creative field changed between these versions.'
      : `${result.change_count} meaningful field(s) changed. ${result.note}`;
  });

  const restore = (version: VersionEntry) => run(async () => {
    const result = await productionVersioningService.restore(workspaceId, productionId, version.version_id,
      `Restored revision ${version.revision} from Versions.`);
    return `A new current revision ${result.new_revision} was created from revision ${result.restored_from_revision}. ${result.note}`;
  });

  const previewMerge = (entry: Branch) => run(async () => {
    const result = await productionVersioningService.preview(workspaceId, productionId, entry.branch_id);
    setPreview(result);
    setSelectedChanges(result.items.filter(item => item.status === 'clean').map(item => item.change_id));
    setSelectedBranchId(entry.branch_id);
    return `${result.counts_line} ${result.conflict_line}`;
  });

  const decideMerge = (choice: 'merge' | 'reject') => run(async () => {
    if (!preview) throw new Error('Preview the merge first.');
    const result = await productionVersioningService.decide(workspaceId, productionId, preview.proposal_id, {
      decision: choice, selectedChangeIds: choice === 'merge' ? selectedChanges : [],
      propagation, note: decisionNote.trim(),
    });
    setDecision(result);
    setPreview(null); setDecisionNote(''); setSelectedChanges([]);
    return `${result.applied_line} ${result.note}`;
  });

  return <section className="ver" aria-label="Production versions">
    <header className="ver-head">
      <div>
        <p className="eyebrow">VERSIONS, BRANCHES AND MERGE</p>
        <h3>What version am I looking at, and what happens if I accept an alternative?</h3>
      </div>
      <div className="ver-rules">
        <p className="subtle">{vocabulary?.rule ?? 'A branch is an object-level alternative, not a duplicate Production.'}</p>
        <p className="subtle">{vocabulary?.limitation ?? 'Compare shows the meaningful creative fields that differ.'}</p>
      </div>
    </header>

    {error && <div className="save-error" role="alert">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div>}
    {note && <p className="studio5-note" role="status">{note}</p>}
    {loading && !vocabulary ? <LoadingState label="Reading version history…" /> : null}

    <div className="ver-controls">
      <label>Object
        <select value={objectId} aria-label="Version object" onChange={event => {
          setObjectId(event.target.value); setComparison(null); setHistory(null);
        }}>
          {targets.length === 0 && <option value="">No versioned object yet</option>}
          {targets.map(entry => <option key={entry.id} value={entry.id}>{entry.label} · {entry.kind}</option>)}
        </select>
      </label>
      <label>Branch
        <input value={branchFilter} maxLength={100} aria-label="Version branch filter" placeholder="main"
          onChange={event => setBranchFilter(event.target.value)} />
      </label>
    </div>

    {history && <section className="ver-history" aria-label="Version history">
      <p className="eyebrow">HISTORY</p>
      <p className="subtle" role="status">{history.object_label} · current revision {history.current_revision} · {history.total} version(s)</p>
      <p className="subtle" role="note">{history.note}</p>
      <table className="ver-table">
        <caption>Every revision of {history.object_label}, newest first</caption>
        <thead>
          <tr><th scope="col">Revision</th><th scope="col">Source</th><th scope="col">Recorded</th><th scope="col">Status</th><th scope="col">Actions</th></tr>
        </thead>
        <tbody>
          {history.items.map(entry => <tr key={entry.version_id}>
            <td>{entry.revision}{entry.branch !== 'main' ? ` · ${entry.branch}` : ''}</td>
            <td>{entry.source_action_label ?? entry.source_action}</td>
            <td>{entry.created_at?.slice(0, 10)}</td>
            <td><span className={entry.is_current ? 'pill in-force' : 'pill subtle'}>{entry.current_line ?? (entry.is_current ? 'Current' : 'History')}</span></td>
            <td className="ver-actions">
              <button type="button" disabled={guard || entry.is_current}
                onClick={() => void restore(entry)}><RotateCcw size={13} /> Restore this version</button>
            </td>
          </tr>)}
        </tbody>
      </table>
    </section>}

    <section className="ver-compare" aria-label="Compare versions">
      <p className="eyebrow">COMPARE</p>
      <div className="ver-controls">
        <label>From
          <select value={leftVersion} aria-label="Compare from version" onChange={event => setLeftVersion(event.target.value)}>
            {(history?.items ?? []).map(entry => <option key={entry.version_id} value={entry.version_id}>Revision {entry.revision} · {entry.source_action_label ?? entry.source_action}</option>)}
          </select>
        </label>
        <label>To
          <select value={rightVersion} aria-label="Compare to version" onChange={event => setRightVersion(event.target.value)}>
            {(history?.items ?? []).map(entry => <option key={entry.version_id} value={entry.version_id}>Revision {entry.revision} · {entry.source_action_label ?? entry.source_action}</option>)}
          </select>
        </label>
        <button type="button" disabled={guard || !leftVersion || !rightVersion || leftVersion === rightVersion}
          onClick={() => void compare()}><GitCompare size={14} /> Compare versions</button>
      </div>
      {comparison && <div className="ver-diff" role="status">
        <p className="subtle">{comparison.change_count === 0 ? 'Nothing meaningful changed.' : `${comparison.change_count} field(s) changed between revision ${comparison.left_revision} and revision ${comparison.right_revision}.`}</p>
        <p className="subtle" role="note">{comparison.limitation ?? ''}</p>
        <ul>
          {comparison.changes.map(change => <li key={change.field}>
            <strong>{change.label}</strong>: <span className="ver-before">{show(change.before)}</span> → <span className="ver-after">{show(change.after)}</span>
          </li>)}
        </ul>
      </div>}
    </section>

    <section className="ver-branches" aria-label="Creative branches">
      <p className="eyebrow">ALTERNATIVES</p>
      <form className="ver-create" onSubmit={event => { event.preventDefault(); if (!branchName.trim() || !objectId) return; void createBranch(); }}>
        <label>Name
          <input value={branchName} maxLength={160} aria-label="Branch name" placeholder="Product-first opening"
            onChange={event => setBranchName(event.target.value)} />
        </label>
        <label>Scope
          <select value={branchScope} aria-label="Branch scope" onChange={event => setBranchScope(event.target.value as BranchScope)}>
            {BRANCH_SCOPES.map(value => <option key={value} value={value}>
              {vocabulary?.scopes.find(item => item.scope === value)?.label ?? value}</option>)}
          </select>
        </label>
        <label>From version
          <select value={branchSource} aria-label="Branch source version" onChange={event => setBranchSource(event.target.value)}>
            <option value="">Latest revision</option>
            {(history?.items ?? []).map(entry => <option key={entry.version_id} value={entry.version_id}>Revision {entry.revision}</option>)}
          </select>
        </label>
        <label>Reason
          <input value={branchReason} maxLength={600} aria-label="Branch reason" placeholder="Try the product earlier."
            onChange={event => setBranchReason(event.target.value)} />
        </label>
        <button type="submit" disabled={guard || !branchName.trim() || !objectId}><GitBranch size={14} /> Create branch</button>
      </form>

      <ul className="ver-list">
        {(branches?.items ?? []).map(entry => <li key={entry.branch_id} className={entry.state === 'open' ? 'ver-branch' : 'ver-branch closed'}>
          <div className="ver-branch-head">
            <strong>{entry.name}</strong>
            <span className="pill subtle">{entry.state_label ?? entry.state}</span>
            <span className="subtle">{entry.scope_label ?? entry.scope}</span>
          </div>
          <p className="subtle">{entry.changes_line ?? ''} {entry.reason}</p>
          <div className="ver-actions">
            <button type="button" disabled={guard || entry.state !== 'open'}
              onClick={() => void previewMerge(entry)}><GitMerge size={13} /> Preview merge</button>
            <button type="button" disabled={guard}
              onClick={() => setSelectedBranchId(entry.branch_id === selectedBranchId ? '' : entry.branch_id)}>
              <History size={13} /> Open this branch
            </button>
            <button type="button" disabled={guard || entry.state === 'merged'}
              onClick={() => void run(async () => {
                const result = await productionVersioningService.setState(workspaceId, productionId, entry.branch_id,
                  entry.state === 'open' ? 'abandoned' : 'open', entry.state === 'open' ? 'Abandoned from Versions.' : '');
                return `${result.note}`;
              })}>{entry.state === 'open' ? 'Abandon branch' : 'Reopen branch'}</button>
          </div>
        </li>)}
      </ul>

      {branch && <div className="ver-branch-detail" aria-label="Branch proposals">
        <p className="eyebrow">PROPOSALS ON {branch.name.toUpperCase()}</p>
        <p className="subtle" role="note">{branch.note}</p>
        <ul>
          {branch.changes.map((change: BranchChange) => <li key={change.change_id}>
            <strong>{change.target_label ?? change.target_object_id}</strong>{' '}
            <span className="pill subtle">{change.state_label ?? change.state}</span>{' '}
            <span className="subtle">{(change.changed_field_labels ?? change.changed_fields).join(', ')}</span>
            {change.conflict_line && <span className="subtle"> {change.conflict_line}</span>}
            <button type="button" disabled={guard || change.state === 'applied'}
              onClick={() => void run(async () => {
                const result = await productionVersioningService.clearChange(workspaceId, productionId, branch.branch_id,
                  change.change_id, 'Discarded from Versions.');
                return result.note;
              })}>Discard this change</button>
          </li>)}
          {branch.changes.length === 0 && <li className="subtle">No change is proposed on this branch yet.</li>}
        </ul>

        <form className="ver-change" onSubmit={event => {
          event.preventDefault();
          if (!changeTarget || !changeField || changeValue.trim() === '') return;
          void proposeChange();
        }}>
          <label>Change
            <select value={changeTarget} aria-label="Branch change target" onChange={event => {
              setChangeTarget(event.target.value);
              const entry = targets.find(item => item.id === event.target.value);
              setChangeField(entry ? (fieldsFor(entry.kind)[0]?.field ?? '') : '');
            }}>
              <option value="">Choose an object</option>
              {targets.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
            </select>
          </label>
          <label>Field
            <select value={changeField} aria-label="Branch change field" onChange={event => setChangeField(event.target.value)}>
              {changeFields.map(item => <option key={item.field} value={item.field}>{item.label}</option>)}
            </select>
          </label>
          <label>Value
            <input value={changeValue} maxLength={400} aria-label="Branch change value"
              onChange={event => setChangeValue(event.target.value)} />
          </label>
          <label>Note
            <input value={changeNote} maxLength={600} aria-label="Branch change note"
              onChange={event => setChangeNote(event.target.value)} />
          </label>
          <button type="submit" disabled={guard || branch.state !== 'open' || !changeTarget || !changeField}>Propose change</button>
        </form>
      </div>}
    </section>

    {preview && <section className="ver-merge" aria-label="Merge preview">
      <p className="eyebrow">MERGE PROPOSAL</p>
      <p className="subtle" role="status">{preview.counts_line} {preview.conflict_line}</p>
      <p className="subtle" role="note">{preview.note}</p>
      <ul>
        {preview.items.map(item => <li key={item.change_id}>
          <strong>{item.target_label ?? item.target_object_id}</strong>{' '}
          <span className="pill subtle">{item.state_label ?? item.status}</span>{' '}
          <span className="subtle">{(item.changed_fields ?? []).map(field => FIELD_LABELS[field] ?? field).join(', ')}</span>
          {item.status === 'clean' && <label className="ver-select">
            <input type="checkbox" checked={selectedChanges.includes(item.change_id)}
              aria-label={`Select change to ${item.target_label ?? item.target_object_id}`}
              onChange={event => setSelectedChanges(current =>
                event.target.checked ? [...current, item.change_id] : current.filter(id => id !== item.change_id))} />
            Merge this change
          </label>}
          {item.conflicts.length > 0 && <ul className="ver-conflicts">
            {item.conflicts.map(conflict => <li key={conflict.field}>
              <strong>{conflict.label ?? FIELD_LABELS[conflict.field] ?? conflict.field}</strong>{' '}
              mainline {show(conflict.main_value)} · this branch {show(conflict.branch_value)}
            </li>)}
          </ul>}
        </li>)}
      </ul>
      {preview.conflicts.length > 0 && <ul className="ver-conflicts" aria-label="Merge conflicts">
        {preview.conflicts.map(conflict => <li key={conflict.change_id}>
          <strong>{conflict.target_label ?? conflict.target_object_id}</strong>: {conflict.reason}
        </li>)}
      </ul>}
      <p className="subtle" role="note">{preview.impact?.note ?? ''}</p>
      <div className="ver-controls">
        <label>Propagation
          <select value={propagation} aria-label="Merge propagation" onChange={event => setPropagation(event.target.value as PropagationMode)}>
            {PROPAGATION_MODES.map(mode => <option key={mode} value={mode}>
              {vocabulary?.propagation_modes.find(item => item.mode === mode)?.label ?? mode}</option>)}
          </select>
        </label>
        <label>Decision note
          <input value={decisionNote} maxLength={800} aria-label="Merge decision note"
            onChange={event => setDecisionNote(event.target.value)} />
        </label>
        <button type="button" disabled={guard || selectedChanges.length === 0}
          onClick={() => void decideMerge('merge')}><GitMerge size={14} /> Merge selected changes</button>
        <button type="button" disabled={guard} onClick={() => void decideMerge('reject')}>Reject this merge</button>
      </div>
      <p className="subtle">Merging creates revisions and marks dependent artifacts. It is not an approval.</p>
    </section>}

    {decision && <section className="ver-decision" aria-label="Merge decision">
      <p className="eyebrow">DECISION</p>
      <p className="subtle" role="status">{decision.applied_line} {decision.note}</p>
      <p className="subtle" role="note">{decision.state_label ?? decision.state}</p>
      <ul>
        {(decision.impact ?? []).map(entry => <li key={entry.object_id}>
          {entry.impact_line} {entry.review_line ?? ''}
        </li>)}
      </ul>
    </section>}

    {openBranches.length > 0 && <p className="subtle" role="note">
      {openBranches.length} alternative(s) are open. The mainline is unchanged until you accept a merge.
    </p>}
  </section>;
}
