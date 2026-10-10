import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Sparkles, BookOpen, FileText, Layers, Clapperboard, Camera, Music, Target,
  Send, ArrowUpRight,
} from 'lucide-react';import { productionService, type DirectorCommandPreview, type DirectorCommandResult, type DirectorStory,
  type DirectorStudio, type StudioReadModel, type StudioScene, type StudioShot,
} from '../services/productions';
import { productionContinuityService, type ContinuityFinding } from '../services/productionContinuity';
import { safeError } from '../services/errors';
import { formatRuntime } from '../types/domain';
import { PRODUCT } from '../types/product';
import { approvalLabel, formatMs } from './StudioTimeline';
import { DirectorCommandResultPanel } from '../components/StudioCanvases';
import { ErrorState, LoadingState, PartialState } from '../components/StateComponents';

// Eight working faces of the same Master Production (canonical Studio design).
// Rail views map onto the existing tool/tool-param vocabulary so deep links,
// history entries and every existing Studio capability keep working.
export type StudioView = 'idea' | 'story' | 'script' | 'scenes' | 'shots' | 'produce' | 'edit' | 'results';
export type StudioMode = 'real' | 'ai' | 'hybrid';

export const STUDIO_RAIL: Array<{ view: StudioView; label: string; access: string; icon: typeof Layers }> = [
  { view: 'idea', label: 'Idea', access: 'Idea Lab', icon: Sparkles },
  { view: 'story', label: 'Story', access: 'Story', icon: BookOpen },
  { view: 'script', label: 'Script', access: 'Script', icon: FileText },
  { view: 'scenes', label: 'Scenes', access: 'Scenes', icon: Layers },
  { view: 'shots', label: 'Shots', access: 'Shots', icon: Clapperboard },
  { view: 'produce', label: 'Produce', access: 'Produce', icon: Camera },
  { view: 'edit', label: 'Edit', access: 'Audio and edit', icon: Music },
  { view: 'results', label: 'Results', access: 'Results', icon: Target },
];

const VIEW_META: Record<StudioView, { title: string; sub: string }> = {
  idea: { title: 'Idea Lab', sub: 'Search, shape and pressure-test the idea before TONDE turns it into a Production.' },
  story: { title: 'Story', sub: 'Premise, hook, escalation, emotional movement and payoff.' },
  script: { title: 'Script', sub: 'Dialogue, action and scene intent with production consequences.' },
  scenes: { title: 'Scenes', sub: 'Direct one Scene at a time across every production layer.' },
  shots: { title: 'Shots', sub: 'Storyboard coverage with a reason to exist.' },
  produce: { title: 'Production', sub: 'Turn creative intent into a shootable or generatable plan.' },
  edit: { title: 'Audio + Edit', sub: 'Rhythm, music, ambience and the semantic edit.' },
  results: { title: 'Results', sub: 'Compare evidence with intent and direct the next attempt.' },
};

export function StudioTopBar({ typeBadge, titleEditor, saveState, reviewCount, mode, onMode, onPreview, onShare, onExport, directorOpen, onToggleDirector }: {
  typeBadge: string; titleEditor: ReactNode; saveState: string; reviewCount: number;
  mode: StudioMode; onMode: (mode: StudioMode) => void;
  onPreview: () => void; onShare: () => void; onExport: () => void;
  directorOpen: boolean; onToggleDirector: () => void;
}) {
  return <header className="s8-topbar">
    <Link className="s8-brand" to="/projects" aria-label="Back to Projects"><span className="s8-brandmark" aria-hidden="true">T</span></Link>
    <div className="s8-divider" aria-hidden="true" />
    <Link className="s8-back" to="/projects"><ArrowLeft size={14} aria-hidden="true" /><span>Projects</span></Link>
    <div className="s8-identity">
      <span className="s8-badge">{typeBadge}</span>
      {titleEditor}
      <span className="s8-saved" role="status">{saveState}</span>
      {reviewCount > 0 && <span className="s8-badge warn">{reviewCount} review item{reviewCount === 1 ? '' : 's'}</span>}
    </div>
    <div className="s8-mode" role="group" aria-label="Execution mode">
      <button type="button" aria-pressed={mode === 'real'} className={mode === 'real' ? 'active' : ''} onClick={() => onMode('real')}>{PRODUCT.executionFaces.real.toUpperCase()}</button>
      <button type="button" aria-pressed={mode === 'ai'} className={mode === 'ai' ? 'active' : ''} onClick={() => onMode('ai')}>{PRODUCT.executionFaces.ai.toUpperCase()}</button>
      <button type="button" aria-pressed={mode === 'hybrid'} className={mode === 'hybrid' ? 'active' : ''} onClick={() => onMode('hybrid')}>HYBRID</button>
    </div>
    <button type="button" className="s8-ghost" onClick={onPreview}>Preview</button>
    <button type="button" className="s8-ghost" onClick={onShare}>Share</button>
    <button type="button" className="s8-primary" onClick={onExport}>Export</button>
    <button type="button" className="s8-ghost" onClick={onToggleDirector} aria-expanded={directorOpen}>{directorOpen ? 'Hide Director' : 'Show Director'}</button>
  </header>;
}

export function StudioDrawer({ view, model, surface, selectedSceneId, selectedShotId, onSelectScene, onSelectShot, onOpenTool, allTools, activeTool }: {
  view: StudioView; model: StudioReadModel; surface: DirectorStudio | null;
  selectedSceneId: string | null; selectedShotId: string | null;
  onSelectScene: (sceneId: string) => void; onSelectShot: (sceneId: string, shotId: string) => void;
  onOpenTool: (tool: string) => void; allTools: Array<{ name: string }>; activeTool: string;
}) {
  const meta = VIEW_META[view];
  const scenes = model.scenes;
  const shots = scenes.flatMap(scene => scene.shots.map(shot => ({ scene, shot })));
  const beats = surface?.story?.beats ?? [];
  const references = surface?.references ?? [];
  return <aside className="s8-drawer" aria-label={`${meta.title} tools`}>
    <p className="eyebrow">{meta.title}</p>
    <p className="s8-drawer-title" aria-hidden="true">{meta.title}</p>
    <p className="s8-sub">{meta.sub}</p>
    {view === 'idea' && <>
      <DrawerSection title="Idea sources" index="01">
        <DrawerInfo label="Core idea" value={surface?.brief?.production_goal || model.production.title} />
        <DrawerInfo label="Audience" value={surface?.brief?.audience || 'Not specified'} />
        <DrawerInfo label="Format" value={[surface?.brief?.format, surface?.brief?.platform].filter(Boolean).join(' · ') || 'Not specified'} />
        <DrawerInfo label="Tone" value={(surface?.brief?.tone ?? []).join(', ') || 'Not specified'} />
      </DrawerSection>
      <DrawerSection title="Direction" index="02">
        <button type="button" className="s8-item" onClick={() => onOpenTool('Story')}><span>Open Story</span><small>Map</small></button>
        <button type="button" className="s8-item" onClick={() => onOpenTool('References')}><span>References</span><small>{references.length}</small></button>
        <button type="button" className="s8-item" onClick={() => onOpenTool('Reality Check')}><span>Reality Check</span><small>Kit fit</small></button>
      </DrawerSection>
    </>}
    {view === 'story' && <>
      <DrawerSection title="Structure" index="01">
        {beats.length === 0 && <p className="s8-sub">No beats yet — the Story arrives with the Director plan.</p>}
        {beats.map((beat, index) => <div className="s8-info" key={beat.id}><span className="s8-info-label">{String(index + 1).padStart(2, '0')} · {beat.name}</span><span className="s8-info-value">{beat.content || beat.story_function || '—'}</span></div>)}
      </DrawerSection>
      <DrawerSection title="Story controls" index="02">
        <button type="button" className="s8-item" onClick={() => onOpenTool('Script')}><span>Open Script</span><small>Write</small></button>
        <button type="button" className="s8-item" onClick={() => onOpenTool('Scenes')}><span>Open Scenes</span><small>{scenes.length}</small></button>
      </DrawerSection>
    </>}
    {view === 'script' && <>
      <DrawerSection title="Document" index="01">
        {scenes.length === 0 && <p className="s8-sub">No script Scenes yet.</p>}
        {scenes.map(scene => <button type="button" key={scene.id} className={`s8-item${scene.id === selectedSceneId ? ' active' : ''}`} aria-pressed={scene.id === selectedSceneId} onClick={() => onSelectScene(scene.id)}><span>Scene {scene.order} · {scene.title}</span><small>{scene.dialogue_lines} lines</small></button>)}
      </DrawerSection>
      <DrawerSection title="Director passes" index="02">
        <button type="button" className="s8-item" onClick={() => onOpenTool('Continuity')}><span>Continuity pass</span><small>Check</small></button>
      </DrawerSection>
    </>}
    {view === 'scenes' && <>
      <DrawerSection title="Scene list" index="01">
        {scenes.length === 0 && <p className="s8-sub">No Scenes yet. Ask TONDE to break the Story into Scenes, or add one on the canvas.</p>}
        {scenes.map(scene => <button type="button" key={scene.id} className={`s8-item${scene.id === selectedSceneId ? ' active' : ''}`} aria-pressed={scene.id === selectedSceneId} onClick={() => onSelectScene(scene.id)}><span>Scene {scene.order} · {scene.title}</span><small>{approvalLabel(scene.approval)}</small></button>)}
      </DrawerSection>
      <DrawerSection title="Scene layers" index="02">
        <button type="button" className="s8-item" onClick={() => onOpenTool('Shots')}><span>Shots in selected Scene</span><small>{scenes.find(scene => scene.id === selectedSceneId)?.shots.length ?? 0}</small></button>
        <button type="button" className="s8-item" onClick={() => onOpenTool('Audio')}><span>Music + sound</span><small>Plan</small></button>
      </DrawerSection>
    </>}
    {view === 'shots' && <>
      <DrawerSection title="Shot list" index="01">
        {shots.length === 0 && <p className="s8-sub">No Shots yet. Break a Scene into coverage on the canvas.</p>}
        {shots.map(({ scene, shot }) => <button type="button" key={shot.id} className={`s8-item${shot.id === selectedShotId ? ' active' : ''}`} aria-pressed={shot.id === selectedShotId} onClick={() => onSelectShot(scene.id, shot.id)}><span>S{scene.order} · {shot.title}</span><small>{shot.execution_method.toUpperCase()}</small></button>)}
      </DrawerSection>
      <DrawerSection title="Coverage" index="02">
        <button type="button" className="s8-item" onClick={() => onOpenTool('Real Production')}><span>Real coverage</span><small>{shots.filter(({ shot }) => shot.execution_method !== 'ai').length}</small></button>
        <button type="button" className="s8-item" onClick={() => onOpenTool('AI Creation')}><span>AI coverage</span><small>{shots.filter(({ shot }) => shot.execution_method !== 'real').length}</small></button>
      </DrawerSection>
    </>}
    {view === 'produce' && <>
      <DrawerSection title="Execution mix" index="01">
        <DrawerInfo label="Real" value={`${shots.filter(({ shot }) => shot.execution_method === 'real').length} Shots`} />
        <DrawerInfo label="AI Creation" value={`${shots.filter(({ shot }) => shot.execution_method === 'ai').length} Shots`} />
        <DrawerInfo label="Hybrid" value={`${shots.filter(({ shot }) => shot.execution_method === 'hybrid').length} Shots`} />
      </DrawerSection>
      <DrawerSection title="Production Kit" index="02">
        <button type="button" className="s8-item" onClick={() => onOpenTool('Real Production')}><span>Camera + light plan</span><small>Real</small></button>
        <button type="button" className="s8-item" onClick={() => onOpenTool('AI Creation')}><span>Prompt playbook</span><small>AI</small></button>
        <Link className="s8-item" to="/setup"><span>Open Production Kit</span><small>Gear</small></Link>
        <Link className="s8-item" to={`/on-set/${model.production.id}`}><span>On-Set Mode</span><small>Shoot</small></Link>
      </DrawerSection>
    </>}
    {view === 'edit' && <>
      <DrawerSection title="Sequence" index="01">
        {scenes.length === 0 && <p className="s8-sub">No Scenes in the sequence yet.</p>}
        {scenes.map(scene => <button type="button" key={scene.id} className={`s8-item${scene.id === selectedSceneId ? ' active' : ''}`} aria-pressed={scene.id === selectedSceneId} onClick={() => onSelectScene(scene.id)}><span>Scene {scene.order} · {scene.title}</span><small>{formatMs(scene.duration_ms)}</small></button>)}
      </DrawerSection>
      <DrawerSection title="Delivery" index="02">
        <button type="button" className="s8-item" onClick={() => onOpenTool('Exports')}><span>Export package</span><small>Pinned</small></button>
      </DrawerSection>
    </>}
    {view === 'results' && <>
      <DrawerSection title="Results" index="01">
        {shots.filter(({ shot }) => shot.result_count > 0).length === 0 && <p className="s8-sub">No Results uploaded yet. Shoot or generate a Shot, then return here to compare.</p>}
        {shots.filter(({ shot }) => shot.result_count > 0).map(({ scene, shot }) => <button type="button" key={shot.id} className={`s8-item${shot.id === selectedShotId ? ' active' : ''}`} aria-pressed={shot.id === selectedShotId} onClick={() => onSelectShot(scene.id, shot.id)}><span>{shot.title}</span><small>{shot.result_count} Result{shot.result_count === 1 ? '' : 's'}</small></button>)}
      </DrawerSection>
      <DrawerSection title="Review" index="02">
        <button type="button" className="s8-item" onClick={() => onOpenTool('Readiness')}><span>Readiness</span><small>Blockers</small></button>
      </DrawerSection>
    </>}
    <div className="s8-section"><div className="s8-section-title"><span>All studio tools</span></div>
      {allTools.map(item => <button type="button" key={item.name} className={`s8-item${item.name === activeTool ? ' active' : ''}`} aria-pressed={item.name === activeTool} onClick={() => onOpenTool(item.name)}><span>{item.name}</span></button>)}
    </div>
  </aside>;
}

function DrawerSection({ title, index, children }: { title: string; index: string; children: ReactNode }) {
  return <div className="s8-section"><div className="s8-section-title"><span>{title}</span><span>{index}</span></div>{children}</div>;
}

function DrawerInfo({ label, value }: { label: string; value: string }) {
  return <div className="s8-info"><span className="s8-info-label">{label}</span><span className="s8-info-value">{value}</span></div>;
}

const joinList = (items: Array<string | { statement: string }>) =>
  items.map(item => typeof item === 'string' ? item : item.statement).join('; ');

export function IdeaLabCanvas({ workspaceId, productionId, surface, onOpenTool, refresh }: {
  workspaceId: string; productionId: string; surface: DirectorStudio; onOpenTool: (tool: string) => void; refresh: () => void;
}) {
  const brief = surface.brief;
  const references = surface.references;
  const [alternatives, setAlternatives] = useState<DirectorStory[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const loadAlternatives = async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await productionService.directorStoryAlternatives(workspaceId, productionId, 3);
      setAlternatives(result.alternatives); setNotice(result.note);
    } catch (failure) { setError(safeError(failure).message); }
    finally { setBusy(false); }
  };
  const useDirection = async (variation: string) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await productionService.directorCommand(workspaceId, productionId, {
        text: `Regenerate the story as the ${variation} variation`, apply: true,
        expected_production_revision: surface.production.revision,
      });
      setNotice(result.applied ? `Applied: ${joinList(result.changes)}` : result.answer ?? 'Direction applied.');
      refresh();
    } catch (failure) { setError(safeError(failure).message); }
    finally { setBusy(false); }
  };
  if (!brief) return <PartialState title="No Brief yet">This Production has no Intelligent Brief until the Director plans it. Open Home, describe the Production and BUILD PRODUCTION.</PartialState>;
  return <div className="s8-idea">
    <header className="s8-canvas-head"><div><p className="eyebrow">IDEA LAB · SEARCH + DIRECTION</p>
      <h1>{brief.production_goal || surface.production.title}</h1>
      <p>Pressure-test the idea before committing the Production to a full plan. Nothing here invents capability: directions come from the Director contract.</p></div>
      <span className="s8-chip">IDEA</span></header>
    <div className="s8-idea-grid">
      <div>
        <div className="s8-meta">CORE IDEA</div>
        <div className="s8-card"><h3>{brief.creative_concept || brief.production_goal}</h3><p>{brief.story_approach || 'No story approach recorded yet.'}</p></div>
        <div className="s8-idea-facts">
          <DrawerInfo label="Audience" value={brief.audience || 'Not specified'} />
          <DrawerInfo label="Format" value={[brief.format, brief.platform].filter(Boolean).join(' · ') || 'Not specified'} />
          <DrawerInfo label="Tone" value={brief.tone.join(', ') || 'Not specified'} />
          <DrawerInfo label="Runtime" value={formatRuntime(brief.runtime.exact_ms ?? brief.runtime.min_ms)} />
          <DrawerInfo label="Constraints" value={brief.hard_constraints.join('; ') || 'None recorded'} />
          <DrawerInfo label="Resources" value={brief.resources.join('; ') || 'None recorded'} />
        </div>
        <div className="s8-meta">DIRECTION OPTIONS</div>
        <div className="s8-actions"><button type="button" disabled={busy} onClick={() => void loadAlternatives()}>{busy ? 'Working…' : 'Explore directions with TONDE'}</button>
          <button type="button" onClick={() => onOpenTool('Story')}>Continue into Story →</button></div>
        {error && <p role="alert" className="error-text">{error}</p>}
        {notice && <p role="status" className="subtle">{notice}</p>}
        {alternatives.length > 0 && <div className="s8-directions">{alternatives.map(alternative => <article className="s8-direction" key={alternative.variation}>
          <span className="s8-meta">{alternative.variation.replaceAll('_', ' ')}</span>
          <b>{alternative.title}</b><p>{alternative.logline}</p>
          <button type="button" disabled={busy} onClick={() => void useDirection(alternative.variation)}>Use this direction <ArrowUpRight size={14} /></button>
        </article>)}</div>}
      </div>
      <div>
        <div className="s8-meta">REFERENCES / INSPIRATION</div>
        <div className="s8-refs">
          {references.length === 0 && <p className="s8-sub">No References shape this Production yet. Add them from Home intake or the References tool.</p>}
          {references.map(reference => <div className="s8-ref" key={reference.reference_id}>
            <b>{reference.source_identity || reference.source_description || 'Reference'}</b>
            <small>{reference.source_provider || reference.source_type} · {reference.shaping_ready ? 'shaping this Production' : 'not shaping — identity or purpose incomplete'} · {reference.rights_classification.replaceAll('_', ' ')}</small>
          </div>)}
        </div>
        <button type="button" className="s8-item" onClick={() => onOpenTool('References')}><span>Open References</span><small>{references.length}</small></button>
      </div>
    </div>
  </div>;
}

export function HybridBoard({ scenes, busy, onSetExecution, onSelectShot }: {
  scenes: StudioScene[]; busy: boolean;
  onSetExecution: (shot: StudioShot, method: StudioShot['execution_method']) => void;
  onSelectShot: (sceneId: string, shotId: string) => void;
}) {
  const shots = scenes.flatMap(scene => scene.shots.map(shot => ({ scene, shot })));
  const count = (method: string) => shots.filter(({ shot }) => shot.execution_method === method).length;
  return <div className="s8-hybrid">
    <header className="s8-canvas-head"><div><p className="eyebrow">HYBRID · PER-SHOT STRATEGY</p>
      <h1>Real and AI stay on the same Shots.</h1>
      <p>Hybrid is a per-Shot assignment, not a separate Production. {count('real')} Real · {count('ai')} AI · {count('hybrid')} Hybrid.</p></div>
      <span className="s8-chip">HYBRID</span></header>
    {shots.length === 0 ? <PartialState title="No Shots to assign">Break a Scene into Shots first. Execution strategy attaches to Shots, never to a parallel Production.</PartialState> :
      <ul className="s8-hybrid-list">{shots.map(({ scene, shot }) => <li key={shot.id}>
        <button type="button" className="s8-hybrid-shot" onClick={() => onSelectShot(scene.id, shot.id)}>
          <strong>Scene {scene.order} · {shot.title}</strong>
          <small>{formatMs(shot.planned_duration_ms ?? 0)} · {approvalLabel(shot.approval)}{shot.locked_at ? ' · locked' : ''}</small>
        </button>
        <label>Execution<select aria-label={`Execution for ${shot.title}`} value={shot.execution_method} disabled={busy || !!shot.locked_at}
          onChange={event => onSetExecution(shot, event.target.value as StudioShot['execution_method'])}>
          <option value="real">SHOOT (Real)</option><option value="ai">AI PLAYBOOK</option><option value="hybrid">SHOOT + AI</option>
        </select></label>
      </li>)}</ul>}
  </div>;
}

export function StudioInspector({ workspaceId, productionId, surface, model, scope, face, refresh }: {
  workspaceId: string; productionId: string; surface: DirectorStudio | null; model: StudioReadModel;
  scope: { scene: StudioScene | null; shot: StudioShot | null }; face: string; refresh: () => void;
}) {
  const [tab, setTab] = useState<'director' | 'inspect' | 'continuity'>('director');
  return <aside className="s8-inspector" aria-label="TONDE Director">
    <div className="s8-tabs" role="tablist" aria-label="Director panels">
      {(['director', 'inspect', 'continuity'] as const).map(value => <button key={value} type="button" role="tab"
        aria-selected={tab === value} className={tab === value ? 'active' : ''}
        onClick={() => setTab(value)}>{value === 'director' ? 'Director' : value === 'inspect' ? 'Inspect' : 'Continuity'}</button>)}
    </div>
    <div className="s8-scroll">
      {tab === 'director' && <DirectorPanel workspaceId={workspaceId} productionId={productionId} surface={surface} refresh={refresh} face={face} scope={scope} />}
      {tab === 'inspect' && <InspectPanel model={model} scope={scope} />}
      {tab === 'continuity' && <ContinuityPanel workspaceId={workspaceId} productionId={productionId} scope={scope} />}
    </div>
  </aside>;
}

function InspectPanel({ model, scope }: { model: StudioReadModel; scope: { scene: StudioScene | null; shot: StudioShot | null } }) {
  const { scene, shot } = scope;
  const row = (label: string, value: string) => <div className="s8-info"><span className="s8-info-label">{label}</span><span className="s8-info-value">{value}</span></div>;
  if (shot) {
    const owning = model.scenes.find(item => item.id === shot.scene_id);
    return <div aria-label="Shot inspector">
      <p className="eyebrow">INSPECT · SHOT</p><h3>{shot.title}</h3>
      {row('Scene', owning ? `Scene ${owning.order} · ${owning.title}` : 'Unassigned photo concept')}
      {row('Description', shot.description || 'unset')}
      {row('Purpose', shot.purpose || 'unset')}{row('Duration', formatMs(shot.planned_duration_ms ?? 0))}
      {row('Framing', shot.framing || 'unset')}{row('Angle', shot.angle || 'unset')}
      {row('Movement', shot.movement || 'unset')}{row('Composition', shot.composition || 'unset')}
      {row('Performance', shot.action || shot.creative_notes || 'unset')}
      {row('Execution', shot.execution_method === 'real' ? 'SHOOT (Real)' : shot.execution_method === 'ai' ? 'AI PLAYBOOK' : 'SHOOT + AI')}
      {row('Approval', approvalLabel(shot.approval))}{row('Results', shot.result_count === 0 ? 'none yet' : `${shot.result_count} uploaded`)}
    </div>;
  }
  if (scene) {
    return <div aria-label="Scene inspector">
      <p className="eyebrow">INSPECT · SCENE {scene.order}</p><h3>{scene.title}</h3>
      {row('Purpose', scene.purpose || 'unset')}{row('Story beat', scene.story_beat || 'unset')}
      {row('Opening state', scene.opening_state || 'unset')}{row('Ending state', scene.ending_state || 'unset')}
      {row('Environment', scene.environment_asset_id ? 'bound to an Asset' : 'unset')}
      {row('Duration', `${formatMs(scene.duration_ms)}${scene.timing === 'derived' ? '' : ' · timing incomplete'}`)}
      {row('Shots', `${scene.shots.length}`)}{row('Dialogue lines', `${scene.dialogue_lines}`)}
      {row('Approval', approvalLabel(scene.approval))}
    </div>;
  }
  const status = model.status_summary;
  return <div aria-label="Production inspector">
    <p className="eyebrow">INSPECT · PRODUCTION</p><h3>{model.production.title}</h3>
    {row('Type', model.production.production_type.replaceAll('_', ' '))}
    {row('Runtime', `${formatMs(model.timing.total_ms)}${model.timing.target_ms ? ` of ${formatMs(model.timing.target_ms)}` : ''} · ${model.timing.status}`)}
    {row('Scenes', `${status.scenes}`)}{row('Shots', `${status.shots}`)}
    {row('Needs attention', `${status.needs_attention}`)}{row('Approval', approvalLabel(status.production_approval))}
  </div>;
}

function ContinuityPanel({ workspaceId, productionId, scope }: {
  workspaceId: string; productionId: string; scope: { scene: StudioScene | null; shot: StudioShot | null };
}) {
  const [findings, setFindings] = useState<ContinuityFinding[] | null>(null);
  const [openCount, setOpenCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = async () => {
    setBusy(true); setError(null);
    try {
      const [summary, list] = await Promise.all([
        productionContinuityService.summary(workspaceId, productionId),
        productionContinuityService.findings(workspaceId, productionId, { state: 'open' }),
      ]);
      setOpenCount(summary.findings.open);
      const { scene, shot } = scope;
      setFindings(list.items.filter(item => {
        if (shot && item.shot_id) return item.shot_id === shot.id;
        if (scene && item.scene_id) return item.scene_id === scene.id;
        return !shot && !scene;
      }).slice(0, 12));
    } catch (failure) { setError(safeError(failure).message); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, [workspaceId, productionId, scope.scene?.id, scope.shot?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const runCheck = async () => {
    setBusy(true); setError(null); setNote(null);
    try {
      const result = await productionContinuityService.check(workspaceId, productionId, 'Run from Studio inspector.');
      setNote(`${result.verdict.replaceAll('_', ' ')}: ${result.finding_count} finding(s) across ${result.state_count} state(s).`);
      await load();
    } catch (failure) { setError(safeError(failure).message); }
    finally { setBusy(false); }
  };
  const label = scope.shot ? `Shot “${scope.shot.title}”` : scope.scene ? `Scene “${scope.scene.title}”` : 'whole Production';
  return <div aria-label="Continuity">
    <p className="eyebrow">CONTINUITY · {label}</p>
    {busy && findings === null ? <LoadingState label="Loading continuity…" /> : error ? <ErrorState message={error} retry={() => void load()} /> :
      findings && (findings.length === 0
        ? <p className="subtle">No open continuity findings for {label}{openCount ? ` (${openCount} open elsewhere in the Production).` : '.'} Only recorded state produces warnings — nothing is invented here.</p>
        : <ul className="s8-findings">{findings.map(item => <li key={item.finding_id} className={item.severity === 'info' ? '' : 'warn'}>
          <strong>{item.severity.toUpperCase()} · {(item.domain_label ?? item.domain).replaceAll('_', ' ')}</strong>
          <p>{item.explanation}</p>{item.suggested_resolution && <p className="subtle">Fix: {item.suggested_resolution}</p>}
        </li>)}</ul>)}
    {note && <p role="status" className="subtle">{note}</p>}
    <div className="s8-actions"><button type="button" disabled={busy} onClick={() => void runCheck()}>{busy ? 'Checking…' : 'Run continuity check'}</button></div>
  </div>;
}

export function DirectorPanel({ workspaceId, productionId, surface, refresh, face, scope }: {
  workspaceId: string; productionId: string; surface: DirectorStudio | null;
  refresh: () => void; face: string; scope: { scene: StudioScene | null; shot: StudioShot | null };
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<DirectorCommandPreview | null>(null);
  const [result, setResult] = useState<DirectorCommandResult | null>(null);
  const examples = scope.shot
    ? ['Make this Shot more tense.', 'Can I shoot this with one operator?', 'Add a reaction Shot after this.', 'What settings should I use on my phone at night?']
    : scope.scene
      ? ['Make this Scene shorter.', 'How can I make this ending stronger?', 'Move the Product reveal earlier.']
      : ['Give me three alternative endings.', 'What is missing from this Production?', 'Why doesn\'t this feel like the plan?'];
  const run = async (apply: boolean, direction: string) => {
    if (!direction.trim()) return;
    setBusy(true); setError(null); setPreview(null);
    try {
      const payload = await productionService.directorCommand(workspaceId, productionId, {
        text: direction.trim(), apply, expected_production_revision: surface?.production.revision,
      });
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
  return <div aria-label="TONDE Director">
    <div className="s8-director-head"><span className="s8-director-mark">T</span>
      <div><h3>TONDE Director</h3>
        <p>{surface ? (surface.provider.configured ? 'Model-assisted production intelligence' : 'Deterministic production intelligence · no provider configured') : 'Connecting to production intelligence'}</p></div>
    </div>
    <p className="s8-scope" role="status">
      Scope: {scope.shot ? `Shot “${scope.shot.title}”` : scope.scene ? `Scene “${scope.scene.title}”` : 'whole Production'}
      {scope.shot && scope.scene ? ` in Scene ${scope.scene.order}` : ''} · {face.toUpperCase()} face.
      Only this scope is sent with your direction. Switching faces never changes the Production, Scene or Shot.
    </p>
    <label htmlFor="director-message">Message to the Director</label>
    <textarea id="director-message" value={text} onChange={event => setText(event.target.value)}
      placeholder={scope.shot ? '“Make this Shot more tense.”' : '“Make Scene 1 more intense.”'} rows={4} />
    <div className="s8-examples" role="group" aria-label="Example directions">
      {examples.map(example => <button type="button" key={example} disabled={busy} onClick={() => setText(example)}>{example}</button>)}
    </div>
    <div className="s8-actions">
      <button type="button" disabled={busy || !text.trim()} onClick={() => void showPreview()}>Preview change</button>
      <button type="button" className="s8-primary" disabled={busy || !text.trim()} onClick={() => void run(false, text)}>
        Ask the Director <ArrowUpRight size={14} /></button>
    </div>
    {preview && <div className="command-preview" role="status">
      <p className="eyebrow">{preview.kind.replaceAll('_', ' ')} · {preview.scope} · confidence {preview.confidence}</p>
      <p>{preview.rationale}</p>
      <p className="subtle">Operations: {preview.operations.join(', ') || 'none'}
        {preview.scene_order ? ` · Scene ${preview.scene_order}` : ''}
        {preview.target_runtime_ms ? ` · ${formatMs(preview.target_runtime_ms)}` : ''}</p>
    </div>}
    {error && <p role="alert" className="error-text">{error}</p>}
    {result && <><DirectorCommandResultPanel result={result} />
      {!result.applied && result.plan && <button type="button" className="s8-primary" disabled={busy} onClick={() => void run(true, text)}>
        <Send size={14} />Apply to this Production</button>}
      {result.changes.length > 0 && <p className="subtle">Affected: {result.changes.join('; ')}</p>}
    </>}
    {result && <button type="button" className="text-link" onClick={() => { setResult(null); setPreview(null); setText(''); }}>Clear Director answer</button>}
  </div>;
}

export function viewForTool(tool: string): StudioView {
  if (tool === 'Story') return 'story';
  if (tool === 'Script') return 'script';
  if (tool === 'Scenes') return 'scenes';
  if (tool === 'Shots') return 'shots';
  if (tool === 'Real Production' || tool === 'AI Creation' || tool === 'Hybrid') return 'produce';
  if (tool === 'Audio' || tool === 'Edit') return 'edit';
  if (tool === 'Results') return 'results';
  return 'idea';
}
