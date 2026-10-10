import { useMemo } from 'react';
import { ChevronLeft, ChevronRight, Lock, Unlock } from 'lucide-react';
import type { StudioReadModel, StudioTimelineScene } from '../services/productions';
import { executionMethodLabel } from '../types/domain';
import { PRODUCT } from '../types/product';

// The production timeline is a STRUCTURE timeline, not a video-editing timeline.
// It projects canonical Scenes and Shots: order, duration, hierarchy, status.
export type TimelineZoom = 'overview' | 'scene' | 'shot';
export const TIMELINE_ZOOMS: TimelineZoom[] = ['overview', 'scene', 'shot'];

export function formatMs(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  const total = Math.max(0, Math.round(value));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  if (minutes > 0) return `${minutes}:${String(seconds).padStart(2, '0')}`;
  if (millis === 0) return `${seconds}s`;
  return `${seconds}.${String(millis).padStart(3, '0')}s`;
}

export function approvalLabel(approval: string) {
  return PRODUCT.approvals[approval as keyof typeof PRODUCT.approvals] ?? approval.replaceAll('_', ' ');
}

export function StudioTimeline({
  model, zoom, setZoom, selectedSceneId, selectedShotId, onSelectScene, onSelectShot,
  onMoveScene, onMoveShot, onDropScene, onDropShot, busy, moments, resultsByShot,
}: {
  model: StudioReadModel; zoom: TimelineZoom; setZoom: (next: TimelineZoom) => void;
  selectedSceneId: string | null; selectedShotId: string | null;
  onSelectScene: (sceneId: string) => void; onSelectShot: (sceneId: string, shotId: string) => void;
  onMoveScene: (sceneId: string, direction: -1 | 1) => void;
  onMoveShot: (shot: { id: string; scene_id: string | null }, direction: -1 | 1) => void;
  onDropScene: (draggedId: string, targetId: string) => void;
  onDropShot: (draggedId: string, targetId: string, sceneId: string) => void;
  busy: boolean; moments?: Array<{ id: string; title: string }>; resultsByShot?: Record<string, number>;
}) {
  const total = model.timing.total_ms || 0;
  const scenes = model.timeline;
  const segments = useMemo(() => scenes.map(scene => ({
    ...scene,
    share: total > 0 ? Math.max(4, Math.round((scene.duration_ms / total) * 100)) : Math.max(4, Math.round(100 / Math.max(1, scenes.length))),
  })), [scenes, total]);

  return <section className="studio5-timeline" aria-label="Production structure timeline">
    <header className="studio5-timeline-head">
      <p className="eyebrow">PRODUCTION TIMELINE</p>
      <div className="studio5-timeline-meta" role="status">
        <span>{formatMs(total)} total</span>
        <span>{scenes.length} Scenes</span>
        <span>{scenes.reduce((sum, scene) => sum + scene.shots.length, 0)} Shots</span>
        <span className={model.runtime_conflict ? 'studio5-warn' : ''}>
          {model.timing.target_ms === null ? 'No runtime target'
            : model.timing.status === 'fits' ? `Exact ${formatMs(model.timing.target_ms)}`
              : `${model.timing.status === 'over' ? 'Over' : 'Under'} target by ${formatMs(Math.abs(model.timing.delta_ms ?? 0))}`}
        </span>
      </div>
      <div className="studio5-zoom" role="group" aria-label="Timeline zoom">
        {TIMELINE_ZOOMS.map(level => <button key={level} type="button" aria-pressed={zoom === level}
          className={zoom === level ? 'selected' : ''} onClick={() => setZoom(level)}>{level}</button>)}
      </div>
    </header>

    {scenes.length === 0
      ? <p className="studio5-empty">No Scenes yet. Ask TONDE to write the Story, or add a Scene to start the Production structure.</p>
      : <ol className={`studio5-track studio5-zoom-${zoom}`}>
        {segments.map((scene, index) => <SceneBlock key={scene.scene_id} scene={scene} index={index}
          total={scenes.length} zoom={zoom} selected={scene.scene_id === selectedSceneId}
          selectedShotId={selectedShotId} onSelectScene={onSelectScene} onSelectShot={onSelectShot}
          onMoveScene={onMoveScene} onMoveShot={onMoveShot} onDropScene={onDropScene} onDropShot={onDropShot}
          busy={busy} share={scene.share} resultsByShot={resultsByShot} />)}
      </ol>}

    {moments && moments.length > 0 && <div className="studio5-moments" aria-label="Story moments">
      <span className="eyebrow">Moments</span>
      <ol>{moments.map(moment => <li key={moment.id}>{moment.title}</li>)}</ol>
    </div>}

    {model.runtime_conflict && <RuntimeConflictPanel model={model} />}
  </section>;
}

function SceneBlock({
  scene, index, total, zoom, selected, selectedShotId, onSelectScene, onSelectShot, onMoveScene, onMoveShot,
  onDropScene, onDropShot, busy, share, resultsByShot,
}: {
  scene: StudioTimelineScene & { share: number }; index: number; total: number; zoom: TimelineZoom;
  selected: boolean; selectedShotId: string | null;
  onSelectScene: (sceneId: string) => void; onSelectShot: (sceneId: string, shotId: string) => void;
  onMoveScene: (sceneId: string, direction: -1 | 1) => void;
  onMoveShot: (shot: { id: string; scene_id: string | null }, direction: -1 | 1) => void;
  onDropScene: (draggedId: string, targetId: string) => void;
  onDropShot: (draggedId: string, targetId: string, sceneId: string) => void;
  busy: boolean; share: number; resultsByShot?: Record<string, number>;
}) {
  return <li className={`studio5-scene-block ${selected ? 'selected' : ''}`} style={{ flexBasis: `${share}%` }}>
    <div className="studio5-scene-head">
      <button type="button" className="studio5-scene-select" aria-pressed={selected}
        aria-label={`Scene ${index + 1}: ${scene.title}, ${formatMs(scene.duration_ms)}, ${approvalLabel(scene.approval)}`}
        draggable
        onDragStart={event => event.dataTransfer.setData('text/tonde-scene', scene.scene_id)}
        onDragOver={event => { if (event.dataTransfer.types.includes('text/tonde-scene')) event.preventDefault(); }}
        onDrop={event => {
          const dropped = event.dataTransfer.getData('text/tonde-scene');
          if (!dropped || dropped === scene.scene_id) return;
          event.preventDefault();
          onDropScene(dropped, scene.scene_id);
        }}
        onClick={() => onSelectScene(scene.scene_id)}>
        <span className="studio5-scene-order">Scene {index + 1}</span>
        <span className="studio5-scene-title">{scene.title}</span>
        <span className="studio5-scene-duration">{formatMs(scene.duration_ms)}</span>
      </button>
      <div className="studio5-block-actions">
        <button type="button" disabled={busy || index === 0} aria-label={`Move Scene ${index + 1} earlier`}
          onClick={() => onMoveScene(scene.scene_id, -1)}><ChevronLeft size={13} /></button>
        <button type="button" disabled={busy || index === total - 1} aria-label={`Move Scene ${index + 1} later`}
          onClick={() => onMoveScene(scene.scene_id, 1)}><ChevronRight size={13} /></button>
      </div>
    </div>
    <p className="studio5-scene-status" aria-label={`Scene status: ${approvalLabel(scene.approval)}`}>
      {approvalLabel(scene.approval)}
      {scene.locked && <> <Lock size={11} aria-hidden="true" /> locked</>}
      {scene.timing === 'incomplete' && ' · timing incomplete'}
      {scene.execution_methods.length > 0 && ` · ${scene.execution_methods.map(executionMethodLabel).join(' / ')}`}
    </p>
    {zoom !== 'overview' && (scene.shots.length === 0
      ? <p className="studio5-empty">No Shots yet. Ask TONDE to break this Scene into Shots, or add one manually.</p>
      : <ul className="studio5-shot-list">
        {scene.shots.map((shot, shotIndex) => <li key={shot.shot_id}>
          <button type="button" className={`studio5-shot-block ${shot.shot_id === selectedShotId ? 'selected' : ''}`}
            aria-pressed={shot.shot_id === selectedShotId}
            aria-label={`Shot ${shotIndex + 1} of Scene ${index + 1}: ${shot.title}, ${formatMs(shot.duration_ms ?? 0)}, ${approvalLabel(shot.approval)}`}
            draggable
            onDragStart={event => event.dataTransfer.setData('text/tonde-shot', shot.shot_id)}
            onDragOver={event => { if (event.dataTransfer.types.includes('text/tonde-shot')) event.preventDefault(); }}
            onDrop={event => {
              const dropped = event.dataTransfer.getData('text/tonde-shot');
              if (!dropped || dropped === shot.shot_id) return;
              event.preventDefault();
              onDropShot(dropped, shot.shot_id, scene.scene_id);
            }}
            onClick={() => onSelectShot(scene.scene_id, shot.shot_id)}>
            <span className="studio5-shot-order">{index + 1}.{shotIndex + 1}</span>
            <span className="studio5-shot-title">{shot.title}</span>
            <span className="studio5-shot-duration">{formatMs(shot.duration_ms ?? 0)}</span>
            {(resultsByShot?.[shot.shot_id] ?? 0) > 0 && <span className="studio5-shot-results">· {resultsByShot?.[shot.shot_id]} Result{(resultsByShot?.[shot.shot_id] ?? 0) === 1 ? '' : 's'}</span>}
            {shot.locked && <Lock size={11} aria-label="locked" />}
          </button>
          {zoom === 'shot' && <div className="studio5-shot-actions">
            <button type="button" disabled={busy || shotIndex === 0} aria-label={`Move shot ${shot.title} earlier`}
              onClick={() => onMoveShot({ id: shot.shot_id, scene_id: scene.scene_id }, -1)}>Move earlier</button>
            <button type="button" disabled={busy || shotIndex === scene.shots.length - 1}
              aria-label={`Move shot ${shot.title} later`}
              onClick={() => onMoveShot({ id: shot.shot_id, scene_id: scene.scene_id }, 1)}>Move later</button>
          </div>}
        </li>)}
      </ul>)}
  </li>;
}

function RuntimeConflictPanel({ model }: { model: StudioReadModel }) {
  const delta = Math.abs(model.timing.delta_ms ?? 0);
  return <p className="studio5-runtime-warning" role="status">
    This Production is {model.timing.status} its {formatMs(model.timing.target_ms ?? 0)} target by {formatMs(delta)}.
    Reconcile timing from the Shots canvas, or set a new target — nothing is adjusted for you.
  </p>;
}

export function LockToggle({ locked, onToggle, label, busy }: { locked: boolean; onToggle: () => void; label: string; busy: boolean }) {
  return <button type="button" className="studio5-lock" disabled={busy} aria-pressed={locked}
    onClick={onToggle}>{locked ? <Unlock size={13} /> : <Lock size={13} />}{locked ? `Unlock ${label}` : `Lock ${label}`}</button>;
}
