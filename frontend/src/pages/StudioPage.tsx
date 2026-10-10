import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  BookOpen, Camera, Clapperboard, Compass, FileText, Film, Gauge, Layers, Lightbulb,
  List, Library, Music, Network, Scissors, Send, ShieldCheck, Sparkles, Users, Package, PackageCheck, Palette, Shirt, Target, Repeat, Rows, GitBranch, ClipboardCheck,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  productionService, type DirectorStudio,
  type StudioApproval, type StudioReadModel, type StudioScene, type StudioShot, type StudioWriteResult,
} from '../services/productions';
import { AppError, safeError } from '../services/errors';
import { useAutosave, useUnsavedNavigation } from '../hooks/useAutosave';
import { ErrorState, LoadingState, PartialState } from '../components/StateComponents';
import { BriefCanvas, RealityCanvas, ReferenceCanvas, ScriptCanvas, StoryCanvas, TechniqueTable } from '../components/StudioCanvases';
import { AssetCanvas, AudioCanvas, FoundationCanvas, SceneCanvas, ShotCanvas, TimingInspector } from '../studio/StudioCanvases5';
import { HybridBoard, IdeaLabCanvas, STUDIO_RAIL, StudioDrawer, StudioInspector, StudioTopBar, viewForTool, type StudioMode } from '../studio/StudioEight';
import { StudioTimeline, approvalLabel, formatMs, type TimelineZoom } from '../studio/StudioTimeline';
import { RealProductionCanvas } from '../studio/RealProduction';
import { AiCreationCanvas } from '../studio/AICreation';
import { MovieModeCanvas } from '../studio/MovieMode';
import { SeriesStudioCanvas } from '../studio/SeriesStudio';
import { ProductionIntelligenceCanvas } from '../studio/ProductionIntelligence';
import { ProductionContinuityCanvas } from '../studio/ProductionContinuity';
import { ProductionMemoryCanvas } from '../studio/ProductionMemory';
import { ProductionVersioningCanvas } from '../studio/ProductionVersioning';
import { ProductionReadinessCanvas } from '../studio/ProductionReadiness';
import { PublishingCanvas } from '../prompt10/Publishing';
import { ExportsCanvas } from '../prompt10/Exports';
import { ProductionShotMatchCanvas } from '../studio/ProductionShotMatch';
import { type ExecutionFace, type Production } from '../types/domain';
import { DEFAULT_EXECUTION_FACE, PRODUCT } from '../types/product';

type StudioTool =
  | 'Brief' | 'References' | 'Story' | 'Script' | 'Reality Check'
  | 'Real Production' | 'AI Creation' | 'Hybrid' | 'Idea' | 'Movie Mode' | 'Series'
  | 'Scenes' | 'Shots' | 'Impact' | 'Continuity' | 'Memory' | 'Versions' | 'Readiness'
  | 'Publishing' | 'Exports'
  | 'Characters' | 'World' | 'Products' | 'Wardrobe' | 'Style'
  | 'Prompts' | 'Audio' | 'Edit' | 'Results';

// Each execution face has a face of its own, but both are the same Production with the same Shots.
const FACE_TOOL: Record<ExecutionFace, StudioTool> = { real: 'Real Production', ai: 'AI Creation' };
const FACE_TOOL_NAMES: StudioTool[] = ['Real Production', 'AI Creation'];

const TOOLS: Array<{ name: StudioTool; icon: typeof Layers; group: 'creative' | 'execution' }> = [
  { name: 'Brief', icon: Compass, group: 'creative' },
  { name: 'Story', icon: BookOpen, group: 'creative' },
  { name: 'Script', icon: FileText, group: 'creative' },
  { name: 'Movie Mode', icon: Rows, group: 'creative' },
  { name: 'Impact', icon: Network, group: 'creative' },
  { name: 'Continuity', icon: ShieldCheck, group: 'creative' },
  { name: 'Memory', icon: Library, group: 'creative' },
  { name: 'Versions', icon: GitBranch, group: 'creative' },
  { name: 'Scenes', icon: List, group: 'creative' },
  { name: 'Shots', icon: Clapperboard, group: 'creative' },
  { name: 'References', icon: Film, group: 'creative' },
  { name: 'Real Production', icon: Camera, group: 'execution' },
  { name: 'AI Creation', icon: Sparkles, group: 'execution' },
  { name: 'Characters', icon: Users, group: 'execution' },
  { name: 'World', icon: Layers, group: 'execution' },
  { name: 'Products', icon: Package, group: 'execution' },
  { name: 'Wardrobe', icon: Shirt, group: 'execution' },
  { name: 'Style', icon: Palette, group: 'execution' },
  { name: 'Prompts', icon: Lightbulb, group: 'execution' },
  { name: 'Audio', icon: Music, group: 'execution' },
  { name: 'Edit', icon: Scissors, group: 'execution' },
  { name: 'Results', icon: Target, group: 'execution' },
  { name: 'Series', icon: Repeat, group: 'execution' },
  { name: 'Readiness', icon: ClipboardCheck, group: 'execution' },
  { name: 'Publishing', icon: Send, group: 'execution' },
  { name: 'Exports', icon: PackageCheck, group: 'execution' },
  { name: 'Reality Check', icon: Gauge, group: 'execution' },
];

const SAVE_LABELS = { idle: 'No unsaved changes', dirty: 'Unsaved changes', saving: 'Saving…', saved: 'Saved', failed: 'Save failed', offline: 'Offline · not saved', conflict: 'Conflict · not saved' } as const;

export function StudioPage() {
  const { productionId } = useParams();
  const { workspaceId } = useAuth();
  const [production, setProduction] = useState<Production | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!workspaceId || !productionId) return;
    let active = true; setProduction(null); setError(null);
    productionService.get(workspaceId, productionId).then(data => {
      if (active) { setProduction(data); localStorage.setItem(`tonde:${workspaceId}:production`, data.id); }
    }).catch(failure => { if (active) setError(safeError(failure).message); });
    return () => { active = false; };
  }, [workspaceId, productionId, attempt]);
  if (error) return <ErrorState message={error} retry={() => setAttempt(value => value + 1)} />;
  if (!production) return <LoadingState label="Opening your production…" />;
  return <StudioComposition key={production.id} initial={production} reload={() => setAttempt(value => value + 1)} />;
}

export function StudioComposition({ initial, reload }: { initial: Production; reload: () => void }) {
  const workspaceId = initial.workspace_id;
  const [params, setParams] = useSearchParams();
  const [face, setFace] = useState<ExecutionFace>(DEFAULT_EXECUTION_FACE);
  const [directorOpen, setDirectorOpen] = useState(true);
  const [zoom, setZoom] = useState<TimelineZoom>('scene');
  const [model, setModel] = useState<StudioReadModel | null>(null);
  const [modelLoading, setModelLoading] = useState(true);
  const [modelError, setModelError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [surface, setSurface] = useState<DirectorStudio | null>(null);
  const [surfaceError, setSurfaceError] = useState<string | null>(null);
  const [surfaceAttempt, setSurfaceAttempt] = useState(0);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const persisted = useRef(initial);

  const requestedTool = (params.get('tool') as StudioTool) ?? 'Scenes';
  // The face bar and the tool list must agree: a deep link to the AI face opens AI Creation,
  // and an unknown tool name falls back rather than rendering a blank canvas.
  // Idea and Hybrid are Studio views over the same vocabulary, not separate backends.
  const tool = requestedTool === 'Idea' || requestedTool === 'Hybrid' ? requestedTool
    : FACE_TOOL_NAMES.includes(requestedTool) ? requestedTool : (TOOLS.some(item => item.name === requestedTool) ? requestedTool : 'Scenes');
  const selectedSceneId = params.get('scene');
  const selectedShotId = params.get('shot');
  // React Router builds its params from the render that created the writer, so a handler
  // can hold a query that is already out of date. Every Studio URL write therefore merges
  // against this ref, which is always the live query: a deep-link repair and a selection
  // made in the same tick compose instead of one silently replacing the other.
  const liveSearch = useRef(params.toString());
  liveSearch.current = params.toString();
  const writeParams = useCallback((mutate: (search: URLSearchParams) => void) => {
    const search = new URLSearchParams(liveSearch.current);
    mutate(search);
    liveSearch.current = search.toString();
    setParams(search, { replace: true });
  }, [setParams]);
  // Selection writes merge against the live query rather than a snapshot captured when the
  // handler was created: a deep-link repair resolving in the same tick must not clobber a
  // selection the creator just made, and vice versa.
  const setUrl = useCallback((next: { tool?: StudioTool; scene?: string | null; shot?: string | null; series?: string | null }) => {
    writeParams(search => {
      if (next.tool !== undefined) search.set('tool', next.tool);
      if (next.scene !== undefined) next.scene ? search.set('scene', next.scene) : search.delete('scene');
      if (next.shot !== undefined) next.shot ? search.set('shot', next.shot) : search.delete('shot');
      if (next.series !== undefined) next.series ? search.set('series', next.series) : search.delete('series');
    });
  }, [writeParams]);

  // A deep link carries the face implicitly through its tool, so the face bar follows the tool.
  // The creator's own face choice is preserved for every other tool.
  useEffect(() => {
    if (tool === FACE_TOOL.ai) setFace('ai');
    else if (tool === FACE_TOOL.real) setFace('real');
  }, [tool]);

  const scenes = model?.scenes ?? [];
  const selectedScene = scenes.find(scene => scene.id === selectedSceneId) ?? null;
  const selectedShot = useMemo(() => {
    if (!selectedShotId) return null;
    return scenes.flatMap(scene => scene.shots).find(shot => shot.id === selectedShotId)
      ?? model?.orphan_shots.find(shot => shot.id === selectedShotId) ?? null;
  }, [scenes, model, selectedShotId]);

  const title = useAutosave(initial.title, async next => {
    if (!next.trim() || next.trim().length > 160) throw new AppError('validation', 'Enter a production title between 1 and 160 characters.');
    persisted.current = await productionService.saveTitle(persisted.current, next);
  });
  useUnsavedNavigation(title.dirty);

  const refresh = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    let active = true; setModelLoading(true); setModelError(null);
    productionService.studioSurface(workspaceId, initial.id).then(data => {
      if (!active) return;
      // A read model must be a real projection; an empty or malformed response is an error,
      // never something to render as an empty Studio.
      if (!data || !Array.isArray(data.scenes) || !data.timing) {
        throw new AppError('unavailable', 'The Studio could not read this Production. Nothing is shown rather than an invented structure.');
      }
      setModel(data); setConflict(false);
      // A deep link must never silently open the wrong Production context, and the query is
      // canonicalised in the same step so a hand-typed tool name cannot leave an unstable URL.
      writeParams(search => {
        if (!search.get('tool')) search.set('tool', 'Scenes');
        if (!search.get('scene') && data.scenes.length > 0) search.set('scene', data.scenes[0].id);
      });
    }).catch(failure => {
      if (!active) return;
      const error = safeError(failure);
      setModel(null);
      setModelError(error.kind === 'conflict' ? `${error.message} Reload to see the newer Production state.` : error.message);
    }).finally(() => { if (active) setModelLoading(false); });
    return () => { active = false; };
    // Deliberately keyed on the Production only: the deep-link repair below reads the
    // current params without re-fetching the Production on every selection change.
  }, [workspaceId, initial.id, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let active = true; setSurfaceError(null);
    productionService.directorStudioSurface(workspaceId, initial.id).then(data => { if (active) setSurface(data); })
      .catch(failure => { if (active) { setSurface(null); setSurfaceError(safeError(failure).message); } });
    return () => { active = false; };
  }, [workspaceId, initial.id, surfaceAttempt]);

  const run = useCallback(async <T,>(action: () => Promise<T>, describe: (result: T) => string): Promise<T | null> => {
    setBusy(true); setActionError(null); setActionNote(null);
    try {
      const result = await action();
      setActionNote(describe(result));
      refresh(); setSurfaceAttempt(value => value + 1);
      return result;
    } catch (failure) {
      const error = safeError(failure);
      setActionError(error.message);
      if (error.kind === 'conflict') setConflict(true);
      return null;
    } finally { setBusy(false); }
  }, [refresh]);

  const describeTiming = (result: StudioWriteResult) => result.timing
    ? `Saved. Runtime ${result.timing.status}${result.timing.delta_ms ? ` by ${formatMs(Math.abs(result.timing.delta_ms))}` : ''}.`
    : 'Saved.';
  // Edited approved content stops being approved; the creator is told immediately.
  const describeWrite = (result: StudioWriteResult) => result.approval === 'changed_after_approval'
    ? `${describeTiming(result)} This was approved content, so it is now Changed After Approval - review it again.`
    : describeTiming(result);

  const sceneActions = {
    create: (input: Record<string, unknown>) => run(
      () => productionService.createStudioScene(workspaceId, initial.id, input),
      result => { if (result.scene_id) setUrl({ scene: result.scene_id, shot: null }); return describeTiming(result); }),
    update: (scene: StudioScene, patch: Record<string, unknown>) => run(
      () => productionService.updateStudioScene(workspaceId, initial.id, scene.id, patch), describeWrite),
    duplicate: (scene: StudioScene) => run(
      () => productionService.createStudioScene(workspaceId, initial.id, {
        title: `${scene.title} copy`, purpose: scene.purpose, story_beat: scene.story_beat,
        description: scene.description, opening_state: scene.opening_state, ending_state: scene.ending_state,
        visual_intent: scene.visual_intent, dialogue_notes: scene.dialogue_notes,
        expected_production_revision: model?.production.revision,
      }), describeTiming),
    archive: (scene: StudioScene, cascade: boolean) => run(
      () => productionService.archiveStudioScene(workspaceId, initial.id, scene.id, scene.revision, cascade),
      result => { if (selectedSceneId === scene.id) setUrl({ scene: null, shot: null }); return `Archived Scene${result.archived_shots ? ` and ${result.archived_shots} Shot(s)` : ''}. Content is archived, not deleted.`; }),
    move: (scene: StudioScene, direction: -1 | 1) => {
      const ordered = scenes.map(item => item.id);
      const index = ordered.indexOf(scene.id);
      const target = index + direction;
      if (target < 0 || target >= ordered.length) return Promise.resolve(null);
      [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
      return run(() => productionService.reorderStudioScenes(workspaceId, initial.id, ordered, model?.production.revision),
        result => `Scene order saved (${result.scenes ?? ordered.length} Scenes).`);
    },
    drop: (draggedId: string, targetId: string) => {
      const ordered = scenes.map(item => item.id);
      const from = ordered.indexOf(draggedId);
      const to = ordered.indexOf(targetId);
      if (from < 0 || to < 0 || from === to) return Promise.resolve(null);
      ordered.splice(to, 0, ordered.splice(from, 1)[0]);
      return run(() => productionService.reorderStudioScenes(workspaceId, initial.id, ordered, model?.production.revision),
        result => `Scene order saved (${result.scenes ?? ordered.length} Scenes).`);
    },
    toggleLock: (scene: StudioScene) => run(
      () => productionService.setStudioLock(workspaceId, initial.id, 'scene', scene.id, !scene.locked_at, scene.revision),
      result => `${result.locked ? 'Locked' : 'Unlocked'} the Scene.`),
    approve: (scene: StudioScene, approval: StudioApproval) => run(
      () => productionService.setStudioApproval(workspaceId, initial.id, 'scene', scene.id, approval, scene.revision),
      result => `Scene is ${approvalLabel(result.approval)}.`),
    reconcile: (scene: StudioScene) => run(
      () => productionService.reconcileStudioRuntime(workspaceId, initial.id, scene.id, model?.production.revision),
      result => result.adjusted_ms === 0 ? 'The runtime already matches its target.' : `Adjusted the last Shot of that Scene by ${result.adjusted_ms} ms.`),
  };

  const shotActions = {
    create: (input: Record<string, unknown>) => run(
      () => productionService.createStudioShot(workspaceId, initial.id, input),
      result => { if (result.shot_id) setUrl({ shot: result.shot_id }); return describeTiming(result); }),
    update: (shot: StudioShot, patch: Record<string, unknown>) => run(
      () => productionService.updateStudioShot(workspaceId, initial.id, shot.id, patch), describeWrite),
    duplicate: (shot: StudioShot) => run(
      () => productionService.createStudioShot(workspaceId, initial.id, {
        scene_id: shot.scene_id, title: `${shot.title} copy`, description: shot.description, action: shot.action,
        purpose: shot.purpose, subject: shot.subject, framing: shot.framing, angle: shot.angle, movement: shot.movement,
        composition: shot.composition, transition: shot.transition, story_relationship: shot.story_relationship,
        creative_notes: shot.creative_notes, execution_method: shot.execution_method,
        duration_ms: shot.planned_duration_ms, expected_production_revision: model?.production.revision,
      }), describeTiming),
    archive: (shot: StudioShot) => run(
      () => productionService.archiveStudioShot(workspaceId, initial.id, shot.id, shot.revision),
      () => { if (selectedShotId === shot.id) setUrl({ shot: null }); return 'Archived the Shot. It stays readable and out of the live order.'; }),
    move: (shot: StudioShot, direction: -1 | 1) => {
      const scene = scenes.find(item => item.id === shot.scene_id);
      if (!scene) return Promise.resolve(null);
      const ordered = scene.shots.map(item => item.id);
      const index = ordered.indexOf(shot.id);
      const target = index + direction;
      if (target < 0 || target >= ordered.length) return Promise.resolve(null);
      [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
      return run(() => productionService.reorderStudioShots(workspaceId, initial.id, scene.id, ordered, model?.production.revision),
        result => `Shot order saved (${result.shots ?? ordered.length} Shots in the Scene).`);
    },
    drop: (draggedId: string, targetId: string, sceneId: string) => {
      const scene = scenes.find(item => item.id === sceneId);
      if (!scene) return Promise.resolve(null);
      const ordered = scene.shots.map(item => item.id);
      const from = ordered.indexOf(draggedId);
      const to = ordered.indexOf(targetId);
      if (from < 0 || to < 0 || from === to) return Promise.resolve(null);
      ordered.splice(to, 0, ordered.splice(from, 1)[0]);
      return run(() => productionService.reorderStudioShots(workspaceId, initial.id, sceneId, ordered, model?.production.revision),
        result => `Shot order saved (${result.shots ?? ordered.length} Shots in the Scene).`);
    },
    moveToScene: (shot: StudioShot, sceneId: string) => run(
      () => productionService.moveStudioShot(workspaceId, initial.id, shot.id, sceneId, shot.revision),
      result => `Moved the Shot to Scene ${scenes.find(scene => scene.id === result.scene_id)?.order ?? ''}.`),
    toggleLock: (shot: StudioShot) => run(
      () => productionService.setStudioLock(workspaceId, initial.id, 'shot', shot.id, !shot.locked_at, shot.revision),
      result => `${result.locked ? 'Locked' : 'Unlocked'} the Shot.`),
    approve: (shot: StudioShot, approval: StudioApproval) => run(
      () => productionService.setStudioApproval(workspaceId, initial.id, 'shot', shot.id, approval, shot.revision),
      result => `Shot is ${approvalLabel(result.approval)}.`),
    bulk: (shotIds: string[], patch: { execution_method?: StudioShot['execution_method']; approval?: StudioApproval }) => {
      const targets = scenes.flatMap(scene => scene.shots).filter(shot => shotIds.includes(shot.id));
      return run(async () => {
        for (const shot of targets) {
          if (patch.execution_method) await productionService.updateStudioShot(workspaceId, initial.id, shot.id, { expected_revision: shot.revision, execution_method: patch.execution_method });
          if (patch.approval) await productionService.setStudioApproval(workspaceId, initial.id, 'shot', shot.id, patch.approval, shot.revision + (patch.execution_method ? 1 : 0));
        }
        return { count: targets.length };
      }, result => `Updated ${result.count} Shot(s) with the same change.`);
    },
  };

  const providerLabel = model ? (model.provider.configured ? `Director · ${model.provider.model_profile}` : 'Director · deterministic only') : 'Director · connecting…';
  const mode: StudioMode = tool === 'Hybrid' ? 'hybrid' : face;
  const view = viewForTool(tool);
  const setMode = (next: StudioMode) => {
    if (next === 'hybrid') { setUrl({ tool: 'Hybrid' }); return; }
    setFace(next);
    if (tool === 'AI Creation' || tool === 'Real Production') setUrl({ tool: FACE_TOOL[next] });
  };

  return <div className="studio-shell studio5-shell">
    <StudioTopBar
      typeBadge={PRODUCT.productionTypes[initial.production_type as keyof typeof PRODUCT.productionTypes] ?? initial.production_type.replaceAll('_', ' ')}
      titleEditor={<><label className="sr-only" htmlFor="production-title">Production title</label>
        <input id="production-title" aria-label="Production title" value={title.value}
          onChange={event => title.setValue(event.target.value)} maxLength={160} disabled={!!initial.locked_at} /></>}
      saveState={SAVE_LABELS[title.state]}
      reviewCount={model?.status_summary.needs_attention ?? 0}
      mode={mode} onMode={setMode}
      onPreview={() => setUrl({ tool: 'Movie Mode' })}
      onShare={() => setUrl({ tool: 'Publishing' })}
      onExport={() => setUrl({ tool: 'Exports' })}
      directorOpen={directorOpen} onToggleDirector={() => setDirectorOpen(value => !value)}
    />

    {title.error && <div className="save-error" role="alert">{title.error}
      <button onClick={title.state === 'conflict' ? reload : title.retry}>{title.state === 'conflict' ? 'Reload latest' : 'Retry save'}</button></div>}
    {conflict && <div className="save-error" role="alert">
      This Production changed in another session. Reload before applying your change.
      <button onClick={() => { setConflict(false); refresh(); }}>Reload Studio</button>
    </div>}
    {actionError && <div className="save-error" role="alert">{actionError}<button onClick={() => setActionError(null)}>Dismiss</button></div>}
    {actionNote && <p className="studio5-note" role="status">{actionNote}</p>}

    <div className="studio-workspace">
      <nav className="s8-rail" aria-label="Studio functions">
        {STUDIO_RAIL.map(({ view: itemView, label, access, icon: Icon }) => {
          const active = view === itemView;
          const open = () => {
            if (itemView === 'idea') setUrl({ tool: 'Idea' });
            else if (itemView === 'story') setUrl({ tool: 'Story' });
            else if (itemView === 'script') setUrl({ tool: 'Script' });
            else if (itemView === 'scenes') setUrl({ tool: 'Scenes' });
            else if (itemView === 'shots') setUrl({ tool: 'Shots' });
            else if (itemView === 'produce') setUrl({ tool: face === 'ai' ? 'AI Creation' : 'Real Production' });
            else if (itemView === 'edit') setUrl({ tool: 'Audio' });
            else setUrl({ tool: 'Results' });
          };
          // Names come from visible content exactly like the previous toolbox, so role
          // queries keep working; only Edit carries an aria-label because the legacy
          // Edit tool in All studio tools shares its visible name.
          return <button key={itemView} type="button" aria-label={itemView === 'edit' ? access : undefined}
            title={access} aria-pressed={active}
            className={active ? 'active' : ''} onClick={open}><Icon size={17} aria-hidden="true" /><span>{label}</span></button>;
        })}
      </nav>
      {model ? <StudioDrawer view={view} model={model} surface={surface}
        selectedSceneId={selectedSceneId} selectedShotId={selectedShotId}
        onSelectScene={sceneId => setUrl({ scene: sceneId, shot: null })}
        onSelectShot={(sceneId, shotId) => setUrl({ scene: sceneId, shot: shotId })}
        onOpenTool={name => setUrl({ tool: name as StudioTool })}
        allTools={TOOLS.filter(item => !['Story', 'Script', 'Scenes', 'Shots', 'Results'].includes(item.name))}
        activeTool={tool} />
        : <aside className="s8-drawer" aria-label="Loading Studio tools"><LoadingState label="Loading tools…" /></aside>}

      <section className="working-canvas" aria-label="Production working canvas">
        <div className="canvas-heading">
          <p className="eyebrow">{PRODUCT.executionFaces[face].toUpperCase()} / {tool.toUpperCase()}</p>
          <span className="pill">{approvalLabel(model?.production.approval ?? initial.approval)}</span>
          {model && <span className="pill">{providerLabel}</span>}
        </div>
        {modelLoading && !model
          ? <LoadingState label="Loading this Production's Studio…" />
          : modelError && !model
            ? <PartialState title="The Studio could not read this Production" action={<button onClick={() => { setModelError(null); refresh(); }}>Try again</button>}>
              {modelError}
            </PartialState>
            : model && <>
              {tool === 'Scenes' && <SceneCanvas model={model} scene={selectedScene} busy={busy}
                onSelectScene={sceneId => setUrl({ scene: sceneId, shot: null })}
                onCreate={sceneActions.create} onUpdate={sceneActions.update} onDuplicate={sceneActions.duplicate}
                onArchive={sceneActions.archive} onMove={sceneActions.move} onToggleLock={sceneActions.toggleLock}
                onApprove={sceneActions.approve} onReconcile={sceneActions.reconcile} />}
              {tool === 'Shots' && <ShotCanvas model={model} scene={selectedScene} shot={selectedShot} busy={busy}
                onSelect={(sceneId, shotId) => setUrl({ scene: sceneId, shot: shotId })}
                onCreate={shotActions.create} onUpdate={shotActions.update} onDuplicate={shotActions.duplicate}
                onArchive={shotActions.archive} onMove={shotActions.move} onMoveToScene={shotActions.moveToScene}
                onToggleLock={shotActions.toggleLock} onApprove={shotActions.approve} onBulk={shotActions.bulk} />}
              {tool === 'Real Production' && <RealProductionCanvas workspaceId={workspaceId}
                productionId={initial.id} model={model} timing={model.timing} surface={surface} busy={busy}
                selectedShotId={selectedShotId}
                onSelectShot={(sceneId, shotId) => setUrl({ scene: sceneId, shot: shotId })} onChanged={refresh} />}
              {tool === 'AI Creation' && <AiCreationCanvas workspaceId={workspaceId} productionId={initial.id}
                busy={busy} selectedShotId={selectedShotId}
                onSelectShot={(sceneId, shotId) => setUrl({ scene: sceneId, shot: shotId })} onChanged={refresh} />}
              {tool === 'Movie Mode' && <MovieModeCanvas workspaceId={workspaceId} productionId={initial.id}
                selectedSceneId={selectedSceneId} selectedShotId={selectedShotId} busy={busy}
                onSelectScene={sceneId => setUrl({ scene: sceneId, shot: null })}
                onSelectShot={(sceneId, shotId) => setUrl({ scene: sceneId, shot: shotId })} onChanged={refresh} />}
              {tool === 'Series' && <SeriesStudioCanvas workspaceId={workspaceId} projectId={initial.project_id}
                seriesId={params.get('series')} onSelectSeries={seriesId => setUrl({ series: seriesId })} />}
              {tool === 'Impact' && <ProductionIntelligenceCanvas workspaceId={workspaceId} productionId={initial.id}
                assets={(model?.assets ?? []).map(asset => ({ id: asset.id, name: asset.name, asset_type: asset.asset_type }))}
                selectedSceneId={selectedSceneId} selectedShotId={selectedShotId}
                sceneTitle={selectedScene?.title ?? null} shotTitle={selectedShot?.title ?? null}
                productionTitle={initial.title} busy={busy} onChanged={refresh} />}
              {tool === 'Continuity' && <ProductionContinuityCanvas workspaceId={workspaceId} productionId={initial.id}
                assets={(model?.assets ?? []).map(asset => ({ id: asset.id, name: asset.name, asset_type: asset.asset_type }))}
                selectedSceneId={selectedSceneId} selectedShotId={selectedShotId}
                sceneTitle={selectedScene?.title ?? null} shotTitle={selectedShot?.title ?? null}
                busy={busy} onChanged={refresh} />}
              {tool === 'Memory' && <ProductionMemoryCanvas workspaceId={workspaceId} productionId={initial.id}
                assets={(model?.assets ?? []).map(asset => ({ id: asset.id, name: asset.name, asset_type: asset.asset_type }))}
                busy={busy} onChanged={refresh} />}
              {tool === 'Versions' && <ProductionVersioningCanvas workspaceId={workspaceId} productionId={initial.id}
                targets={[
                  ...Object.entries(model?.documents ?? {}).flatMap(([key, document]) => document?.document_id
                    ? [{ id: document.document_id, label: document.title ?? key, kind: 'creative_document',
                        scope: (key === 'script' ? 'script' : 'story') as 'script' | 'story' }] : []),
                  ...(model?.scenes ?? []).map(scene => ({ id: scene.id, label: scene.title, kind: 'scene', scope: 'scene' as const })),
                  ...(model?.scenes ?? []).flatMap(scene => scene.shots.map(shot => ({ id: shot.id, label: shot.title, kind: 'shot', scope: 'shot' as const }))),
                  ...(model?.assets ?? []).map(asset => ({ id: asset.id, label: asset.name, kind: 'asset', scope: 'asset' as const })),
                ]}
                busy={busy} onChanged={refresh} />}
              {tool === 'Readiness' && <ProductionReadinessCanvas workspaceId={workspaceId}
                productionId={initial.id}
                targets={[
                  { id: initial.id, label: `${initial.title} (Production)`, kind: 'production' },
                  ...Object.entries(model?.documents ?? {}).flatMap(([key, document]) => document?.document_id
                    ? [{ id: document.document_id, label: document.title ?? key, kind: 'creative_document' }] : []),
                  ...(model?.scenes ?? []).map(scene => ({ id: scene.id, label: scene.title, kind: 'scene' })),
                  ...(model?.scenes ?? []).flatMap(scene => scene.shots.map(shot => ({ id: shot.id, label: shot.title, kind: 'shot' }))),
                ]}
                busy={busy} onChanged={refresh}
                onOpen={(objectId, kind) => {
                  if (kind === 'scene') { setUrl({ scene: objectId, shot: null }); return; }
                  if (kind === 'shot') {
                    const owning = (model?.scenes ?? []).find(scene => scene.shots.some(shot => shot.id === objectId));
                    setUrl(owning ? { scene: owning.id, shot: objectId } : { shot: objectId });
                  }
                }} />}
              {tool === 'Publishing' && <PublishingCanvas workspaceId={workspaceId} productionId={initial.id} />}
              {tool === 'Exports' && <ExportsCanvas workspaceId={workspaceId} productionId={initial.id} />}
              {['Characters', 'World', 'Products', 'Wardrobe', 'Style'].includes(tool) &&
                <AssetCanvas model={model} tool={tool} busy={busy} onSelectAsset={setSelectedAssetId} />}
              {tool === 'Idea' && (surfaceError && !surface
                ? <PartialState title="Director intelligence is unavailable" action={<button onClick={() => setSurfaceAttempt(value => value + 1)}>Try again</button>}>{surfaceError}</PartialState>
                : !surface ? <LoadingState label="Loading Director intelligence…" />
                  : <IdeaLabCanvas workspaceId={workspaceId} productionId={initial.id} surface={surface}
                    onOpenTool={name => setUrl({ tool: name as StudioTool })} refresh={() => { setSurfaceAttempt(value => value + 1); refresh(); }} />)}
              {tool === 'Hybrid' && <HybridBoard scenes={model.scenes} busy={busy}
                onSetExecution={(shot, method) => { void shotActions.bulk([shot.id], { execution_method: method }); }}
                onSelectShot={(sceneId, shotId) => setUrl({ scene: sceneId, shot: shotId })} />}
              {tool === 'Audio' && <><AudioCanvas workspaceId={workspaceId} productionId={initial.id} model={model}
                productionType={initial.production_type} durationMs={initial.planned_duration_ms}
                references={(surface?.references ?? []).map(reference => ({ reference_id: reference.reference_id, source_identity: reference.source_identity, shaping_ready: reference.shaping_ready }))}
                onChanged={() => { setAttempt(value => value + 1); setSurfaceAttempt(value => value + 1); }} busy={busy || !!model.production.locked_at} />
                <section className="s8-edit-structure" aria-label="Edit structure">
                  <h3>Edit structure</h3>
                  <p className="subtle">The semantic edit follows Scene order. Timing {model.timing.status}{model.timing.target_ms ? ` against ${formatMs(model.timing.target_ms)}` : ''}.</p>
                  <ol>{model.scenes.map(scene => <li key={scene.id}>
                    <button type="button" className="text-link" onClick={() => setUrl({ scene: scene.id, shot: null })}>Scene {scene.order} · {scene.title}</button>
                    <span> — {formatMs(scene.duration_ms)} · {scene.shots.length} Shot{scene.shots.length === 1 ? '' : 's'}</span>
                  </li>)}</ol>
                </section></>}
              {['Prompts', 'Edit'].includes(tool) &&
                <FoundationCanvas model={model} tool={tool} busy={busy} onReconcile={sceneActions.reconcile} />}
              {tool === 'Results' && <ProductionShotMatchCanvas workspaceId={workspaceId}
                productionId={initial.id}
                shots={(model?.scenes ?? []).flatMap(scene => scene.shots.map(shot => ({
                  id: shot.id, label: `Shot ${shot.sort_order} ${shot.title}`, method: shot.execution_method,
                  resultCount: shot.result_count,
                })))}
                targets={[
                  ...(model?.scenes ?? []).flatMap(scene => scene.shots.map(shot => ({
                    id: shot.id, label: `Shot ${shot.sort_order} ${shot.title}`, kind: 'shot' }))),
                  ...(model?.scenes ?? []).map(scene => ({ id: scene.id, label: `Scene ${scene.order} ${scene.title}`, kind: 'scene' })),
                ]}
                busy={busy} onChanged={refresh}
                onOpenShot={shotId => {
                  const owning = (model?.scenes ?? []).find(scene => scene.shots.some(shot => shot.id === shotId));
                  setUrl(owning ? { scene: owning.id, shot: shotId } : { shot: shotId });
                }} />}
              {['Brief', 'References', 'Story', 'Script', 'Reality Check'].includes(tool) && (surfaceError && !surface
                ? <PartialState title="Director intelligence is unavailable" action={<button onClick={() => setSurfaceAttempt(value => value + 1)}>Try again</button>}>
                  {surfaceError}
                </PartialState>
                : !surface
                  ? <LoadingState label="Loading Director intelligence…" />
                  : <>
                    {tool === 'Brief' && <BriefCanvas workspaceId={workspaceId} productionId={initial.id} surface={surface} refresh={() => setSurfaceAttempt(value => value + 1)} />}
                    {tool === 'References' && <ReferenceCanvas workspaceId={workspaceId} productionId={initial.id} surface={surface} refresh={() => setSurfaceAttempt(value => value + 1)} />}
                    {tool === 'Story' && <StoryCanvas workspaceId={workspaceId} productionId={initial.id} surface={surface} refresh={() => setSurfaceAttempt(value => value + 1)} />}
                    {tool === 'Script' && <ScriptCanvas workspaceId={workspaceId} productionId={initial.id} surface={surface} refresh={() => setSurfaceAttempt(value => value + 1)} onSelectScene={sceneId => setUrl({ scene: sceneId, shot: null })} />}
                    {tool === 'Reality Check' && <RealityCanvas workspaceId={workspaceId} productionId={initial.id} surface={surface} refresh={() => setSurfaceAttempt(value => value + 1)} />}
                  </>)}
              <section className="studio5-detail">
                <TimingInspector timing={model.timing} />
                {selectedShot && <section aria-label="Selected Shot summary" className="studio5-selected">
                  <h3>Selected Shot</h3>
                  <p><strong>{selectedShot.title}</strong> · {formatMs(selectedShot.planned_duration_ms ?? 0)} · {approvalLabel(selectedShot.approval)}</p>
                  <p className="subtle">{selectedShot.purpose || 'purpose unset'} · {selectedShot.framing || 'framing unset'} · {selectedShot.execution_method.toUpperCase()}</p>
                </section>}
                {selectedAssetId && <p className="subtle" role="status">Asset {model.assets.find(asset => asset.id === selectedAssetId)?.name ?? selectedAssetId} is selected. Scene and Shot usage is listed in its row.</p>}
                {model.truncated && <p className="subtle" role="status">This Production is larger than the Studio page size, so the read model is truncated.</p>}
                <section aria-label="Extracted techniques">
                  <h3>Techniques carried into this Production</h3>
                  <TechniqueTable techniques={surface?.techniques ?? []} />
                </section>
              </section>
            </>}
      </section>

      {directorOpen && model && <StudioInspector workspaceId={workspaceId} productionId={initial.id} surface={surface} model={model}
        refresh={() => { setSurfaceAttempt(value => value + 1); refresh(); }} face={mode === 'hybrid' ? 'Hybrid' : PRODUCT.executionFaces[face]}
        scope={{ scene: selectedScene, shot: selectedShot }} />}
    </div>

    {model && <StudioTimeline model={model} zoom={zoom} setZoom={setZoom}
      selectedSceneId={selectedSceneId} selectedShotId={selectedShotId}
      moments={(surface?.story?.beats ?? []).map(beat => ({ id: beat.id, title: beat.name }))}
      resultsByShot={Object.fromEntries(model.scenes.flatMap(scene => scene.shots
        .filter(shot => shot.result_count > 0).map(shot => [shot.id, shot.result_count])))}
      onSelectScene={sceneId => setUrl({ scene: sceneId, shot: null })}
      onSelectShot={(sceneId, shotId) => setUrl({ scene: sceneId, shot: shotId })}
      onMoveScene={(sceneId, direction) => { const scene = scenes.find(item => item.id === sceneId); if (scene) void sceneActions.move(scene, direction); }}
      onMoveShot={(shot, direction) => { const target = selectedShotList(scenes, shot.id); if (target) void shotActions.move(target, direction); }}
      onDropScene={(dragged, target) => void sceneActions.drop(dragged, target)}
      onDropShot={(dragged, target, sceneId) => void shotActions.drop(dragged, target, sceneId)}
      busy={busy} />}
  </div>;
}

function selectedShotList(scenes: StudioScene[], shotId: string): StudioShot | null {
  return scenes.flatMap(scene => scene.shots).find(shot => shot.id === shotId) ?? null;
}
