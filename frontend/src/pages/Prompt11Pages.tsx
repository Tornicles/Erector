import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { EmptyState, ErrorState, LoadingState } from '../components/StateComponents';
import { safeError } from '../services/errors';
import { prompt11Service, type DeviceReadiness, type DiscoverIndex, type DiscoverPreview, type JobList, type KnowledgeSearch, type SceneIntelligence } from '../services/prompt11';
import { productionService } from '../services/productions';
import type { Production } from '../types/domain';

function useWorkspaceValue<T>(load: (workspaceId: string) => Promise<T>, dependencies: unknown[] = []) {
  const { workspaceId } = useAuth();
  const [value, setValue] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!workspaceId) { setValue(null); setLoading(false); return; }
    let active = true;
    setLoading(true); setError(null);
    load(workspaceId).then(result => { if (active) setValue(result); })
      .catch(failure => { if (active) setError(safeError(failure).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  // Dependencies are intentionally caller-provided query/filter values.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, refresh, ...dependencies]);
  return { workspaceId, value, loading, error, reload: () => setRefresh(current => current + 1), setError };
}

export function DiscoverPage() {
  const { workspaceId } = useAuth();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<DiscoverIndex | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<DiscoverPreview | null>(null);
  const [productions, setProductions] = useState<Production[]>([]);
  const [target, setTarget] = useState('');
  const [kind, setKind] = useState<'direct_this' | 'use_technique' | 'attach_reference'>('direct_this');
  const [savedTab, setSavedTab] = useState(false);
  const reload = async () => {
    if (!workspaceId) { setItems(null); return; }
    setError(null);
    try { setItems(await prompt11Service.discover(workspaceId, query)); }
    catch (failure) { setError(safeError(failure).message); }
  };
  useEffect(() => { const timer = window.setTimeout(() => { void reload(); }, query ? 200 : 0); return () => window.clearTimeout(timer); }, [workspaceId, query]);
  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    productionService.list(workspaceId).then(rows => { if (active) { setProductions(rows); if (!target && rows[0]) setTarget(rows[0].id); } })
      .catch(failure => { if (active) setError(safeError(failure).message); });
    return () => { active = false; };
  }, [workspaceId]);
  const save = async (id: string, saved: boolean) => {
    if (!workspaceId) return;
    setBusy(true); setError(null); setNotice(null);
    try { await prompt11Service.saveDiscover(workspaceId, id, !saved); setNotice(saved ? 'Removed from your saved Discover items.' : 'Saved to your Discover items.'); await reload(); }
    catch (failure) { setError(safeError(failure).message); }
    finally { setBusy(false); }
  };
  const begin = async (itemId: string) => {
    if (!workspaceId || !target) return;
    setBusy(true); setError(null); setNotice(null);
    try { setPreview(await prompt11Service.previewDiscover(workspaceId, { item_id: itemId, kind, production_id: target })); }
    catch (failure) { setError(safeError(failure).message); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    if (!workspaceId || !preview) return;
    setBusy(true); setError(null);
    try {
      const result = await prompt11Service.applyDiscover(workspaceId, preview.application_id, preview.impact.confirmation);
      setNotice(result.meaning ?? 'The reviewed Discover action was applied to this Production.');
      setPreview(null);
    } catch (failure) { setError(safeError(failure).message); }
    finally { setBusy(false); }
  };
  const visible = (items?.items ?? []).filter(item => !savedTab || item.saved);
  return <div className="page"><header className="compact-header"><p className="eyebrow">PRODUCTION KNOWLEDGE & REFERENCES</p><h1>Discover</h1><p>Find sourced production knowledge, techniques, examples and inspiration. Every item states its provenance and current usability; Discover is not a stock gallery.</p></header>
    {!workspaceId && <p role="status" className="capability-note">Connect a workspace to browse its curated Discover library.</p>}
    <div className="discover-toolbar"><label>Search Discover<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Movement, light, camera…" /></label><div role="tablist" aria-label="Discover items"><button role="tab" aria-selected={!savedTab} onClick={() => setSavedTab(false)}>Browse</button><button role="tab" aria-selected={savedTab} onClick={() => setSavedTab(true)}>Saved</button></div></div>
    {error && <ErrorState message={error} retry={() => void reload()} />}{notice && <p role="status" className="capability-note">{notice}</p>}
    {items === null ? <LoadingState label="Loading Discover…" /> : visible.length ? <section className="technique-list" aria-label="Discover library">{visible.map(item => <article className="technique-row" key={item.item_id}><div><p className="eyebrow">{item.item_kind.replaceAll('_', ' ')} · {item.provenance?.source_label ?? 'Source not named'} · {item.provenance?.rights_classification?.replaceAll('_', ' ') ?? 'rights unknown'}</p><h2>{item.title}</h2><p>{item.summary}</p><p className="subtle">{item.review_state.replaceAll('_', ' ')} · {item.source_state.replaceAll('_', ' ')} · {item.usable ? 'Usable now' : 'Not currently usable'}</p>{!item.usable && <p className="capability-note">This source is not currently available for Create This.</p>}</div><div className="technique-actions"><button type="button" disabled={busy} aria-pressed={item.saved} onClick={() => void save(item.item_id, item.saved)}>{item.saved ? 'Unsave' : 'Save'}</button><button type="button" className="primary" disabled={busy || !item.usable || !target} onClick={() => void begin(item.item_id)}>Create This…</button></div></article>)}</section> : <EmptyState title={savedTab ? 'No saved Discover items' : 'No curated Discover items yet'}>Discover content becomes available when sourced items are curated. You can still direct original work from Home.</EmptyState>}
    {preview && <div className="command-scrim"><section className="notification-dialog" role="dialog" aria-modal="true" aria-labelledby="create-this-title"><div className="notification-heading"><h2 id="create-this-title">Preview Create This</h2><button type="button" onClick={() => setPreview(null)}>Close</button></div><p>{preview.impact.meaning}</p><p><strong>Confirmation required:</strong> <code>{preview.impact.confirmation}</code></p><ul>{preview.impact.changes.map((change, index) => <li key={`${change.object}-${index}`}>{change.object}: {change.detail}</li>)}</ul><p>Nothing has been created yet. This adds an attributed description or reference to your TONDE Production; it does not copy the source content.</p><label>Target Production<select value={target} onChange={event => setTarget(event.target.value)}>{productions.map(production => <option key={production.id} value={production.id}>{production.title}</option>)}</select></label><label>Action<select value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="direct_this">Direct This</option><option value="use_technique">Use This Technique</option><option value="attach_reference">Attach as Reference</option></select></label><div className="dialog-actions"><button type="button" onClick={() => setPreview(null)}>Cancel</button><button type="button" className="primary" disabled={busy || !target} onClick={() => void apply()}>Apply with canonical confirmation</button></div></section></div>}
  </div>;
}

export function ProductionKnowledgePage() {
  const { workspaceId, value, loading, error, reload } = useWorkspaceValue<KnowledgeSearch>(id => prompt11Service.knowledge(id));
  const [query, setQuery] = useState('');
  const [searchResult, setSearchResult] = useState<KnowledgeSearch | null>(null);
  useEffect(() => { if (!workspaceId) return; const timer = window.setTimeout(() => { prompt11Service.knowledge(workspaceId, query).then(setSearchResult).catch(() => setSearchResult(null)); }, 200); return () => window.clearTimeout(timer); }, [workspaceId, query]);
  const data = searchResult ?? value;
  return <div className="page"><header className="compact-header"><p className="eyebrow">PRODUCTION KNOWLEDGE</p><h1>Knowledge</h1><p>Documented sources and TONDE adaptations remain separate. Imported or tutorial knowledge is not guidance until independently reviewed.</p></header><label>Search Production Knowledge<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search techniques, equipment guidance…" /></label>{error && <ErrorState message={error} retry={reload} />}{loading && !data ? <LoadingState label="Loading Production Knowledge…" /> : data?.items.length ? <section className="technique-list">{data.items.map(item => <article key={item.item_id} className="technique-row"><div><p className="eyebrow">{item.knowledge_class.replaceAll('_', ' ')} · {item.category} · {item.source_kind}</p><h2>{item.name}</h2><p>{item.description}</p><p>{item.purpose} · {item.effect}</p><p className="subtle">{item.review_state.replaceAll('_', ' ')} · {item.usable_for_guidance ? 'Reviewed for guidance' : 'Not usable as guidance yet'}</p>{item.sources.map((source, index) => <p className="subtle" key={`${source.label}-${index}`}>Source: {source.label}{source.locator ? ` · ${source.locator}` : ''}</p>)}{item.adaptation && <p>TONDE adaptation: {JSON.stringify(item.adaptation)}</p>}</div></article>)}</section> : <EmptyState title="No Production Knowledge items">No reviewed knowledge is available yet. Imported items appear here after review.</EmptyState>}</div>;
}

export function ProductionIntelligencePage() {
  const { productionId } = useParams();
  const { workspaceId } = useAuth();
  const [productions, setProductions] = useState<Production[]>([]);
  const [productionIdValue, setProductionIdValue] = useState(productionId ?? '');
  const [readiness, setReadiness] = useState<DeviceReadiness | null>(null);
  const [scene, setScene] = useState<SceneIntelligence | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!workspaceId) return; let active = true; productionService.list(workspaceId).then(rows => { if (active) { setProductions(rows); if (!productionIdValue && rows[0]) setProductionIdValue(rows[0].id); } }).catch(failure => setError(safeError(failure).message)); return () => { active = false; }; }, [workspaceId]);
  const load = async () => { if (!workspaceId || !productionIdValue) return; setBusy(true); setError(null); try { const [deviceData, sceneData] = await Promise.all([prompt11Service.deviceReadiness(workspaceId, productionIdValue), prompt11Service.sceneIntelligence(workspaceId, productionIdValue)]); setReadiness(deviceData); setScene(sceneData); } catch (failure) { setError(safeError(failure).message); } finally { setBusy(false); } };
  useEffect(() => { if (productionIdValue) void load(); }, [workspaceId, productionIdValue]);
  return <div className="page"><header className="compact-header"><p className="eyebrow">CAMERA & SCENE INTELLIGENCE</p><h1>Devices & Scenes</h1><p>Creator-declared and independently verified capabilities stay distinct. Camera settings are starting points, not guarantees; unknown facts stay unknown.</p></header><label>Production<select value={productionIdValue} onChange={event => setProductionIdValue(event.target.value)}>{productions.map(production => <option key={production.id} value={production.id}>{production.title}</option>)}</select></label>{error && <ErrorState message={error} retry={() => void load()} />}{busy && !readiness ? <LoadingState label="Checking Scene and device intelligence…" /> : readiness && scene ? <><section className="technique-list"><article className="technique-row"><div><h2>Device readiness</h2><p>{readiness.devices.length} declared device(s) · {readiness.shots.length} Shot(s)</p><ul>{readiness.devices.map(device => <li key={device.resource_id}>{device.name} · {device.capability_state.replaceAll('_', ' ')}</li>)}</ul><ul>{readiness.shots.map(shot => <li key={shot.shot_id}>{shot.title ?? shot.shot_id} · {shot.has_real_plan ? 'Real plan exists' : 'No Real plan recorded'}</li>)}</ul></div></article><article className="technique-row"><div><h2>Scene requirements</h2>{scene.requirements.length ? <ul>{scene.requirements.map((requirement, index) => <li key={requirement.requirement_id ?? index}>{requirement.kind}: {requirement.detail} · {requirement.state ?? 'open'}{requirement.mandatory ? ' · required' : ''}</li>)}</ul> : <p>No Scene requirements recorded.</p>}<h3>Known gaps</h3>{scene.gaps.length ? <ul>{scene.gaps.map((gap, index) => <li key={`${gap.reason}-${index}`}>{gap.reason.replaceAll('_', ' ')}{gap.detail ? `: ${gap.detail}` : ''}</li>)}</ul> : <p>No gaps reported by the current intelligence query.</p>}</div></article></section><button type="button" onClick={() => void load()}>Refresh</button></> : !error && <EmptyState title="Choose a Production">Select a Production to inspect camera and Scene requirements.</EmptyState>}<p><Link to="/setup">Manage Production Kit</Link> · <Link to="/discover">Open Discover</Link></p></div>;
}

export function JobsPage() {
  const { workspaceId, value, loading, error, reload, setError } = useWorkspaceValue<JobList>(id => prompt11Service.jobs(id));
  const [busy, setBusy] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const act = async (jobId: string, action: 'cancel' | 'requeue') => {
    if (!workspaceId) return;
    setBusy(jobId); setError(null);
    try { if (action === 'cancel') await prompt11Service.cancelJob(workspaceId, jobId, reason); else await prompt11Service.requeueJob(workspaceId, jobId, reason); setReason(''); reload(); }
    catch (failure) { setError(safeError(failure).message); }
    finally { setBusy(null); }
  };
  return <div className="page"><header className="compact-header"><p className="eyebrow">DURABLE WORK</p><h1>Jobs</h1><p>Recorded processing and review work. Status reflects durable server state; TONDE does not predict completion or invent progress.</p></header><label>Reason for cancellation or reprocessing<input value={reason} maxLength={400} onChange={event => setReason(event.target.value)} placeholder="Why is this action needed?" /></label>{error && <ErrorState message={error} retry={reload} />}{loading && !value ? <LoadingState label="Loading durable jobs…" /> : value?.jobs.length ? <section className="library-list" aria-label="Durable jobs">{value.jobs.map(job => <article key={job.job_id} className="library-row"><span><strong>{job.job_type_display_name ?? job.job_type.replaceAll('_', ' ')}</strong><small>{job.status_label ?? job.status} · attempt {job.attempts} of {job.max_attempts}{typeof job.progress === 'number' ? ` · ${job.progress}% recorded` : ''}</small>{job.state_line && <small>{job.state_line}</small>}{job.error_message && <small role="alert">{job.error_code}: {job.error_message}</small>}</span>{job.production_id && <Link to={`/studio/${job.production_id}`}>Open Production</Link>}{job.cancellable && <button type="button" disabled={busy !== null || !reason.trim()} onClick={() => void act(job.job_id, 'cancel')}>{busy === job.job_id ? 'Requesting…' : 'Request cancellation'}</button>}{['failed', 'dead_letter', 'timed_out'].includes(job.status) && <button type="button" disabled={busy !== null || !reason.trim() || job.reconciliation_required} title={job.reconciliation_required ? 'Establish the real external result before reprocessing.' : undefined} onClick={() => void act(job.job_id, 'requeue')}>Reprocess</button>}</article>)}</section> : <EmptyState title="No durable jobs recorded">Asynchronous work appears here when a supported production operation is queued.</EmptyState>}<button type="button" onClick={reload}>Refresh</button></div>;
}
