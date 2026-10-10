import { useEffect, useState } from 'react';
import { safeError } from '../services/errors';
import { ChevronLeft, ChevronRight, Copy, Plus, Trash2 } from 'lucide-react';
import { productionService, type ProductionAudioPlan, type ProductionAudioSurface, type SceneAudioDirection, type StudioAsset, type StudioReadModel, type StudioScene, type StudioShot, type StudioTiming } from '../services/productions';
import { PRODUCT } from '../types/product';
import { EmptyState } from '../components/StateComponents';
import { LockToggle, approvalLabel, formatMs } from './StudioTimeline';

const SHOT_PURPOSES = ['establish', 'reveal product', 'emotional reaction', 'coverage', 'transition', 'insert', 'detail', 'payoff', 'call to action'] as const;
const FRAMINGS = ['wide', 'medium', 'close', 'macro', 'over the shoulder', 'top down'] as const;

export function SceneCanvas({
  model, scene, busy, onSelectScene, onCreate, onUpdate, onDuplicate, onArchive, onMove, onToggleLock, onApprove, onReconcile,
}: {
  model: StudioReadModel; scene: StudioScene | null; busy: boolean;
  onSelectScene: (sceneId: string) => void;
  onCreate: (input: Record<string, unknown>) => Promise<unknown>;
  onUpdate: (scene: StudioScene, patch: Record<string, unknown>) => Promise<unknown>;
  onDuplicate: (scene: StudioScene) => Promise<unknown>;
  onArchive: (scene: StudioScene, cascade: boolean) => Promise<unknown>;
  onMove: (scene: StudioScene, direction: -1 | 1) => Promise<unknown>;
  onToggleLock: (scene: StudioScene) => Promise<unknown>;
  onApprove: (scene: StudioScene, approval: StudioScene['approval']) => Promise<unknown>;
  onReconcile: (scene: StudioScene) => Promise<unknown>;
}) {
  const [title, setTitle] = useState('');
  return <div className="studio5-canvas">
    <header className="studio5-canvas-head">
      <h2>Scenes</h2>
      <p className="subtle">Every Scene is one canonical Production object. Reordering persists the Studio order, not a local view.</p>
    </header>
    <form className="studio5-inline-form" onSubmit={async event => {
      event.preventDefault();
      if (!title.trim()) return;
      await onCreate({ title: title.trim(), expected_production_revision: model.production.revision });
      setTitle('');
    }}>
      <label htmlFor="scene-title">New Scene title</label>
      <input id="scene-title" value={title} maxLength={160} onChange={event => setTitle(event.target.value)} placeholder="Cold open" />
      <button type="submit" className="primary" disabled={busy || !title.trim()}><Plus size={14} />Add Scene</button>
    </form>

    {model.scenes.length === 0 && <EmptyState title="No Scenes yet"
      action={<p className="subtle">Ask TONDE to write the Story, or add one manually above.</p>}>
      A Production becomes shootable once its Story is divided into Scenes and Shots.</EmptyState>}

    <ol className="studio5-scene-list">
      {model.scenes.map((item, index) => <li key={item.id} className={scene?.id === item.id ? 'selected' : ''}>
        <button type="button" className="studio5-scene-row" aria-pressed={scene?.id === item.id}
          onClick={() => onSelectScene(item.id)}>
          <span className="studio5-scene-order">Scene {index + 1}</span>
          <span>{item.title}</span>
          <span>{formatMs(item.duration_ms)}</span>
          <span>{item.shot_count} shot{item.shot_count === 1 ? '' : 's'}</span>
          <span>{approvalLabel(item.approval)}</span>
          {item.locked_at && <span>locked</span>}
          {item.timing === 'incomplete' && <span>timing incomplete</span>}
        </button>
        <div className="studio5-row-actions">
          <button type="button" disabled={busy || index === 0} onClick={() => void onMove(item, -1)}
            aria-label={`Move ${item.title} earlier`}><ChevronLeft size={13} /></button>
          <button type="button" disabled={busy || index === model.scenes.length - 1} onClick={() => void onMove(item, 1)}
            aria-label={`Move ${item.title} later`}><ChevronRight size={13} /></button>
          <button type="button" disabled={busy} onClick={() => void onDuplicate(item)} aria-label={`Duplicate ${item.title}`}><Copy size={13} /></button>
          <button type="button" disabled={busy} onClick={() => void onArchive(item, item.shot_count > 0)}
            aria-label={`Archive ${item.title}`}><Trash2 size={13} />Archive</button>
          <LockToggle locked={!!item.locked_at} busy={busy} label="Scene" onToggle={() => void onToggleLock(item)} />
        </div>
      </li>)}
    </ol>

    {scene && <section className="studio5-editor" aria-label={`Scene editor for ${scene.title}`}>
      <h3>Scene {scene.order}: {scene.title}</h3>
      <p className="subtle">Revision {scene.revision} · {approvalLabel(scene.approval)}
        {scene.locked_at ? ' · locked' : ''} · {formatMs(scene.duration_ms)}
        {scene.timing === 'derived' ? ' from its Shots' : scene.timing === 'incomplete' ? ' (a Shot has no duration yet)' : ' planned'}</p>
      <SceneFields scene={scene} busy={busy} disabled={!!scene.locked_at}
        onSave={patch => onUpdate(scene, patch)} />
      <div className="studio5-approval-actions" role="group" aria-label="Scene approval">
        <button type="button" disabled={busy} aria-pressed={scene.approval === 'needs_review'}
          onClick={() => void onApprove(scene, 'needs_review')}>Needs review</button>
        <button type="button" disabled={busy} aria-pressed={scene.approval === 'approved'}
          onClick={() => void onApprove(scene, 'approved')}>Approve Scene</button>
        <button type="button" disabled={busy} aria-pressed={scene.approval === 'draft'}
          onClick={() => void onApprove(scene, 'draft')}>Back to draft</button>
        {model.runtime_conflict && <button type="button" disabled={busy} onClick={() => void onReconcile(scene)}>
          Absorb the runtime difference here
        </button>}
      </div>
      <SceneUsage model={model} scene={scene} />
    </section>}
  </div>;
}

function SceneFields({ scene, busy, disabled, onSave }: {
  scene: StudioScene; busy: boolean; disabled: boolean; onSave: (patch: Record<string, unknown>) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState({
    title: scene.title, purpose: scene.purpose, story_beat: scene.story_beat,
    description: scene.description, opening_state: scene.opening_state, ending_state: scene.ending_state,
    visual_intent: scene.visual_intent, dialogue_notes: scene.dialogue_notes,
  });
  const [error, setError] = useState<string | null>(null);
  const changed = Object.entries(draft).some(([key, value]) => (scene as unknown as Record<string, string>)[key] !== value);
  return <form className="studio5-field-grid" onSubmit={async event => {
    event.preventDefault();
    if (!draft.title.trim()) { setError('A Scene needs a title of 1 to 160 characters.'); return; }
    setError(null);
    await onSave({ ...draft, expected_revision: scene.revision });
  }}>
    <label htmlFor="scene-edit-title">Title<input id="scene-edit-title" value={draft.title} maxLength={160} disabled={disabled}
      onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
    <label htmlFor="scene-edit-purpose">Purpose<input id="scene-edit-purpose" value={draft.purpose} maxLength={1200} disabled={disabled}
      onChange={event => setDraft({ ...draft, purpose: event.target.value })} /></label>
    <label htmlFor="scene-edit-beat">Story beat<input id="scene-edit-beat" value={draft.story_beat} maxLength={200} disabled={disabled}
      onChange={event => setDraft({ ...draft, story_beat: event.target.value })} /></label>
    <label htmlFor="scene-edit-open">Opening state<input id="scene-edit-open" value={draft.opening_state} maxLength={400} disabled={disabled}
      onChange={event => setDraft({ ...draft, opening_state: event.target.value })} /></label>
    <label htmlFor="scene-edit-end">Ending state<input id="scene-edit-end" value={draft.ending_state} maxLength={400} disabled={disabled}
      onChange={event => setDraft({ ...draft, ending_state: event.target.value })} /></label>
    <label htmlFor="scene-edit-visual">Visual intent<textarea id="scene-edit-visual" value={draft.visual_intent} maxLength={900} rows={2} disabled={disabled}
      onChange={event => setDraft({ ...draft, visual_intent: event.target.value })} /></label>
    <label htmlFor="scene-edit-dialogue">Dialogue notes<textarea id="scene-edit-dialogue" value={draft.dialogue_notes} maxLength={900} rows={2} disabled={disabled}
      onChange={event => setDraft({ ...draft, dialogue_notes: event.target.value })} /></label>
    <label htmlFor="scene-edit-description">Action<textarea id="scene-edit-description" value={draft.description} maxLength={4000} rows={3} disabled={disabled}
      onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
    {error && <p role="alert" className="error-text">{error}</p>}
    <div className="studio5-form-actions">
      <button type="submit" className="primary" disabled={busy || disabled || !changed}>Save Scene</button>
      {disabled && <span className="subtle">Unlock this Scene to edit it.</span>}
    </div>
  </form>;
}

function SceneUsage({ model, scene }: { model: StudioReadModel; scene: StudioScene }) {
  const assets = model.assets.filter(asset =>
    scene.character_asset_ids.includes(asset.id) || asset.id === scene.environment_asset_id || asset.used_by_scenes.includes(scene.id));
  return <section className="studio5-usage" aria-label="Where this Scene is used">
    <h4>Cast, world and bindings</h4>
    {assets.length === 0 && scene.bindings.length === 0
      ? <p className="subtle">No Character, Environment or binding is attached to this Scene yet.</p>
      : <ul>
        {assets.map(asset => <li key={asset.id}><strong>{asset.name}</strong> · {PRODUCT.assetTypes[asset.asset_type] ?? asset.asset_type.replaceAll('_', ' ')}
          {scene.environment_asset_id === asset.id ? ' · Scene environment' : ''}
          {scene.character_asset_ids.includes(asset.id) ? ' · in Scene' : ''}</li>)}
        {scene.bindings.map(binding => <li key={binding.id}><strong>{binding.binding_role}</strong> · {binding.inheritance}
          {binding.locked_at ? ' · locked' : ''}</li>)}
      </ul>}
  </section>;
}

export function ShotCanvas({
  model, scene, shot, busy, onSelect, onCreate, onUpdate, onDuplicate, onArchive, onMove, onMoveToScene, onToggleLock, onApprove, onBulk,
}: {
  model: StudioReadModel; scene: StudioScene | null; shot: StudioShot | null; busy: boolean;
  onSelect: (sceneId: string, shotId: string) => void;
  onCreate: (input: Record<string, unknown>) => Promise<unknown>;
  onUpdate: (shot: StudioShot, patch: Record<string, unknown>) => Promise<unknown>;
  onDuplicate: (shot: StudioShot) => Promise<unknown>;
  onArchive: (shot: StudioShot) => Promise<unknown>;
  onMove: (shot: StudioShot, direction: -1 | 1) => Promise<unknown>;
  onMoveToScene: (shot: StudioShot, sceneId: string) => Promise<unknown>;
  onToggleLock: (shot: StudioShot) => Promise<unknown>;
  onApprove: (shot: StudioShot, approval: StudioShot['approval']) => Promise<unknown>;
  onBulk: (shotIds: string[], patch: { execution_method?: StudioShot['execution_method']; approval?: StudioShot['approval'] }) => Promise<unknown>;
}) {
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  if (!scene) return <div className="studio5-canvas"><EmptyState title="Choose a Scene first">
    Shots belong to a Scene. Select one on the left, or create a Scene to hold them.</EmptyState></div>;
  const toggle = (shotId: string) => setSelected(current => current.includes(shotId) ? current.filter(id => id !== shotId) : [...current, shotId]);
  return <div className="studio5-canvas">
    <header className="studio5-canvas-head">
      <h2>Shots in Scene {scene.order}: {scene.title}</h2>
      <p className="subtle">{scene.shots.length} Shot{scene.shots.length === 1 ? '' : 's'} · {formatMs(scene.duration_ms)} · {approvalLabel(scene.approval)}</p>
    </header>
    <form className="studio5-inline-form" onSubmit={async event => {
      event.preventDefault();
      if (!title.trim()) return;
      await onCreate({ scene_id: scene.id, title: title.trim(), expected_production_revision: model.production.revision });
      setTitle('');
    }}>
      <label htmlFor="shot-title">New Shot title</label>
      <input id="shot-title" value={title} maxLength={160} onChange={event => setTitle(event.target.value)} placeholder="Scale macro" />
      <button type="submit" className="primary" disabled={busy || !title.trim()}><Plus size={14} />Add Shot</button>
    </form>

    {selected.length > 0 && <div className="studio5-bulk" role="group" aria-label="Bulk Shot actions">
      <p role="status">{selected.length} Shot{selected.length === 1 ? '' : 's'} selected</p>
      <label htmlFor="bulk-method">Execution method
        <select id="bulk-method" defaultValue="real" onChange={event => void onBulk(selected, { execution_method: event.target.value as StudioShot['execution_method'] })}>
          <option value="real">Shoot (real)</option><option value="ai">Generate (AI)</option><option value="hybrid">Shoot + AI</option>
        </select></label>
      <label htmlFor="bulk-approval">Approval
        <select id="bulk-approval" defaultValue="" onChange={event => {
          if (!event.target.value) return;
          void onBulk(selected, { approval: event.target.value as StudioShot['approval'] });
        }}>
          <option value="">Choose…</option><option value="needs_review">Needs review</option>
          <option value="approved">Approved</option><option value="draft">Draft</option>
        </select></label>
      <button type="button" onClick={() => setSelected([])}>Clear selection</button>
    </div>}

    {scene.shots.length === 0
      ? <EmptyState title="No Shots yet" action={<p className="subtle">Add one above, or ask TONDE to break this Scene into Shots.</p>}>
        Shots are the smallest creative unit of the Production. They carry framing, duration and execution method.</EmptyState>
      : <ol className="studio5-shot-cards">
        {scene.shots.map((item, index) => <li key={item.id} className={shot?.id === item.id ? 'selected' : ''}>
          <div className="studio5-shot-card">
            <label className="studio5-shot-select" htmlFor={`select-${item.id}`}>
              <input id={`select-${item.id}`} type="checkbox" checked={selected.includes(item.id)}
                onChange={() => toggle(item.id)} aria-label={`Select shot ${index + 1}: ${item.title}`} />
              <button type="button" className="studio5-shot-open" aria-pressed={shot?.id === item.id}
                onClick={() => onSelect(scene.id, item.id)}>
                <span className="studio5-shot-order">{scene.order}.{index + 1}</span>
                <strong>{item.title}</strong>
                <span>{formatMs(item.planned_duration_ms ?? 0)}</span>
                <span>{item.framing || 'framing unset'}</span>
                <span>{item.purpose || 'purpose unset'}</span>
                <span className="studio5-chip">{item.execution_method.toUpperCase()}</span>
                <span>{approvalLabel(item.approval)}</span>
                {item.locked_at && <span>locked</span>}
              </button>
            </label>
            <div className="studio5-row-actions">
              <button type="button" disabled={busy || index === 0} onClick={() => void onMove(item, -1)} aria-label={`Move shot ${index + 1} earlier`}><ChevronLeft size={13} /></button>
              <button type="button" disabled={busy || index === scene.shots.length - 1} onClick={() => void onMove(item, 1)} aria-label={`Move shot ${index + 1} later`}><ChevronRight size={13} /></button>
              <button type="button" disabled={busy} onClick={() => void onDuplicate(item)} aria-label={`Duplicate shot ${index + 1}`}><Copy size={13} /></button>
              <button type="button" disabled={busy} onClick={() => void onArchive(item)} aria-label={`Archive shot ${index + 1}`}><Trash2 size={13} />Archive</button>
              <LockToggle locked={!!item.locked_at} busy={busy} label="Shot" onToggle={() => void onToggleLock(item)} />
            </div>
          </div>
        </li>)}
      </ol>}

    {shot && <section className="studio5-editor" aria-label={`Shot editor for ${shot.title}`}>
      <h3>{shot.title}</h3>
      <p className="subtle">Revision {shot.revision} · {approvalLabel(shot.approval)}{shot.locked_at ? ' · locked' : ''}
        {shot.result_count > 0 ? ` · ${shot.result_count} result(s)` : ''}</p>
      <ShotFields shot={shot} busy={busy} disabled={!!shot.locked_at} onSave={patch => onUpdate(shot, patch)} />
      <div className="studio5-move-target" role="group" aria-label="Move this Shot to another Scene">
        <label htmlFor="move-shot-scene">Move to Scene</label>
        <select id="move-shot-scene" defaultValue="" disabled={busy || !!shot.locked_at} onChange={event => {
          if (event.target.value) void onMoveToScene(shot, event.target.value);
        }}>
          <option value="">Choose…</option>
          {model.scenes.filter(candidate => candidate.id !== shot.scene_id)
            .map(candidate => <option key={candidate.id} value={candidate.id}>Scene {candidate.order}: {candidate.title}</option>)}
        </select>
        <span className="subtle">Moving a Shot keeps it the same Shot — the hierarchy and timeline follow.</span>
      </div>
      <div className="studio5-approval-actions" role="group" aria-label="Shot approval">
        <button type="button" disabled={busy} aria-pressed={shot.approval === 'needs_review'} onClick={() => void onApprove(shot, 'needs_review')}>Needs review</button>
        <button type="button" disabled={busy} aria-pressed={shot.approval === 'approved'} onClick={() => void onApprove(shot, 'approved')}>Approve Shot</button>
        <button type="button" disabled={busy} aria-pressed={shot.approval === 'draft'} onClick={() => void onApprove(shot, 'draft')}>Back to draft</button>
      </div>
    </section>}
  </div>;
}

function ShotFields({ shot, busy, disabled, onSave }: {
  shot: StudioShot; busy: boolean; disabled: boolean; onSave: (patch: Record<string, unknown>) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState({
    title: shot.title, purpose: shot.purpose, subject: shot.subject, action: shot.action,
    framing: shot.framing, angle: shot.angle, movement: shot.movement, composition: shot.composition,
    transition: shot.transition, story_relationship: shot.story_relationship, creative_notes: shot.creative_notes,
    duration_ms: shot.planned_duration_ms === null ? '' : String(shot.planned_duration_ms),
    execution_method: shot.execution_method,
  });
  const [error, setError] = useState<string | null>(null);
  const changed = Object.entries(draft).some(([key, value]) => {
    if (key === 'duration_ms') return String(shot.planned_duration_ms ?? '') !== value;
    return (shot as unknown as Record<string, string>)[key] !== value;
  });
  const durationValue = draft.duration_ms.trim() === '' ? null : Number(draft.duration_ms);
  const durationInvalid = durationValue !== null && (!Number.isInteger(durationValue) || durationValue < 0);
  return <form className="studio5-field-grid" onSubmit={async event => {
    event.preventDefault();
    if (!draft.title.trim()) { setError('A Shot needs a title of 1 to 160 characters.'); return; }
    if (durationInvalid) { setError('Shot duration must be whole milliseconds, or left empty when unknown.'); return; }
    setError(null);
    await onSave({ ...draft, duration_ms: durationValue, expected_revision: shot.revision });
  }}>
    <label htmlFor="shot-edit-title">Title<input id="shot-edit-title" value={draft.title} maxLength={160} disabled={disabled}
      onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
    <label htmlFor="shot-edit-purpose">Purpose<select id="shot-edit-purpose" value={draft.purpose} disabled={disabled}
      onChange={event => setDraft({ ...draft, purpose: event.target.value })}>
      <option value="">Choose…</option>
      {SHOT_PURPOSES.map(purpose => <option key={purpose} value={purpose}>{purpose}</option>)}
      {draft.purpose && !SHOT_PURPOSES.includes(draft.purpose as typeof SHOT_PURPOSES[number]) && <option value={draft.purpose}>{draft.purpose}</option>}
    </select></label>
    <label htmlFor="shot-edit-framing">Framing<select id="shot-edit-framing" value={draft.framing} disabled={disabled}
      onChange={event => setDraft({ ...draft, framing: event.target.value })}>
      <option value="">Choose…</option>
      {FRAMINGS.map(framing => <option key={framing} value={framing}>{framing}</option>)}
      {draft.framing && !FRAMINGS.includes(draft.framing as typeof FRAMINGS[number]) && <option value={draft.framing}>{draft.framing}</option>}
    </select></label>
    <label htmlFor="shot-edit-subject">Subject<input id="shot-edit-subject" value={draft.subject} maxLength={200} disabled={disabled}
      onChange={event => setDraft({ ...draft, subject: event.target.value })} /></label>
    <label htmlFor="shot-edit-angle">Angle<input id="shot-edit-angle" value={draft.angle} maxLength={120} disabled={disabled}
      onChange={event => setDraft({ ...draft, angle: event.target.value })} /></label>
    <label htmlFor="shot-edit-movement">Movement<input id="shot-edit-movement" value={draft.movement} maxLength={160} disabled={disabled}
      onChange={event => setDraft({ ...draft, movement: event.target.value })} /></label>
    <label htmlFor="shot-edit-composition">Composition<input id="shot-edit-composition" value={draft.composition} maxLength={300} disabled={disabled}
      onChange={event => setDraft({ ...draft, composition: event.target.value })} /></label>
    <label htmlFor="shot-edit-transition">Transition out<input id="shot-edit-transition" value={draft.transition} maxLength={200} disabled={disabled}
      onChange={event => setDraft({ ...draft, transition: event.target.value })} /></label>
    <label htmlFor="shot-edit-story">Story relationship<input id="shot-edit-story" value={draft.story_relationship} maxLength={300} disabled={disabled}
      onChange={event => setDraft({ ...draft, story_relationship: event.target.value })} /></label>
    <label htmlFor="shot-edit-duration">Duration (ms){' '}
      <input id="shot-edit-duration" inputMode="numeric" value={draft.duration_ms} disabled={disabled}
        aria-invalid={durationInvalid} aria-describedby="shot-duration-help"
        onChange={event => setDraft({ ...draft, duration_ms: event.target.value.replace(/[^0-9]/g, '') })} /></label>
    <p id="shot-duration-help" className="subtle">Leave empty when the duration is not decided yet — Scene timing then reports itself as incomplete instead of guessing.</p>
    <label htmlFor="shot-edit-method">Execution method<select id="shot-edit-method" value={draft.execution_method} disabled={disabled}
      onChange={event => setDraft({ ...draft, execution_method: event.target.value as StudioShot['execution_method'] })}>
      <option value="real">Shoot (real)</option><option value="ai">Generate (AI)</option><option value="hybrid">Shoot + AI</option>
    </select></label>
    <label htmlFor="shot-edit-action">Action<textarea id="shot-edit-action" value={draft.action} maxLength={4000} rows={2} disabled={disabled}
      onChange={event => setDraft({ ...draft, action: event.target.value })} /></label>
    <label htmlFor="shot-edit-notes">Creative notes<textarea id="shot-edit-notes" value={draft.creative_notes} maxLength={1200} rows={2} disabled={disabled}
      onChange={event => setDraft({ ...draft, creative_notes: event.target.value })} /></label>
    {error && <p role="alert" className="error-text">{error}</p>}
    <div className="studio5-form-actions">
      <button type="submit" className="primary" disabled={busy || disabled || !changed}>Save Shot</button>
      {disabled && <span className="subtle">Unlock this Shot to edit it.</span>}
    </div>
  </form>;
}

const ASSET_GROUPS: Array<{ tool: string; types: Array<StudioAsset['asset_type']>; title: string; note: string }> = [
  { tool: 'Characters', types: ['character', 'voice'], title: 'Characters and cast', note: 'Performance and continuity depth arrive with Prompt 7; role, story function and Scene usage are authoritative now.' },
  { tool: 'World', types: ['environment'], title: 'Environments', note: 'An Environment is a creative world, not a physical shooting Location.' },
  { tool: 'Products', types: ['product', 'brand'], title: 'Products and brands', note: 'Required visibility and fidelity matter for later Shot Match.' },
  { tool: 'Wardrobe', types: ['wardrobe', 'prop', 'vehicle'], title: 'Wardrobe, props and vehicles', note: 'Continuity checking arrives with Prompt 9.' },
  { tool: 'Style', types: ['style_bible'], title: 'Style Bible', note: 'Technique inheritance (Production → Scene → Shot) is the foundation Prompt 9 will deepen.' },
];

export function AssetCanvas({ model, tool, onSelectAsset, busy }: {
  model: StudioReadModel; tool: string; busy: boolean;
  onSelectAsset: (assetId: string) => void;
}) {
  const group = ASSET_GROUPS.find(item => item.tool === tool);
  if (!group) return null;
  const assets = model.assets.filter(asset => group.types.includes(asset.asset_type));
  return <div className="studio5-canvas">
    <header className="studio5-canvas-head"><h2>{group.title}</h2><p className="subtle">{group.note}</p></header>
    {assets.length === 0
      ? <EmptyState title={`No ${group.title.toLowerCase()} yet`}>
        Nothing is bound to this Production yet. Assets are created from References and the Director, then bound to Scenes and Shots.
      </EmptyState>
      : <ul className="studio5-asset-list">
        {assets.map(asset => <li key={asset.id}>
          <button type="button" className="studio5-asset-row" onClick={() => onSelectAsset(asset.id)}>
            <strong>{asset.name}</strong>
            <span>{PRODUCT.assetTypes[asset.asset_type] ?? asset.asset_type.replaceAll('_', ' ')}</span>
            <span>{asset.used_by_scenes.length > 0 ? `used by ${asset.used_by_scenes.length} Scene(s)` : 'not used by a Scene yet'}</span>
            <span>{approvalLabel(asset.approval)}</span>
            {asset.locked_at && <span>locked</span>}
          </button>
          <p className="subtle">{asset.description || 'No description recorded.'}</p>
          <p className="subtle" role="status">
            Asset approval and locking are granted where an Asset is bound to a Scene or Shot.
            This Production-face view changes nothing: it reports {approvalLabel(asset.approval).toLowerCase()}
            {asset.locked_at ? ' and locked' : ''}.
          </p>
          {Object.keys(asset.metadata).length > 0 && <p className="subtle">Recorded metadata: {Object.keys(asset.metadata).join(', ')}</p>}
        </li>)}
      </ul>}
  </div>;
}

const AUDIO_VIDEO_TYPES = new Set(['social_video','commercial','advertisement','product_film','youtube','interview','documentary','music_video','short_film','long_form_film','trailer']);
const AUDIO_REQUIRED_TYPES = new Set(['campaign','series','recurring_content','custom']);

function AudioPlanEditor({ plan, references, workspaceId, productionId, busy, onSaved }: {
  plan: ProductionAudioPlan; references: Array<{ reference_id: string; source_identity: string|null; shaping_ready: boolean }>;
  workspaceId: string; productionId: string; busy: boolean; onSaved: (value: ProductionAudioPlan) => void;
}) {
  const [draft, setDraft] = useState(plan);
  const [error, setError] = useState<string|null>(null);
  const [notice, setNotice] = useState<string|null>(null);
  useEffect(() => setDraft(plan), [plan]);
  const field = (label: string, key: keyof ProductionAudioPlan, rows = 2) => <label>{label}<textarea rows={rows} value={String(draft[key] ?? '')} onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))} /></label>;
  const otherMasterSongProvenance = draft.master_song_provenance;
  const allowedMasterSongProvenance = ['creator_supplied','licensed','external_reference','unknown'];
  const masterSongProvenance = allowedMasterSongProvenance.includes(otherMasterSongProvenance) ? otherMasterSongProvenance : 'unknown';
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setError(null); setNotice(null);
    try {
      const saved = await productionService.saveProductionAudioPlan(workspaceId, productionId, plan.revision, {
        overall_intent: draft.overall_intent, dialogue_strategy: draft.dialogue_strategy, music_strategy: draft.music_strategy,
        sound_design_strategy: draft.sound_design_strategy, ambience_strategy: draft.ambience_strategy,
        recording_considerations: draft.recording_considerations, silence_strategy: draft.silence_strategy,
        recurring_motifs: draft.recurring_motifs, continuity_considerations: draft.continuity_considerations,
        delivery_considerations: draft.delivery_considerations, intentional_silence: draft.intentional_silence,
        master_song_reference_id: draft.master_song_reference_id, master_song_provenance: masterSongProvenance,
      });
      onSaved(saved); setNotice(`Audio Plan saved as revision ${saved.revision}.`);
    } catch (failure) { setError(safeError(failure).message); }
  };
  return <form className="studio5-editor" aria-label="Production Audio Plan" onSubmit={save}>
    <h3>Production Audio Plan</h3><p className="subtle">Direction is planned, not inferred. Dialogue stays in the Script; this plan coordinates it with music, sound, ambience and recording.</p>
    <p className="subtle" role="status">Direction state: {draft.direction_state.replaceAll('_',' ')} · revision {plan.revision}</p>
    {field('Overall audio intent','overall_intent')}{field('Dialogue and voice strategy','dialogue_strategy')}
    {field('Music strategy','music_strategy')}{field('Sound design strategy','sound_design_strategy')}
    {field('Ambience strategy','ambience_strategy')}{field('Recording considerations','recording_considerations')}
    {field('Intentional silence strategy','silence_strategy')}{field('Continuity considerations','continuity_considerations')}
    {field('Delivery considerations','delivery_considerations')}
    <label>Recurring musical/sound motifs<input value={draft.recurring_motifs.join(', ')} onChange={event => setDraft(current => ({ ...current, recurring_motifs: event.target.value.split(',').map(item => item.trim()).filter(Boolean).slice(0,20) }))} /></label>
    <label>Master song Reference<select value={draft.master_song_reference_id ?? ''} onChange={event => setDraft(current => ({ ...current, master_song_reference_id: event.target.value || null }))}>
      <option value="">No linked master song Reference</option>{references.filter(reference => reference.shaping_ready).map(reference => <option key={reference.reference_id} value={reference.reference_id}>{reference.source_identity || reference.reference_id}</option>)}
    </select></label>
    <label>Master song provenance<select value={masterSongProvenance} onChange={event => setDraft(current => ({ ...current, master_song_provenance: event.target.value }))}>
      {['creator_supplied','licensed','external_reference','unknown'].map(value => <option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}
    </select></label>
    <label className="settings-toggle"><input type="checkbox" checked={draft.intentional_silence} onChange={event => setDraft(current => ({ ...current, intentional_silence: event.target.checked }))} />The Production intentionally uses silence</label>
    {error && <p role="alert" className="error-text">{error}</p>}{notice && <p role="status" className="subtle">{notice}</p>}
    <button type="submit" className="primary" disabled={busy || !!plan.locked_at}>{plan.locked_at ? 'Unlock the Audio Plan to edit' : 'Save Audio Plan'}</button>
  </form>;
}

function SceneAudioEditor({ scene, direction, references, workspaceId, productionId, busy, onSaved }: {
  scene: StudioScene; direction: SceneAudioDirection|null; references: Array<{ reference_id: string; source_identity: string|null; shaping_ready: boolean }>; workspaceId: string; productionId: string; busy: boolean;
  onSaved: (value: SceneAudioDirection) => void;
}) {
  const [draft, setDraft] = useState<Partial<SceneAudioDirection>>(direction ?? { music_use:'undecided', music_direction:'', sound_use:'undecided', sound_direction:'', sound_events:[] });
  const [error, setError] = useState<string|null>(null);
  const [notice, setNotice] = useState<string|null>(null);
  useEffect(() => setDraft(direction ?? { music_use:'undecided', music_direction:'', sound_use:'undecided', sound_direction:'', sound_events:[] }), [direction]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setError(null); setNotice(null);
    try {
      const saved = await productionService.saveSceneAudioDirection(workspaceId, productionId, scene.id, direction?.revision ?? null, {
        music_use: draft.music_use as string, music_direction: draft.music_direction as string,
        cue_start_ms: draft.cue_start_ms ?? null, cue_end_ms: draft.cue_end_ms ?? null, cue_duration_ms: draft.cue_duration_ms ?? null,
        music_purpose: draft.music_purpose as string, rhythmic_quality: draft.rhythmic_quality as string,
        instrumentation: draft.instrumentation as string, dynamics: draft.dynamics as string, diegetic: draft.diegetic ?? null,
        dialogue_relationship: draft.dialogue_relationship as string, action_relationship: draft.action_relationship as string,
        motif_relationship: draft.motif_relationship as string, master_song_reference_id: draft.master_song_reference_id ?? null,
        sound_use: draft.sound_use as string, sound_direction: draft.sound_direction as string,
        sound_events: draft.sound_events ?? [], recording_needs: draft.recording_needs as string,
        microphone_considerations: draft.microphone_considerations as string, voice_treatment: draft.voice_treatment as string,
        continuity_considerations: draft.continuity_considerations as string,
      });
      onSaved(saved); setNotice(`Scene audio direction saved as revision ${saved.revision}.`);
    } catch (failure) { setError(safeError(failure).message); }
  };
  const text = (label: string, key: keyof SceneAudioDirection, rows = 2) => <label>{label}<textarea rows={rows} value={String(draft[key] ?? '')} onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))} /></label>;
  const choice = (label: string, key: 'music_use'|'sound_use', values: string[]) => <label>{label}<select value={String(draft[key] ?? 'undecided')} onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))}>{values.map(value => <option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}</select></label>;
  return <form className="studio5-editor" aria-label={`Audio direction for ${scene.title}`} onSubmit={save}>
    <h4>Scene {scene.order}: {scene.title} · {direction ? `revision ${direction.revision}` : 'not yet directed'}</h4>
    <section><h5>Music Direction</h5>{choice('Music use','music_use',['undecided','use','intentional_silence','not_applicable'])}{text('Music Direction','music_direction')}{text('Music purpose','music_purpose')}
      <label>Cue start (ms)<input type="number" min="0" value={draft.cue_start_ms ?? ''} onChange={event => setDraft(current => ({ ...current, cue_start_ms: event.target.value ? Number(event.target.value) : null }))} /></label>
      <label>Cue end (ms)<input type="number" min="0" value={draft.cue_end_ms ?? ''} onChange={event => setDraft(current => ({ ...current, cue_end_ms: event.target.value ? Number(event.target.value) : null }))} /></label>
      {text('Rhythmic quality','rhythmic_quality',1)}{text('Instrumentation','instrumentation',1)}{text('Dynamics','dynamics',1)}{text('Relationship to dialogue','dialogue_relationship',1)}{text('Relationship to action','action_relationship',1)}{text('Motif relationship','motif_relationship',1)}
      <label>Master song Reference (from the Production Audio Plan)<select value={draft.master_song_reference_id ?? ''} onChange={event => setDraft(current => ({ ...current, master_song_reference_id: event.target.value || null }))}>
        <option value="">No scene-specific song link</option>{references.filter(reference => reference.shaping_ready).map(reference => <option key={reference.reference_id} value={reference.reference_id}>{reference.source_identity || reference.reference_id}</option>)}
      </select></label>
      <label>Diegetic<select value={draft.diegetic == null ? '' : String(draft.diegetic)} onChange={event => setDraft(current => ({ ...current, diegetic: event.target.value === '' ? null : event.target.value === 'true' }))}><option value="">Unspecified</option><option value="true">Diegetic</option><option value="false">Non-diegetic</option></select></label>
    </section>
    <section><h5>Sound Direction</h5>{choice('Sound use','sound_use',['undecided','directed','intentional_silence','not_applicable'])}{text('Sound Direction','sound_direction')}
      <label>Sound events (comma-separated)<input value={(draft.sound_events ?? []).join(', ')} onChange={event => setDraft(current => ({ ...current, sound_events: event.target.value.split(',').map(item => item.trim()).filter(Boolean).slice(0,30) }))} /></label>
      {text('Recording needs','recording_needs')}{text('Microphone considerations','microphone_considerations',1)}{text('Voice treatment','voice_treatment',1)}{text('Continuity considerations','continuity_considerations')}
    </section>
    {error && <p role="alert" className="error-text">{error}</p>}{notice && <p role="status" className="subtle">{notice}</p>}
    <button type="submit" className="primary" disabled={busy || !!direction?.locked_at}>{direction?.locked_at ? 'Unlock this Scene direction to edit' : 'Save Scene Music and Sound Direction'}</button>
  </form>;
}

export function AudioCanvas({ workspaceId, productionId, model, productionType, durationMs, references, onChanged, busy }: {
  workspaceId: string; productionId: string; model: StudioReadModel; productionType: string; durationMs: number|null;
  references: Array<{ reference_id: string; source_identity: string|null; shaping_ready: boolean }>;
  onChanged: () => void; busy: boolean;
}) {
  const [surface, setSurface] = useState<ProductionAudioSurface|null>(null);
  const [error, setError] = useState<string|null>(null);
  const [loading, setLoading] = useState(true);
  const reload = () => { setLoading(true); setError(null); void productionService.productionAudioSurface(workspaceId, productionId)
    .then(value => setSurface(value)).catch(failure => setError(safeError(failure).message)).finally(() => setLoading(false)); };
  useEffect(() => { reload(); }, [workspaceId, productionId]);
  if (loading && !surface) return <div className="studio5-canvas"><p role="status">Loading Audio Plan…</p></div>;
  if (error && !surface) return <div className="studio5-canvas"><p role="alert" className="error-text">{error}</p><button type="button" onClick={reload}>Try again</button></div>;
  const audiovisual = AUDIO_VIDEO_TYPES.has(productionType) || (AUDIO_REQUIRED_TYPES.has(productionType) && durationMs !== null);
  const applicable = durationMs !== null && audiovisual;
  if (!surface?.audio_plan) return <div className="studio5-canvas" aria-label="Audio Plan"><header className="studio5-canvas-head"><h2>Audio</h2></header>
    <p>{applicable ? 'This timed audiovisual Production has no readable Audio Plan yet.' : 'An Audio Plan applies when this Production is timed and audiovisual. Untimed or photography work is not assigned an artificial audio record.'}</p>
    {durationMs === null && (AUDIO_VIDEO_TYPES.has(productionType) || AUDIO_REQUIRED_TYPES.has(productionType)) && <p className="subtle">When you set the Production runtime, TONDE will attach its Audio Plan to this same Production.</p>}
    {productionType === 'photography' && <p className="subtle">Photography is not treated as audiovisual work. It remains free of forced audio planning.</p>}
    {error && <p role="alert" className="error-text">{error}</p>}
  </div>;
  const savePlan = (plan: ProductionAudioPlan) => { setSurface(current => current ? { ...current, audio_plan: plan } : current); onChanged(); };
  const saveDirection = (direction: SceneAudioDirection) => { setSurface(current => current ? { ...current, scene_directions: [...current.scene_directions.filter(item => item.scene_id !== direction.scene_id), direction] } : current); onChanged(); };
  return <div className="studio5-canvas" aria-label="Audio Plan">
    <header className="studio5-canvas-head"><h2>Audio Plan</h2><p className="subtle">One Production plan; distinct Music Direction and Sound Direction for each Scene. Timing is integer milliseconds.</p></header>
    {error && <p role="alert" className="error-text">{error}</p>}
    <AudioPlanEditor plan={surface.audio_plan} references={references} workspaceId={workspaceId} productionId={productionId} busy={busy} onSaved={savePlan} />
    <section className="studio5-audio-scenes"><h3>Scene Music and Sound Direction</h3>{model.scenes.map(scene => <SceneAudioEditor key={scene.id} scene={scene} references={references}
      direction={surface.scene_directions.find(item => item.scene_id === scene.id) ?? null} workspaceId={workspaceId}
      productionId={productionId} busy={busy} onSaved={saveDirection} />)}
      {!model.scenes.length && <p className="subtle">Add Scenes to direct their separate Music and Sound; no Scene audio rows are fabricated.</p>}
    </section>
  </div>;
}

export function FoundationCanvas({ model, tool, onReconcile, busy }: {
  model: StudioReadModel; tool: string; onReconcile: (scene: StudioScene) => Promise<unknown>; busy: boolean;
}) {
  const script = model.documents.script;
  const caption = {
    Prompts: {
      title: 'Prompts',
      note: 'Prompt compilation belongs to Prompt 7. This surface lists the Shots that already declare generated execution — no prompt text is invented here.',
      rows: model.scenes.flatMap(scene => scene.shots.filter(shot => shot.execution_method !== 'real')
        .map(shot => `${scene.order}.${shot.title} · ${shot.execution_method.toUpperCase()} · ${shot.subject || 'subject unset'}`)),
      empty: 'No Shot declares AI or hybrid execution yet.',
    },
    Audio: {
      title: 'Audio',
      note: 'Dialogue, voice-over, narration and pauses already live in the Script. Music, ambience and SFX planning arrives with the Sound Director.',
      rows: model.scenes.map(scene => `Scene ${scene.order} · ${scene.dialogue_lines} dialogue line(s) · ${scene.dialogue_notes || 'no dialogue notes'}`),
      empty: 'No Scene yet, so there is nothing to organise.',
    },
    Edit: {
      title: 'Edit',
      note: 'Editorial structure is the Scene and Shot order you already set. Transitions and pacing notes are recorded per Shot.',
      rows: model.scenes.map(scene => `Scene ${scene.order}: ${scene.title} · ${formatMs(scene.duration_ms)} · ${scene.shots.length} shot(s)`),
      empty: 'No Scene yet.',
    },
  }[tool];
  if (!caption) return null;
  return <div className="studio5-canvas">
    <header className="studio5-canvas-head"><h2>{caption.title}</h2><p className="subtle">{caption.note}</p></header>
    {caption.rows.length === 0 ? <p className="studio5-empty">{caption.empty}</p>
      : <ul className="studio5-rows">{caption.rows.map(row => <li key={row}>{row}</li>)}</ul>}
    {tool === 'Edit' && model.runtime_conflict && <div className="studio5-runtime-warning" role="status">
      <p>The Production is {model.timing.status} its runtime target by {formatMs(Math.abs(model.timing.delta_ms ?? 0))}.</p>
      <p className="subtle">Choose the Scene that should absorb the difference — its last Shot takes the exact change.</p>
      <div className="studio5-row-actions">
        {model.scenes.map(scene => <button key={scene.id} type="button" disabled={busy}
          onClick={() => void onReconcile(scene)}>Absorb in Scene {scene.order}</button>)}
      </div>
    </div>}
    {tool === 'Prompts' && !script && <p className="subtle">No Script document is persisted yet, so prompt structure has nothing to compile from.</p>}
  </div>;
}

export function TimingInspector({ timing }: { timing: StudioTiming }) {
  return <section className="studio5-timing" aria-label="Runtime reconciliation">
    <h3>Runtime</h3>
    <ul>
      <li><strong>Target</strong><span>{formatMs(timing.target_ms)}</span></li>
      <li><strong>Canonical total</strong><span>{formatMs(timing.total_ms)}</span></li>
      <li><strong>Difference</strong><span>{timing.delta_ms === null ? '—' : formatMs(timing.delta_ms)}</span></li>
      <li><strong>Status</strong><span>{timing.status}</span></li>
    </ul>
  </section>;
}
