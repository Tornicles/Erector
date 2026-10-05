import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Camera, Sparkles, List, FileText, Layers, Film, ArrowUpRight, BookOpen, Compass, Gauge, RefreshCw, Send } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { productionService, PAGE_SIZE, type DirectorCommandResult, type DirectorCommandPreview, type DirectorStudio } from '../services/productions';
import { AppError, safeError } from '../services/errors';
import { useAutosave, useUnsavedNavigation } from '../hooks/useAutosave';
import { ErrorState, LoadingState, PartialState } from '../components/StateComponents';
import { BriefCanvas, DirectorCommandResultPanel, RealityCanvas, ReferenceCanvas, ScriptCanvas, StoryCanvas, TechniqueTable } from '../components/StudioCanvases';
import { formatRuntime, type ExecutionFace, type Production, type Scene } from '../types/domain';
import { DEFAULT_EXECUTION_FACE, PRODUCT } from '../types/product';
export function StudioPage() {
  const { productionId } = useParams(); const { workspaceId } = useAuth();
  const [production, setProduction] = useState<Production | null>(null); const [error, setError] = useState<string | null>(null); const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!workspaceId || !productionId) return;
    let active = true; setProduction(null); setError(null);
    productionService.get(workspaceId, productionId).then(data => {
      if (active) { setProduction(data); localStorage.setItem(`tonde:${workspaceId}:production`, data.id); }
    }).catch(e => { if (active) setError(safeError(e).message); });
    return () => { active = false; };
  }, [workspaceId, productionId, attempt]);
  if (error) return <ErrorState message={error} retry={() => setAttempt(v => v + 1)} />;
  if (!production) return <LoadingState label="Opening your production…" />;
  return <StudioComposition key={production.id} initial={production} reload={() => setAttempt(v => v + 1)} />;
}
const STUDIO_TOOLS: Array<[string, typeof Layers]> = [
  ['Overview', Layers], ['Brief', Compass], ['References', Film], ['Story', BookOpen], ['Script', FileText], ['Reality Check', Gauge], ['Scenes & shots', List],
];
export function StudioComposition({ initial, reload }: { initial: Production; reload: () => void }) {
  const workspaceId = initial.workspace_id;
  const [face, setFace] = useState<ExecutionFace>(DEFAULT_EXECUTION_FACE);
  const [tool, setTool] = useState('Overview'); const [directorOpen, setDirectorOpen] = useState(true);
  const [scenes, setScenes] = useState<Scene[]>([]); const [scenePage, setScenePage] = useState(0); const [sceneLoading, setSceneLoading] = useState(true); const [sceneError, setSceneError] = useState<string | null>(null); const [sceneAttempt, setSceneAttempt] = useState(0);
  const [surface, setSurface] = useState<DirectorStudio | null>(null); const [surfaceLoading, setSurfaceLoading] = useState(true); const [surfaceError, setSurfaceError] = useState<string | null>(null); const [surfaceAttempt, setSurfaceAttempt] = useState(0);
  const persisted = useRef(initial);
  const save = useAutosave(initial.title, async title => {
    if (!title.trim() || title.trim().length > 160) throw new AppError('validation', 'Enter a production title between 1 and 160 characters.');
    persisted.current = await productionService.saveTitle(persisted.current, title);
  });
  useUnsavedNavigation(save.dirty);
  useEffect(() => {
    let active = true; setSceneLoading(true); setSceneError(null);
    productionService.scenes(initial.workspace_id, initial.id, scenePage * PAGE_SIZE).then(data => { if (active) setScenes(data); }).catch(e => { if (active) setSceneError(safeError(e).message); }).finally(() => { if (active) setSceneLoading(false); });
    return () => { active = false; };
  }, [initial.id, initial.workspace_id, scenePage, sceneAttempt]);
  useEffect(() => {
    let active = true; setSurfaceLoading(true); setSurfaceError(null);
    productionService.directorStudioSurface(initial.workspace_id, initial.id).then(data => { if (active) setSurface(data); }).catch(e => { if (active) { setSurface(null); setSurfaceError(safeError(e).message); } }).finally(() => { if (active) setSurfaceLoading(false); });
    return () => { active = false; };
  }, [initial.id, initial.workspace_id, surfaceAttempt]);
  const refresh = () => setSurfaceAttempt(v => v + 1);
  const saveLabels = { idle: 'No unsaved changes', dirty: 'Unsaved changes', saving: 'Saving…', saved: 'Saved', failed: 'Save failed', offline: 'Offline · not saved', conflict: 'Conflict · not saved' };
  const providerLabel = surface ? (surface.provider.configured ? `Director · ${surface.provider.model_profile}` : 'Director · deterministic only') : 'Director · connecting…';
  return <div className="studio-shell">
    <header className="production-header"><div><p className="eyebrow">MASTER PRODUCTION</p><label className="sr-only" htmlFor="production-title">Production title</label><input id="production-title" aria-label="Production title" value={save.value} onChange={e => save.setValue(e.target.value)} maxLength={160} disabled={!!initial.locked_at} /></div><div className="production-meta"><span>{formatRuntime(initial.planned_duration_ms)}</span><span className="pill">{PRODUCT.approvals[initial.approval]}</span><span role="status" title={save.lastSavedAt ? `Last saved ${save.lastSavedAt.toLocaleTimeString()}` : undefined}>{saveLabels[save.state]}</span><span className="pill" title="Export generation is introduced in a later prompt">Export · later</span></div></header>
    {save.error && <div className="save-error" role="alert">{save.error}<button onClick={save.state === 'conflict' ? reload : save.retry}>{save.state === 'conflict' ? 'Reload latest' : 'Retry save'}</button></div>}
    <div className="studio-face-bar"><div role="group" aria-label="Execution face"><button aria-pressed={face === 'real'} className={face === 'real' ? 'selected' : ''} onClick={() => setFace('real')}><Camera size={16} /> {PRODUCT.executionFaces.real.toUpperCase()}</button><button aria-pressed={face === 'ai'} className={face === 'ai' ? 'selected' : ''} onClick={() => setFace('ai')}><Sparkles size={16} /> {PRODUCT.executionFaces.ai.toUpperCase()}</button></div><button className="director-toggle" onClick={() => setDirectorOpen(!directorOpen)} aria-expanded={directorOpen}>{directorOpen ? 'Hide Director' : 'Show Director'}</button><span className="subtle">Shared story. Distinct execution.</span></div>
    <div className={`studio-workspace ${directorOpen ? '' : 'director-hidden'}`}><aside className="production-tools" aria-label="Production tools"><p className="eyebrow">PRODUCTION</p>{STUDIO_TOOLS.map(([name, Icon]) => <button key={name} onClick={() => setTool(name)} aria-pressed={tool === name} className={tool === name ? 'selected' : ''}><Icon size={17} />{name}</button>)}<button onClick={refresh} disabled={surfaceLoading}><RefreshCw size={17} />{surfaceLoading ? 'Refreshing…' : 'Refresh intelligence'}</button></aside>
      <section className="working-canvas" aria-label="Production working canvas"><div className="canvas-heading"><p className="eyebrow">{PRODUCT.executionFaces[face].toUpperCase()} / {tool.toUpperCase()}</p><span className="pill">{providerLabel}</span></div>
        {tool === 'Overview' && <OverviewCanvas surface={surface} surfaceLoading={surfaceLoading} surfaceError={surfaceError} retry={refresh} scenes={scenes} sceneLoading={sceneLoading} sceneError={sceneError} retryScenes={() => setSceneAttempt(v => v + 1)} scenePage={scenePage} setScenePage={setScenePage} face={face} />}
        {tool === 'Scenes & shots' && <SceneOverview scenes={scenes} sceneLoading={sceneLoading} sceneError={sceneError} retry={() => setSceneAttempt(v => v + 1)} scenePage={scenePage} setScenePage={setScenePage} />}
        {(tool === 'Brief' || tool === 'References' || tool === 'Story' || tool === 'Script' || tool === 'Reality Check') && (surfaceLoading ? <LoadingState label="Loading Director intelligence…" /> : surfaceError || !surface ? <PartialState title="Director intelligence is unavailable" action={<button onClick={refresh}>Try again</button>}>{surfaceError ?? 'Connect the TONDE service to load the Brief, Story, Script, References and Reality Check for this Production. Nothing is simulated locally.'}</PartialState> : <>
          {tool === 'Brief' && <BriefCanvas workspaceId={workspaceId} productionId={initial.id} surface={surface} refresh={refresh} />}
          {tool === 'References' && <ReferenceCanvas workspaceId={workspaceId} productionId={initial.id} surface={surface} refresh={refresh} />}
          {tool === 'Story' && <StoryCanvas workspaceId={workspaceId} productionId={initial.id} surface={surface} refresh={refresh} />}
          {tool === 'Script' && <ScriptCanvas workspaceId={workspaceId} productionId={initial.id} surface={surface} refresh={refresh} />}
          {tool === 'Reality Check' && <RealityCanvas workspaceId={workspaceId} productionId={initial.id} surface={surface} refresh={refresh} />}
        </>)}
      </section>
      <DirectorPanel open={directorOpen} workspaceId={workspaceId} productionId={initial.id} surface={surface} refresh={refresh} />
    </div>
    <section className="production-timeline" aria-label="Production timeline"><header><p className="eyebrow">PRODUCTION TIMELINE</p><span>{formatRuntime(initial.planned_duration_ms)}</span></header><div className="timeline-ruler"><span>00:00</span><span>Timeline editing is introduced with the full Studio.</span></div><div className="timeline-track"><span className="playhead" /><p>No timeline segments yet</p></div></section>
  </div>;
}
function SceneOverview({ scenes, sceneLoading, sceneError, retry, scenePage, setScenePage }: { scenes: Scene[]; sceneLoading: boolean; sceneError: string | null; retry: () => void; scenePage: number; setScenePage: (updater: (value: number) => number) => void }) {
  return <div className="scene-overview"><h3>Production hierarchy</h3>{sceneLoading ? <LoadingState label="Loading scene overview…" /> : sceneError ? <ErrorState message={sceneError} retry={retry} /> : scenes.length ? <ol>{scenes.map(scene => <li key={scene.id}><span>{scene.title}</span><span>{formatRuntime(scene.planned_duration_ms)}</span></li>)}</ol> : <p className="subtle">No scenes yet. Acts and sequences are optional; photographs can use shots directly.</p>}<div className="pagination"><button disabled={scenePage === 0 || sceneLoading} onClick={() => setScenePage(v => v - 1)}>Previous</button><span>Scene page {scenePage + 1}</span><button disabled={scenes.length < PAGE_SIZE || sceneLoading} onClick={() => setScenePage(v => v + 1)}>Next</button></div></div>;
}
function OverviewCanvas({ surface, surfaceLoading, surfaceError, retry, scenes, sceneLoading, sceneError, retryScenes, scenePage, setScenePage, face }: { surface: DirectorStudio | null; surfaceLoading: boolean; surfaceError: string | null; retry: () => void; scenes: Scene[]; sceneLoading: boolean; sceneError: string | null; retryScenes: () => void; scenePage: number; setScenePage: (updater: (value: number) => number) => void; face: ExecutionFace }) {
  if (surfaceLoading) return <><div className="canvas-stage"><ClapperboardMark /><h2>Loading the Production truth…</h2><p>Brief, Story, Script, References and Reality Check are loading from your workspace.</p></div><LoadingState label="Loading Director intelligence…" /></>;
  if (!surface) return <><div className="canvas-stage"><span className="stage-corner top-left" /><span className="stage-corner bottom-right" /><ClapperboardMark /><h2>The production starts<br />with your creative truth.</h2><p>{face === 'real' ? 'Physical execution plans attach to the same shots.' : 'Model-specific execution plans attach to the same shots.'}<br />{surfaceError ?? 'Director intelligence is unavailable, so nothing is summarised here.'}</p><button onClick={retry}>Try again</button></div><SceneOverview scenes={scenes} sceneLoading={sceneLoading} sceneError={sceneError} retry={retryScenes} scenePage={scenePage} setScenePage={setScenePage} /></>;
  const fit = surface.runtime_fit;
  return <div className="overview-canvas">
    <div className="canvas-stage overview-stage"><span className="stage-corner top-left" /><span className="stage-corner bottom-right" /><ClapperboardMark /><h2>{surface.story?.title ?? surface.production.title}</h2><p>{surface.story?.logline ?? 'No Story has been written for this Production yet.'}</p></div>
    <ul className="overview-facts">
      <li><strong>Brief</strong><span>{surface.brief ? (surface.brief.producer === 'model' ? 'Model-refined' : 'Deterministic') + ` · revision ${surface.brief_revision ?? 1}` : 'Not written yet'}</span></li>
      <li><strong>Story</strong><span>{surface.story ? `${surface.story.beats.length} beat(s) · ${surface.story.variation.replaceAll('_', ' ')}` : 'Not written yet'}</span></li>
      <li><strong>Script</strong><span>{surface.documents?.script?.content ? 'Persisted Script document' : 'No Script document'}</span></li>
      <li><strong>References</strong><span>{surface.references.length} recorded · {surface.references.filter(reference => reference.status === 'complete').length} fully analysed</span></li>
      <li><strong>Techniques</strong><span>{surface.techniques.length} extracted</span></li>
      <li><strong>Runtime</strong><span>{fit.status.replaceAll('_', ' ')} · target {formatRuntime(fit.target_ms)} · assigned {formatRuntime(fit.assigned_ms)}</span></li>
      <li><strong>Reality</strong><span>{surface.reality ? `${surface.reality.feasibility} · ${surface.reality.complexity} complexity` : 'Not checked yet'}</span></li>
      <li><strong>Provider</strong><span>{surface.provider.configured ? `${surface.provider.provider} (${surface.provider.model_profile})` : 'No model provider configured — deterministic direction only'}{surface.provider.ffmpeg_available === false ? ' · frame extraction unavailable' : ''}</span></li>
    </ul>
    <section aria-label="Extracted techniques"><h3>Techniques carried into this Production</h3><TechniqueTable techniques={surface.techniques} /></section>
    {surface.operations.length > 0 && <section aria-label="Director operations"><h3>Director operation history</h3><ul className="operation-log">{surface.operations.map(operation => <li key={operation.operation_id}><p><strong>{operation.operation_type.replaceAll('_', ' ')}</strong> · {operation.scope} · {operation.status} · {operation.producer}{operation.repaired ? ' · repaired' : ''}</p><p className="subtle">{operation.rationale ?? 'No rationale recorded.'}</p><p className="subtle">{operation.provider ? `${operation.provider} · ` : ''}{operation.model ?? 'no model'} · key {operation.idempotency_key ?? 'none'}</p>{operation.limitations.length > 0 && <p className="subtle">Limitations: {operation.limitations.join(', ')}</p>}</li>)}</ul></section>}
    <SceneOverview scenes={scenes} sceneLoading={sceneLoading} sceneError={sceneError} retry={retryScenes} scenePage={scenePage} setScenePage={setScenePage} />
  </div>;
}
function DirectorPanel({ open, workspaceId, productionId, surface, refresh }: { open: boolean; workspaceId: string; productionId: string; surface: DirectorStudio | null; refresh: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<DirectorCommandPreview | null>(null);
  const [result, setResult] = useState<DirectorCommandResult | null>(null);
  const examples = ['Make Scene 1 more intense.', 'Why does this feel premium?', 'Make it 15 seconds.', 'Remove the dialogue.', 'Make this shootable with my setup', 'Give me three alternative endings'];
  const run = async (apply: boolean, direction: string) => {
    if (!direction.trim()) return;
    setBusy(true); setError(null); setPreview(null);
    try {
      const payload = await productionService.directorCommand(workspaceId, productionId, { text: direction.trim(), apply, expected_production_revision: surface?.production.revision });
      setResult(payload);
      if (apply) setText('');
      refresh();
    } catch (failure) { setError(safeError(failure).message); }
    finally { setBusy(false); }
  };
  const showPreview = async () => {
    if (!text.trim()) return;
    setBusy(true); setError(null);
    try { setPreview(await productionService.directorCommandPreview(workspaceId, productionId, text.trim())); }
    catch (failure) { setError(safeError(failure).message); }
    finally { setBusy(false); }
  };
  return <aside className={`director-panel ${open ? 'director-open' : 'director-collapsed'}`} aria-label="TONDE Director"><div className="director-heading"><span className="director-symbol">T</span><div><h2>TONDE Director</h2><p>{surface ? (surface.provider.configured ? 'Model-assisted production intelligence' : 'Deterministic production intelligence · no provider configured') : 'Connecting to production intelligence'}</p></div></div>
    {!open ? null : <>
      <label>Message to the Director<textarea aria-label="Message to the Director" value={text} onChange={event => setText(event.target.value)} placeholder="“Make Scene 1 more intense.”" rows={4} /></label>
      <div className="director-examples" role="group" aria-label="Example directions">{examples.map(example => <button type="button" key={example} disabled={busy} onClick={() => setText(example)}>{example}</button>)}</div>
      <div className="director-actions"><button type="button" disabled={busy || !text.trim()} onClick={() => void showPreview()}>Preview</button><button type="button" className="primary" disabled={busy || !text.trim()} onClick={() => void run(false, text)}>Send direction <ArrowUpRight size={14} /></button></div>
      {preview && <div className="command-preview" role="status"><p className="eyebrow">{preview.kind.replaceAll('_', ' ')} · {preview.scope} · confidence {preview.confidence}</p><p>{preview.rationale}</p><p className="subtle">Operations: {preview.operations.join(', ') || 'none'}{preview.scene_order ? ` · Scene ${preview.scene_order}` : ''}{preview.target_runtime_ms ? ` · ${formatRuntime(preview.target_runtime_ms)}` : ''}{preview.reference_role ? ` · reference role ${preview.reference_role}` : ''}</p></div>}
      {error && <p role="alert" className="error-text">{error}</p>}
      {result && <><DirectorCommandResultPanel result={result} />{!result.applied && result.plan && <button type="button" className="primary" disabled={busy} onClick={() => void run(true, text)}><Send size={14} />Apply to this Production</button>}</>}
      {result && <button type="button" className="text-link" onClick={() => { setResult(null); setPreview(null); setText(''); }}>Clear Director answer</button>}
    </>}
  </aside>;
}
function ClapperboardMark() { return <Film size={42} strokeWidth={1} aria-hidden="true" />; }
