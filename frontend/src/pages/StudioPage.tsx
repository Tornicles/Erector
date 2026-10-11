import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  productionService, type DirectorStudio,
  type StudioApproval, type StudioReadModel, type StudioScene, type StudioShot, type StudioWriteResult,
} from '../services/productions';
import { prompt11Service, type Job } from '../services/prompt11';
import { AppError, safeError } from '../services/errors';
import { useAutosave, useUnsavedNavigation } from '../hooks/useAutosave';
import { ErrorState, LoadingState, PartialState } from '../components/StateComponents';
import { BriefCanvas, RealityCanvas, ReferenceCanvas, ScriptCanvas, StoryCanvas } from '../components/StudioCanvases';
import { AssetCanvas, AudioCanvas } from '../studio/StudioCanvases5';
import { StudioInspector, type StudioMode } from '../studio/StudioEight';
import { approvalLabel, formatMs } from '../studio/StudioTimeline';
import { RealProductionCanvas } from '../studio/RealProduction';
import { AiCreationCanvas } from '../studio/AICreation';
import { MovieModeCanvas } from '../studio/MovieMode';
import { SeriesStudioCanvas } from '../studio/SeriesStudio';
import { ProductionContinuityCanvas } from '../studio/ProductionContinuity';
import { ProductionMemoryCanvas } from '../studio/ProductionMemory';
import { ProductionIntelligenceCanvas } from '../studio/ProductionIntelligence';
import { ProductionVersioningCanvas } from '../studio/ProductionVersioning';
import { ProductionReadinessCanvas } from '../studio/ProductionReadiness';
import { PublishingCanvas } from '../prompt10/Publishing';
import { ExportsCanvas } from '../prompt10/Exports';
import { ProductionShotMatchCanvas } from '../studio/ProductionShotMatch';
import { type ExecutionFace, type Production } from '../types/domain';
import { DEFAULT_EXECUTION_FACE, PRODUCT } from '../types/product';
import { saveStudioContext } from '../home/commandCenter';
import { liveJobs } from '../home/commandCenter';
import {
  CardMenu, CardTopBar, DetailsDrawer, EmptyCards, FilmStrip, HeroCarousel, ShotMenu, ShotStrip,
  useProductionUndo,
} from '../studio/StudioCards';
import {
  drawerSectionForTool, focusLabel, nextActionForScene, orderedCards,
  resolveFocus, scopeText, type CardNextAction, type DrawerSection,
} from '../studio/cards';

const SAVE_LABELS = { idle: 'No unsaved changes', dirty: 'Unsaved changes', saving: 'Saving…', saved: 'Saved', failed: 'Save failed', offline: 'Offline · not saved', conflict: 'Conflict · not saved' } as const;

const DRAWER_TITLES: Record<DrawerSection, string> = {
  details: 'Production Details',
  brief: 'Brief',
  reality: 'Reality Check',
  references: 'References',
  story: 'Story',
  script: 'Script',
  assets: 'Characters & World',
  audio: 'Audio & Edit',
  results: 'Results',
  readiness: 'Readiness',
  versions: 'Change history',
  impact: 'Impact',
  continuity: 'Continuity',
  memory: 'Memory',
  series: 'Series',
  exports: 'Export',
  publishing: 'Publish',
  preview: 'Preview',
  playbook: 'AI Playbook',
  realplan: 'Real Production Plan',
};

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
  // Real Production is the default Studio face. Faces are views of the same
  // Production, never separate productions or persisted assignments.
  const [face, setFace] = useState<StudioMode>(DEFAULT_EXECUTION_FACE as StudioMode);
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
  const [drawer, setDrawer] = useState<DrawerSection | null>(null);
  const [assetKind, setAssetKind] = useState<'Characters' | 'World' | 'Products' | 'Wardrobe' | 'Style'>('Characters');
  const [impactOffer, setImpactOffer] = useState<{ sceneId: string; label: string } | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const persisted = useRef(initial);

  const selectedSceneId = params.get('scene');
  const selectedShotId = params.get('shot');
  const selectedSeriesId = params.get('series');
  // React Router builds its params from the render that created the writer, so a handler
  // can hold a query that is already out of date. Every Studio URL write therefore merges
  // against this ref, which is always the live query.
  const liveSearch = useRef(params.toString());
  liveSearch.current = params.toString();
  // Persist the exact Studio context so Home can resume it later.
  const studioSearch = params.toString();
  useEffect(() => { saveStudioContext(workspaceId, initial.id, studioSearch); }, [workspaceId, initial.id, studioSearch]);
  const writeParams = useCallback((mutate: (search: URLSearchParams) => void) => {
    const search = new URLSearchParams(liveSearch.current);
    mutate(search);
    liveSearch.current = search.toString();
    setParams(search, { replace: true });
  }, [setParams]);
  // Selection writes merge against the live query: focus changes never clobber each other.
  const setUrl = useCallback((next: { scene?: string | null; shot?: string | null; series?: string | null }) => {
    writeParams(search => {
      if (next.scene !== undefined) next.scene ? search.set('scene', next.scene) : search.delete('scene');
      if (next.shot !== undefined) next.shot ? search.set('shot', next.shot) : search.delete('shot');
      if (next.series !== undefined) next.series ? search.set('series', next.series) : search.delete('series');
    });
  }, [writeParams]);

  const scenes = useMemo(() => (model ? orderedCards(model) : []), [model]);
  const focus = useMemo(
    () => (model ? resolveFocus(model, selectedSceneId, selectedShotId) : { kind: 'production' as const }),
    [model, selectedSceneId, selectedShotId],
  );
  const focusScene = focus.kind === 'production' ? null : focus.scene;
  const focusShot = focus.kind === 'shot' ? focus.shot : null;

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
      // Canonicalise selection: default to the first card. Legacy tool folding
      // lives in its own effect so it also runs when the link arrives after load.
      writeParams(search => {
        if (!search.get('scene') && data.scenes.length > 0) {
          search.set('scene', [...data.scenes].sort((a, b) => a.sort_order - b.sort_order)[0].id);
        }
      });
    }).catch(failure => {
      if (!active) return;
      const error = safeError(failure);
      setModel(null);
      setModelError(error.kind === 'conflict' ? `${error.message} Reload to see the newer Production state.` : error.message);
    }).finally(() => { if (active) setModelLoading(false); });
    return () => { active = false; };
    // Deliberately keyed on the Production only: selection changes must not re-fetch.
  }, [workspaceId, initial.id, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  // Legacy `?tool=` deep links fold into a drawer section whenever they appear —
  // not only on the first model load — so a link opened while Studio is already
  // open lands on the same drawer instead of being silently dropped.
  useEffect(() => {
    const tool = params.get('tool');
    if (!tool) return;
    const section = drawerSectionForTool(tool);
    if (section) setDrawer(current => current ?? section);
    writeParams(search => { search.delete('tool'); });
  }, [params, writeParams]);
  useEffect(() => {
    let active = true; setSurfaceError(null);
    productionService.directorStudioSurface(workspaceId, initial.id).then(data => { if (active) setSurface(data); })
      .catch(failure => { if (active) { setSurface(null); setSurfaceError(safeError(failure).message); } });
    return () => { active = false; };
  }, [workspaceId, initial.id, surfaceAttempt]);

  // Progressive Director build: while cards are missing or background jobs for
  // this Production are live, poll job state and refresh the moment anything
  // completes. Cards appear as soon as each one is ready — never all-or-nothing.
  useEffect(() => {
    let active = true;
    let lastSig = '';
    const poll = async () => {
      try {
        const list = await prompt11Service.jobs(workspaceId);
        if (!active) return;
        const mine = list.jobs.filter(job => !job.production_id || job.production_id === initial.id);
        setJobs(mine);
        const sig = mine.map(job => `${job.job_id}:${job.status}`).join('|');
        if (lastSig !== '' && sig !== lastSig) { refresh(); setSurfaceAttempt(value => value + 1); }
        lastSig = sig;
      } catch { /* jobs unavailable — the Studio still works from its read model */ }
    };
    void poll();
    const timer = window.setInterval(poll, 6000);
    return () => { active = false; window.clearInterval(timer); };
  }, [workspaceId, initial.id, refresh]);

  const run = useCallback(async <T,>(action: () => Promise<T>, describe: (result: T) => string): Promise<T | null> => {
    setBusy(true); setActionError(null); setActionNote(null); setImpactOffer(null);
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
      result => { if (selectedSceneId === scene.id) setUrl({ scene: null, shot: null }); return `Archived Card ${scene.order}${result.archived_shots ? ` and ${result.archived_shots} Shot(s)` : ''}. Content is archived, not deleted.`; }),
    move: (scene: StudioScene, direction: -1 | 1) => {
      const ordered = scenes.map(item => item.id);
      const index = ordered.indexOf(scene.id);
      const target = index + direction;
      if (target < 0 || target >= ordered.length) return Promise.resolve(null);
      [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
      return run(() => productionService.reorderStudioScenes(workspaceId, initial.id, ordered, model?.production.revision),
        result => {
          setImpactOffer({ sceneId: scene.id, label: `Card ${scene.order} moved.` });
          return `Card order saved (${result.scenes ?? ordered.length} Cards).`;
        });
    },
    drop: (draggedId: string, targetId: string) => {
      const ordered = scenes.map(item => item.id);
      const from = ordered.indexOf(draggedId);
      const to = ordered.indexOf(targetId);
      if (from < 0 || to < 0 || from === to) return Promise.resolve(null);
      ordered.splice(to, 0, ordered.splice(from, 1)[0]);
      const moved = scenes.find(item => item.id === draggedId);
      return run(() => productionService.reorderStudioScenes(workspaceId, initial.id, ordered, model?.production.revision),
        result => {
          if (moved) setImpactOffer({ sceneId: moved.id, label: `Card ${moved.order} moved.` });
          return `Card order saved (${result.scenes ?? ordered.length} Cards).`;
        });
    },
    toggleLock: (scene: StudioScene) => run(
      () => productionService.setStudioLock(workspaceId, initial.id, 'scene', scene.id, !scene.locked_at, scene.revision),
      result => `${result.locked ? 'Locked' : 'Unlocked'} Card ${scene.order}.`),
    approve: (scene: StudioScene, approval: StudioApproval) => run(
      () => productionService.setStudioApproval(workspaceId, initial.id, 'scene', scene.id, approval, scene.revision),
      result => `Card ${scene.order} is ${approvalLabel(result.approval)}.`),
    reconcile: (scene: StudioScene) => run(
      () => productionService.reconcileStudioRuntime(workspaceId, initial.id, scene.id, model?.production.revision),
      result => result.adjusted_ms === 0 ? 'The runtime already matches its target.' : `Adjusted the last Shot of that Card by ${result.adjusted_ms} ms.`),
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
        result => `Shot order saved (${result.shots ?? ordered.length} Shots in the Card).`);
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
        result => `Shot order saved (${result.shots ?? ordered.length} Shots in the Card).`);
    },
    moveToScene: (shot: StudioShot, sceneId: string) => run(
      () => productionService.moveStudioShot(workspaceId, initial.id, shot.id, sceneId, shot.revision),
      result => `Moved the Shot to Card ${scenes.find(scene => scene.id === result.scene_id)?.order ?? ''}.`),
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

  const undo = useProductionUndo(workspaceId, initial.id, model?.production.revision ?? initial.revision, refresh);

  const insertCard = (index: number) => {
    void run(async () => {
      const created = await productionService.createStudioScene(workspaceId, initial.id, {
        title: 'New moment',
        purpose: 'A new production beat.',
        description: 'Tell TONDE what should happen here, or ask TONDE to develop the moment.',
        expected_production_revision: model?.production.revision,
      });
      if (!created.scene_id) return created;
      const ordered = scenes.map(item => item.id);
      ordered.splice(Math.min(Math.max(index, 0), ordered.length), 0, created.scene_id);
      const reorder = await productionService.reorderStudioScenes(workspaceId, initial.id, ordered, model?.production.revision);
      setUrl({ scene: created.scene_id, shot: null });
      return { ...reorder, scene_id: created.scene_id };
    }, () => 'New card inserted at that position.');
  };

  const focusDirector = (hint: string) => {
    setActionNote(hint);
    requestAnimationFrame(() => {
      document.getElementById('director-message')?.focus();
    });
  };

  const runPrimary = (scene: StudioScene) => {
    const action: CardNextAction = nextActionForScene(scene);
    switch (action.kind) {
      case 'locked':
        setActionNote(action.detail);
        return;
      case 'review_decision':
        setUrl({ scene: scene.id, shot: null });
        setDrawer('readiness');
        return;
      case 'plan_coverage':
        setUrl({ scene: scene.id, shot: null });
        focusDirector(`Tell TONDE what Card ${scene.order} must accomplish — for example: “Give Card ${scene.order} three Shots: a wide reveal, Maya entering, and a reaction.”`);
        return;
      case 'review_result':
      case 'start_execution':
        setUrl({ scene: scene.id, shot: scene.shots[0]?.id ?? null });
        setDrawer('results');
        return;
      case 'run_playbook':
        setUrl({ scene: scene.id, shot: scene.shots[0]?.id ?? null });
        setDrawer('playbook');
        return;
      case 'continue_next': {
        const index = scenes.findIndex(item => item.id === scene.id);
        const next = scenes[index + 1];
        if (next) setUrl({ scene: next.id, shot: null });
        else setActionNote('This is the last card. The Production is complete up to here.');
        return;
      }
      default:
        return;
    }
  };

  const providerLabel = model ? (model.provider.configured ? `Director · ${model.provider.model_profile}` : 'Director · deterministic only') : 'Director · connecting…';
  const directorFace = face === 'hybrid' ? 'Hybrid' : PRODUCT.executionFaces[face as ExecutionFace];
  const reviewCount = model?.status_summary.needs_attention ?? 0;
  const live = model ? liveJobs(jobs.filter(job => !job.production_id || job.production_id === initial.id)) : [];

  const shotTargets = useMemo(() => scenes.flatMap(scene => scene.shots.map(shot => ({
    id: shot.id, label: `Shot ${shot.sort_order} ${shot.title}`, kind: 'shot',
  }))), [scenes]);
  const versionTargets = useMemo(() => [
    { id: initial.id, label: `${initial.title} (Production)`, kind: 'production' },
    ...Object.entries(model?.documents ?? {}).flatMap(([key, document]) => document?.document_id
      ? [{
        id: document.document_id, label: document.title ?? key, kind: 'creative_document',
        scope: (key === 'script' ? 'script' : 'story') as 'script' | 'story',
      }]
      : []),
    ...scenes.map(scene => ({ id: scene.id, label: scene.title, kind: 'scene', scope: 'scene' as const })),
    ...scenes.flatMap(scene => scene.shots.map(shot => ({ id: shot.id, label: shot.title, kind: 'shot', scope: 'shot' as const }))),
    ...(model?.assets ?? []).map(asset => ({ id: asset.id, label: asset.name, kind: 'asset', scope: 'asset' as const })),
  ], [initial.id, initial.title, scenes, model]);
  const readinessTargets = useMemo(() => [
    { id: initial.id, label: `${initial.title} (Production)`, kind: 'production' },
    ...scenes.map(scene => ({ id: scene.id, label: scene.title, kind: 'scene' })),
    ...scenes.flatMap(scene => scene.shots.map(shot => ({ id: shot.id, label: shot.title, kind: 'shot' }))),
  ], [initial.id, initial.title, scenes]);

  return <div className="cs-shell">
    <CardTopBar
      productionTitle={initial.title}
      typeBadge={PRODUCT.productionTypes[initial.production_type as keyof typeof PRODUCT.productionTypes] ?? initial.production_type.replaceAll('_', ' ')}
      titleEditor={<><label className="sr-only" htmlFor="production-title">Production title</label>
        <input id="production-title" aria-label="Production title" value={title.value}
          onChange={event => title.setValue(event.target.value)} maxLength={160} disabled={!!initial.locked_at} /></>}
      saveState={SAVE_LABELS[title.state]}
      reviewCount={reviewCount}
      mode={face} onMode={setFace}
      undoNote={undo.note} undoBusy={undo.busy} onUndo={() => void undo.undo()} onRedo={() => void undo.redo()}
      onOpenDetails={() => setDrawer('details')}
      onExport={() => setDrawer('exports')}
    />

    {title.error && <div className="save-error" role="alert">{title.error}
      <button onClick={title.state === 'conflict' ? reload : title.retry}>{title.state === 'conflict' ? 'Reload latest' : 'Retry save'}</button></div>}
    {conflict && <div className="save-error" role="alert">
      This Production changed in another session. Reload before applying your change.
      <button onClick={() => { setConflict(false); refresh(); }}>Reload Studio</button>
    </div>}
    {actionError && <div className="save-error" role="alert">{actionError}<button onClick={() => setActionError(null)}>Dismiss</button></div>}
    {actionNote && <p className="studio5-note" role="status">{actionNote}</p>}
    {impactOffer && <p className="studio5-note cs-impact-offer" role="status">{impactOffer.label} Story order changed — later cards may need a transition update.
      <button type="button" className="cs-btn" onClick={() => setDrawer('impact')}>Review impact</button>
      <button type="button" className="cs-btn" onClick={() => setImpactOffer(null)}>Keep it</button></p>}

    <div className="cs-workspace">
      <section className="cs-stage" aria-label="Production sequence">
        <div className="cs-stage-head">
          <div>
            <p className="eyebrow">PRODUCTION SEQUENCE</p>
            <h2>One card. One moment. One next action.</h2>
            <p>Scroll sideways through the production. TONDE stays with the card in focus.</p>
          </div>
          {focusScene && <button type="button" className="cs-btn" disabled={busy} onClick={() => insertCard(scenes.findIndex(item => item.id === focusScene.id) + 1)}>＋ Add after</button>}
        </div>

        {modelLoading && !model
          ? <LoadingState label="Loading this Production's cards…" />
          : modelError && !model
            ? <PartialState title="The Studio could not read this Production" action={<button onClick={() => { setModelError(null); refresh(); }}>Try again</button>}>
              {modelError}
            </PartialState>
            : model && (scenes.length === 0
              ? <EmptyCards liveJobs={live.length} busy={busy}
                onAsk={() => focusDirector('Describe the first moment — TONDE builds the cards from your direction.')}
                onBlank={() => insertCard(0)} />
              : <>
                <HeroCarousel scenes={scenes} activeId={focusScene?.id ?? null} selectedShotId={selectedShotId}
                  onFocusScene={sceneId => setUrl({ scene: sceneId, shot: null })}
                  onSelectShot={(sceneId, shotId) => setUrl({ scene: sceneId, shot: shotId })}
                  onPrimary={runPrimary}
                  renderMenu={scene => <CardMenu scene={scene} busy={busy}
                    onRename={(target, next) => void sceneActions.update(target, { title: next, expected_revision: target.revision })}
                    onApprove={target => void sceneActions.approve(target, target.approval === 'approved' ? 'needs_review' : 'approved')}
                    onToggleLock={target => void sceneActions.toggleLock(target)}
                    onArchive={target => void sceneActions.archive(target, true)}
                    onMove={(target, direction) => void sceneActions.move(target, direction)}
                    onHowTo={target => {
                      setUrl({ scene: target.id, shot: null });
                      setDrawer(target.shots.some(shot => shot.execution_method !== 'real') ? 'playbook' : 'realplan');
                    }} />} />
                <ShotStrip scene={focusScene} selectedShotId={selectedShotId}
                  onSelectShot={(sceneId, shotId) => setUrl({ scene: sceneId, shot: shotId })}
                  onAddShot={() => focusScene && void shotActions.create({
                    scene_id: focusScene.id, title: 'New shot', expected_production_revision: model.production.revision,
                  })}
                  busy={busy} />
                <FilmStrip scenes={scenes} activeId={focusScene?.id ?? null}
                  onFocusScene={sceneId => setUrl({ scene: sceneId, shot: null })}
                  onInsert={insertCard}
                  onDrop={(dragged, target) => void sceneActions.drop(dragged, target)}
                  busy={busy} />
              </>)}

        <p className="subtle" role="status" style={{ padding: '0 18px' }}>
          {model ? `${providerLabel} · ${reviewCount} review item${reviewCount === 1 ? '' : 's'}` : 'Connecting…'}
          {model?.truncated ? ' · This Production is larger than the Studio page size, so the read model is truncated.' : ''}
        </p>
      </section>

      <aside className="cs-director" aria-label="TONDE Director">
        <div className="cs-focus">
          <strong>TONDE</strong>
          <span role="status">{model ? focusLabel(focus, model) : 'FOCUS · PRODUCTION'}</span>
        </div>
        {model
          ? <StudioInspector workspaceId={workspaceId} productionId={initial.id} surface={surface} model={model}
            refresh={() => { setSurfaceAttempt(value => value + 1); refresh(); }} face={directorFace}
            scope={{ scene: focusScene, shot: focusShot }} />
          : <p className="subtle" style={{ padding: '0 14px' }}>Loading production intelligence…</p>}
        {focusShot && <div style={{ padding: '0 14px 12px' }}>
          <ShotMenu shot={focusShot} displayId={focusScene
            ? `${String(focusScene.order).padStart(2, '0')}${String.fromCharCode(65 + Math.max(focusScene.shots.findIndex(item => item.id === focusShot.id), 0))}`
            : focusShot.title}
            busy={busy}
            onRename={(target, next) => void shotActions.update(target, { title: next, expected_revision: target.revision })}
            onApprove={target => void shotActions.approve(target, 'approved')}
            onExecute={(target, method) => void shotActions.update(target, { execution_method: method, expected_revision: target.revision })}
            onDuration={(target, durationMs) => void shotActions.update(target, { duration_ms: durationMs, expected_revision: target.revision })} />
        </div>}
        {model && <p className="subtle" style={{ padding: '0 14px 12px' }}>{scopeText(focus)}</p>}
      </aside>
    </div>

    {drawer && model && <DetailsDrawer title={DRAWER_TITLES[drawer]} onClose={() => setDrawer(null)}>
      {drawer === 'details' && <>
        <section className="detail-section"><strong>Brief</strong><p>{surface?.brief ? surface.brief.production_goal : 'No Brief recorded yet. Ask TONDE to develop it.'}</p>
          <button type="button" className="cs-btn" onClick={() => setDrawer('brief')}>Open Brief</button></section>
        <section className="detail-section"><strong>Story</strong><p>{surface?.story ? `${surface.story.title} — ${surface.story.logline}` : 'No Story direction recorded yet. Ask TONDE to develop it.'}</p>
          <button type="button" className="cs-btn" onClick={() => setDrawer('story')}>Open Story</button></section>
        <section className="detail-section"><strong>Script</strong><p>{surface?.documents?.script ? surface.documents.script.title : 'No Script recorded yet.'}</p>
          <button type="button" className="cs-btn" onClick={() => setDrawer('script')}>Open Script</button></section>
        <section className="detail-section"><strong>Characters</strong><p>{(surface?.brief?.cast ?? []).join(', ') || 'No cast recorded yet.'}</p></section>
        <section className="detail-section"><strong>Locations</strong><p>{(surface?.brief?.environments ?? []).join(', ') || 'No locations recorded yet.'}</p></section>
        <section className="detail-section"><strong>Production Kit</strong><p>{surface ? (surface.setup_listed.length > 0 ? surface.setup_listed.join(', ') : 'No kit listed yet — TONDE adapts to what you actually have.') : 'Loading…'}</p></section>
        <section className="detail-section"><strong>Schedule</strong><p>No shoot date is set on this Production.</p></section>
        <section className="detail-section"><strong>References & Style</strong><p>{surface && surface.references.length > 0 ? `${surface.references.length} reference(s) shape this Production.` : 'No references shape this Production yet.'}</p></section>
        <section className="detail-section"><strong>Change history</strong><p>Every accepted change is preserved with who made it and when.</p>
          <button type="button" className="cs-btn" onClick={() => setDrawer('versions')}>Open history</button></section>
        {selectedAssetId && <p className="subtle" role="status">Asset {model.assets.find(asset => asset.id === selectedAssetId)?.name ?? selectedAssetId} is selected.</p>}
      </>}
      {drawer === 'brief' && (surface
        ? <BriefCanvas workspaceId={workspaceId} productionId={initial.id} surface={surface} refresh={() => setSurfaceAttempt(value => value + 1)} />
        : surfaceError
          ? <PartialState title="Director intelligence is unavailable" action={<button onClick={() => setSurfaceAttempt(value => value + 1)}>Try again</button>}>{surfaceError}</PartialState>
          : <LoadingState label="Loading Director intelligence…" />)}
      {drawer === 'reality' && (surface
        ? <RealityCanvas workspaceId={workspaceId} productionId={initial.id} surface={surface} refresh={() => setSurfaceAttempt(value => value + 1)} />
        : surfaceError
          ? <PartialState title="Director intelligence is unavailable" action={<button onClick={() => setSurfaceAttempt(value => value + 1)}>Try again</button>}>{surfaceError}</PartialState>
          : <LoadingState label="Loading Director intelligence…" />)}
      {drawer === 'references' && (surface
        ? <ReferenceCanvas workspaceId={workspaceId} productionId={initial.id} surface={surface} refresh={() => setSurfaceAttempt(value => value + 1)} />
        : surfaceError
          ? <PartialState title="Director intelligence is unavailable" action={<button onClick={() => setSurfaceAttempt(value => value + 1)}>Try again</button>}>{surfaceError}</PartialState>
          : <LoadingState label="Loading Director intelligence…" />)}
      {drawer === 'story' && (surface
        ? <StoryCanvas workspaceId={workspaceId} productionId={initial.id} surface={surface} refresh={() => setSurfaceAttempt(value => value + 1)} />
        : surfaceError
          ? <PartialState title="Director intelligence is unavailable" action={<button onClick={() => setSurfaceAttempt(value => value + 1)}>Try again</button>}>{surfaceError}</PartialState>
          : <LoadingState label="Loading Director intelligence…" />)}
      {drawer === 'script' && (surface
        ? <ScriptCanvas workspaceId={workspaceId} productionId={initial.id} surface={surface} refresh={() => setSurfaceAttempt(value => value + 1)} onSelectScene={sceneId => { setUrl({ scene: sceneId, shot: null }); setDrawer(null); }} />
        : surfaceError
          ? <PartialState title="Director intelligence is unavailable" action={<button onClick={() => setSurfaceAttempt(value => value + 1)}>Try again</button>}>{surfaceError}</PartialState>
          : <LoadingState label="Loading Director intelligence…" />)}
      {drawer === 'assets' && <>
        <div role="group" aria-label="Asset kinds" style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {(['Characters', 'World', 'Products', 'Wardrobe', 'Style'] as const).map(kind => <button key={kind} type="button"
            className="cs-btn" aria-pressed={assetKind === kind} onClick={() => setAssetKind(kind)}>{kind}</button>)}
        </div>
        <AssetCanvas model={model} tool={assetKind} busy={busy} onSelectAsset={setSelectedAssetId} />
      </>}
      {drawer === 'audio' && <>
        <AudioCanvas workspaceId={workspaceId} productionId={initial.id} model={model}
          productionType={initial.production_type} durationMs={initial.planned_duration_ms}
          references={(surface?.references ?? []).map(reference => ({ reference_id: reference.reference_id, source_identity: reference.source_identity, shaping_ready: reference.shaping_ready }))}
          onChanged={() => { setAttempt(value => value + 1); setSurfaceAttempt(value => value + 1); }} busy={busy || !!model.production.locked_at} />
        <section aria-label="Edit structure">
          <h3>Edit structure</h3>
          <p className="subtle">The semantic edit follows card order. Timing {model.timing.status}{model.timing.target_ms ? ` against ${formatMs(model.timing.target_ms)}` : ''}.</p>
          <ol>{scenes.map(scene => <li key={scene.id}>
            <button type="button" className="text-link" onClick={() => { setUrl({ scene: scene.id, shot: null }); setDrawer(null); }}>Card {scene.order} · {scene.title}</button>
            <span> — {formatMs(scene.duration_ms)} · {scene.shots.length} Shot{scene.shots.length === 1 ? '' : 's'}</span>
          </li>)}</ol>
        </section>
      </>}
      {drawer === 'results' && <ProductionShotMatchCanvas workspaceId={workspaceId} productionId={initial.id}
        shots={scenes.flatMap(scene => scene.shots.map(shot => ({
          id: shot.id, label: `Shot ${shot.sort_order} ${shot.title}`, method: shot.execution_method, resultCount: shot.result_count,
        })))}
        targets={shotTargets} busy={busy} onChanged={refresh}
        onOpenShot={shotId => {
          const owning = scenes.find(scene => scene.shots.some(shot => shot.id === shotId));
          if (owning) setUrl({ scene: owning.id, shot: shotId });
        }} />}
      {drawer === 'readiness' && <ProductionReadinessCanvas workspaceId={workspaceId} productionId={initial.id}
        targets={readinessTargets} busy={busy} onChanged={refresh}
        onOpen={(objectId, kind) => {
          if (kind === 'scene') { setUrl({ scene: objectId, shot: null }); return; }
          if (kind === 'shot') {
            const owning = scenes.find(scene => scene.shots.some(shot => shot.id === objectId));
            setUrl(owning ? { scene: owning.id, shot: objectId } : { shot: objectId });
          }
        }} />}
      {drawer === 'versions' && <ProductionVersioningCanvas workspaceId={workspaceId} productionId={initial.id}
        targets={versionTargets} busy={busy} onChanged={refresh} />}
      {drawer === 'continuity' && <ProductionContinuityCanvas workspaceId={workspaceId} productionId={initial.id}
        assets={model.assets.map(asset => ({ id: asset.id, name: asset.name, asset_type: asset.asset_type }))}
        selectedSceneId={focusScene?.id ?? null} selectedShotId={focusShot?.id ?? null}
        sceneTitle={focusScene?.title ?? null} shotTitle={focusShot?.title ?? null}
        busy={busy} onChanged={refresh} />}
      {drawer === 'memory' && <ProductionMemoryCanvas workspaceId={workspaceId} productionId={initial.id}
        assets={model.assets.map(asset => ({ id: asset.id, name: asset.name, asset_type: asset.asset_type }))}
        busy={busy} onChanged={refresh} />}
      {drawer === 'series' && <SeriesStudioCanvas workspaceId={workspaceId} projectId={initial.project_id}
        seriesId={selectedSeriesId} onSelectSeries={seriesId => setUrl({ series: seriesId })} />}
      {drawer === 'impact' && <ProductionIntelligenceCanvas workspaceId={workspaceId} productionId={initial.id}
        assets={model.assets.map(asset => ({ id: asset.id, name: asset.name, asset_type: asset.asset_type }))}
        selectedSceneId={focusScene?.id ?? null} selectedShotId={focusShot?.id ?? null}
        sceneTitle={focusScene?.title ?? null} shotTitle={focusShot?.title ?? null}
        productionTitle={initial.title} busy={busy} onChanged={refresh} />}
      {drawer === 'exports' && <ExportsCanvas workspaceId={workspaceId} productionId={initial.id} />}
      {drawer === 'publishing' && <PublishingCanvas workspaceId={workspaceId} productionId={initial.id} />}
      {drawer === 'preview' && <MovieModeCanvas workspaceId={workspaceId} productionId={initial.id}
        selectedSceneId={selectedSceneId} selectedShotId={selectedShotId} busy={busy}
        onSelectScene={sceneId => setUrl({ scene: sceneId, shot: null })}
        onSelectShot={(sceneId, shotId) => setUrl({ scene: sceneId, shot: shotId })} onChanged={refresh} />}
      {drawer === 'playbook' && <AiCreationCanvas workspaceId={workspaceId} productionId={initial.id}
        busy={busy} selectedShotId={selectedShotId}
        onSelectShot={(sceneId, shotId) => setUrl({ scene: sceneId, shot: shotId })} onChanged={refresh} />}
      {drawer === 'realplan' && <RealProductionCanvas workspaceId={workspaceId} productionId={initial.id}
        model={model} timing={model.timing} surface={surface} busy={busy} selectedShotId={selectedShotId}
        onSelectShot={(sceneId, shotId) => setUrl({ scene: sceneId, shot: shotId })} onChanged={refresh} />}
    </DetailsDrawer>}
  </div>;
}
