import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { StudioScene, StudioShot } from '../services/productions';
import { productionVersioningService } from '../services/productionVersioning';
import { safeError } from '../services/errors';
import { formatMs } from './StudioTimeline';
import { approvalLabel } from './StudioTimeline';
import { cardExecution, cardReadiness, nextActionForScene, orderedShots, shotDisplayId } from './cards';

/**
 * Card-first Studio shell. Cards are canonical Scenes rendered as the primary
 * navigation; every mutation routes through the existing revision-checked
 * Studio actions owned by StudioPage. Nothing here invents production state.
 */

/** Real undo/redo: restore an older production version as a NEW revision. Nothing is rewound. */
export function useProductionUndo(workspaceId: string, productionId: string, currentRevision: number, refresh: () => void) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const redoStack = useRef<number[]>([]);
  const undo = async () => {
    setBusy(true); setNote(null);
    try {
      const history = await productionVersioningService.versions(workspaceId, productionId, productionId, { limit: 50 });
      const target = history.items.find(entry => entry.revision < currentRevision);
      if (!target) { setNote('Nothing to undo — no earlier Production revision exists.'); return; }
      redoStack.current.push(currentRevision);
      const result = await productionVersioningService.restore(workspaceId, productionId, target.version_id, `Undo to revision ${target.revision} from Studio.`);
      setNote(`Undone — revision ${result.restored_from_revision} restored as new revision ${result.new_revision}.`);
      refresh();
    } catch (failure) { setNote(safeError(failure).message); }
    finally { setBusy(false); }
  };
  const redo = async () => {
    const wanted = redoStack.current.pop();
    if (wanted === undefined) { setNote('Nothing to redo.'); return; }
    setBusy(true); setNote(null);
    try {
      const history = await productionVersioningService.versions(workspaceId, productionId, productionId, { limit: 50 });
      const target = history.items.find(entry => entry.revision === wanted);
      if (!target) { setNote('The redone state is no longer in history.'); return; }
      const result = await productionVersioningService.restore(workspaceId, productionId, target.version_id, `Redo to revision ${target.revision} from Studio.`);
      setNote(`Redone — revision ${result.restored_from_revision} restored as new revision ${result.new_revision}.`);
      refresh();
    } catch (failure) { setNote(safeError(failure).message); }
    finally { setBusy(false); }
  };
  return { undo, redo, busy, note, clearNote: () => setNote(null) };
}

export function CardTopBar({ productionTitle, typeBadge, titleEditor, saveState, reviewCount, mode, onMode, undoNote, undoBusy, onUndo, onRedo, onOpenDetails, onExport }: {
  productionTitle: string; typeBadge: string; titleEditor: ReactNode; saveState: string; reviewCount: number;
  mode: 'real' | 'ai' | 'hybrid'; onMode: (mode: 'real' | 'ai' | 'hybrid') => void;
  undoNote: string | null; undoBusy: boolean; onUndo: () => void; onRedo: () => void;
  onOpenDetails: () => void; onExport: () => void;
}) {
  return <header className="cs-topbar">
    <Link className="cs-brand" to="/projects" aria-label="Back to Projects"><span className="cs-brandmark" aria-hidden="true">T</span></Link>
    <div className="cs-identity">
      <span className="cs-badge">{typeBadge}</span>
      {titleEditor}
      <span className="cs-saved" role="status">{saveState}</span>
      {reviewCount > 0 && <span className="cs-badge warn">{reviewCount} review item{reviewCount === 1 ? '' : 's'}</span>}
    </div>
    <span className="sr-only">{productionTitle}</span>
    <button type="button" className="cs-icon" onClick={onUndo} disabled={undoBusy} aria-label="Undo">↶</button>
    <button type="button" className="cs-icon" onClick={onRedo} disabled={undoBusy} aria-label="Redo">↷</button>
    <div className="cs-mode" role="group" aria-label="Execution mode">
      {(['real', 'ai', 'hybrid'] as const).map(value => <button key={value} type="button"
        aria-pressed={mode === value} className={mode === value ? 'active' : ''} onClick={() => onMode(value)}>
        {value.toUpperCase()}</button>)}
    </div>
    <button type="button" className="cs-btn" onClick={onOpenDetails}>Production Details</button>
    <button type="button" className="cs-primary" onClick={onExport}>DOWNLOAD</button>
    {undoNote && <p className="cs-undo-note" role="status">{undoNote}</p>}
  </header>;
}

function ReadinessDot({ readiness }: { readiness: ReturnType<typeof cardReadiness> }) {
  const dot = readiness === 'NEEDS YOU' ? 'warn' : readiness === 'RESULT READY' ? 'blue' : readiness === 'DRAFT' ? 'draft' : '';
  return <span className="cs-readiness"><span className={`cs-dot ${dot}`} aria-hidden="true" />{readiness}</span>;
}

export function HeroCard({ scene, index, active, selectedShotId, onFocus, onSelectShot, onPrimary, menu }: {
  scene: StudioScene; index: number; active: boolean; selectedShotId: string | null;
  onFocus: () => void; onSelectShot: (shotId: string) => void;
  onPrimary: (scene: StudioScene) => void; menu: ReactNode;
}) {
  const readiness = cardReadiness(scene);
  const execution = cardExecution(scene);
  const action = nextActionForScene(scene);
  const results = scene.shots.reduce((total, shot) => total + shot.result_count, 0);
  const shots = orderedShots(scene);
  return <article className={`cs-hero${active ? ' active' : ''}`} data-scene={scene.id}
    aria-label={`Card ${scene.order}: ${scene.title}`} onClick={onFocus}>
    <div className={`cs-visual cs-v${(scene.order % 6) + 1}`} aria-hidden="true">
      <span className="cs-scene-number">CARD {String(scene.order).padStart(2, '0')}</span>
      <span className="cs-exec">{execution}</span>
      <span className="cs-visual-tag"><span className="cs-tiny-dot" aria-hidden="true" />
        {results > 0 ? `${results} RESULT${results === 1 ? '' : 'S'} ATTACHED` : 'NO VISUAL YET'}</span>
    </div>
    <div className="cs-content">
      <div className="cs-story">
        <p className="eyebrow">CARD {String(scene.order).padStart(2, '0')}</p>
        <h3>{scene.title}</h3>
        <p className="cs-summary">{scene.purpose || scene.description || 'This moment still needs direction.'}</p>
        <p className="cs-label">WHAT HAPPENS</p>
        <p className="cs-copy">{scene.description || 'Tell TONDE what should happen here, or ask TONDE to develop the moment.'}</p>
        <p className="cs-label">SHOTS · {shots.length}</p>
        <p className="cs-copy">{shots.length === 0
          ? 'No coverage planned yet.'
          : shots.map(item => item.displayId).join(' · ')}</p>
      </div>
      <div className="cs-direction">
        <p className="cs-label">TONDE DIRECTION</p>
        <div className="cs-note">
          <strong>{scene.locked_at ? 'Locked card' : 'Director note'}</strong>
          <p>{scene.locked_at
            ? 'This card is locked against incidental edits. Unlock it to change anything.'
            : scene.visual_intent || scene.story_beat || 'Ask TONDE what this moment needs.'}</p>
        </div>
        <div className="cs-next">
          <p className="eyebrow">NEXT ACTION</p>
          <p className="cs-next-title">{action.detail}</p>
          <button type="button" className="cs-primary" onClick={event => { event.stopPropagation(); onPrimary(scene); }}>
            {action.label} →</button>
        </div>
        <div className="cs-foot">
          <ReadinessDot readiness={readiness} />
          <span className="cs-approval">{approvalLabel(scene.approval)}</span>
          <span onClick={event => event.stopPropagation()}>{menu}</span>
        </div>
      </div>
    </div>
  </article>;
}

export function HeroCarousel({ scenes, activeId, selectedShotId, onFocusScene, onSelectShot, onPrimary, renderMenu }: {
  scenes: StudioScene[]; activeId: string | null; selectedShotId: string | null;
  onFocusScene: (sceneId: string) => void; onSelectShot: (sceneId: string, shotId: string) => void;
  onPrimary: (scene: StudioScene) => void; renderMenu: (scene: StudioScene) => ReactNode;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const programmatic = useRef(0);
  const activeIndex = Math.max(0, scenes.findIndex(scene => scene.id === activeId));
  useEffect(() => {
    const track = trackRef.current;
    const el = track?.querySelector<HTMLElement>(`[data-scene="${scenes[activeIndex]?.id}"]`);
    if (track && el) {
      programmatic.current = Date.now();
      el.scrollIntoView?.({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [activeId, scenes]);
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let timer = 0;
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (Date.now() - programmatic.current < 600) return;
        const center = track.getBoundingClientRect().left + track.clientWidth / 2;
        let best: string | null = null;
        let bestDist = Infinity;
        track.querySelectorAll<HTMLElement>('[data-scene]').forEach(el => {
          const rect = el.getBoundingClientRect();
          const dist = Math.abs(rect.left + rect.width / 2 - center);
          if (dist < bestDist) { bestDist = dist; best = el.dataset.scene ?? null; }
        });
        if (best && best !== scenes[activeIndex]?.id) onFocusScene(best);
      }, 120);
    };
    track.addEventListener('scroll', onScroll, { passive: true });
    return () => { track.removeEventListener('scroll', onScroll); window.clearTimeout(timer); };
  }, [activeIndex, onFocusScene, scenes]);
  const go = (delta: -1 | 1) => {
    const next = scenes[Math.min(Math.max(activeIndex + delta, 0), scenes.length - 1)];
    if (next && next.id !== scenes[activeIndex]?.id) onFocusScene(next.id);
  };
  return <div className="cs-carousel-shell">
    <button type="button" className="cs-nav" aria-label="Previous card" onClick={() => go(-1)}>←</button>
    <div className="cs-carousel" ref={trackRef} role="region" aria-roledescription="carousel" aria-label="Production cards"
      onKeyDown={event => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        const target = event.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
        event.preventDefault();
        go(event.key === 'ArrowRight' ? 1 : -1);
      }}>
      {scenes.map((scene, index) => <HeroCard key={scene.id} scene={scene} index={index}
        active={scene.id === scenes[activeIndex]?.id} selectedShotId={selectedShotId}
        onFocus={() => { if (scene.id !== scenes[activeIndex]?.id) onFocusScene(scene.id); }}
        onSelectShot={shotId => onSelectShot(scene.id, shotId)}
        onPrimary={onPrimary} menu={renderMenu(scene)} />)}
    </div>
    <button type="button" className="cs-nav" aria-label="Next card" onClick={() => go(1)}>→</button>
  </div>;
}

export function ShotStrip({ scene, selectedShotId, onSelectShot, onAddShot, busy }: {
  scene: StudioScene | null; selectedShotId: string | null;
  onSelectShot: (sceneId: string, shotId: string) => void; onAddShot: () => void; busy: boolean;
}) {
  const shots = scene ? orderedShots(scene) : [];
  return <div className="cs-strip">
    <div className="cs-strip-label">
      <strong>{scene ? `Card ${String(scene.order).padStart(2, '0')} Shots` : 'Shots'}</strong>
      <small>Click a Shot to make it TONDE's focus.</small>
    </div>
    <div className="cs-shot-scroll" role="listbox" aria-label={scene ? `Shots of Card ${scene.order}` : 'Shots'}>
      {shots.map(({ shot, displayId }) => <button key={shot.id} type="button" role="option"
        aria-selected={shot.id === selectedShotId}
        className={`cs-shot${shot.id === selectedShotId ? ' active' : ''}${shot.result_count > 0 ? ' result' : ''}`}
        onClick={() => scene && onSelectShot(scene.id, shot.id)}>
        <span className="cs-shot-thumb" aria-hidden="true" />
        <strong>{displayId} · {shot.title}</strong>
        <small>{shot.planned_duration_ms != null ? formatMs(shot.planned_duration_ms) : 'untimed'}</small>
        <span className="cs-shot-status">{shot.result_count > 0 ? `${shot.result_count} RESULT${shot.result_count === 1 ? '' : 'S'}` : approvalLabel(shot.approval)}</span>
      </button>)}
      {scene && <button type="button" className="cs-shot-add" disabled={busy} onClick={onAddShot}>＋ Shot</button>}
    </div>
  </div>;
}

export function FilmStrip({ scenes, activeId, onFocusScene, onInsert, onDrop, busy }: {
  scenes: StudioScene[]; activeId: string | null;
  onFocusScene: (sceneId: string) => void; onInsert: (index: number) => void;
  onDrop: (draggedId: string, targetId: string) => void; busy: boolean;
}) {
  const dragId = useRef<string | null>(null);
  return <div className="cs-strip">
    <div className="cs-strip-label">
      <strong>Production</strong>
      <small>Drag cards to reorder. ＋ inserts between.</small>
    </div>
    <div className="cs-prod-scroll">
      {scenes.map((scene, index) => <span key={scene.id} className="cs-mini-wrap">
        <button type="button" draggable
          className={`cs-mini${scene.id === activeId ? ' active' : ''}`}
          aria-pressed={scene.id === activeId}
          aria-label={`Card ${scene.order}: ${scene.title}`}
          onClick={() => onFocusScene(scene.id)}
          onDragStart={event => { dragId.current = scene.id; event.dataTransfer.effectAllowed = 'move'; }}
          onDragOver={event => event.preventDefault()}
          onDrop={event => {
            event.preventDefault();
            if (dragId.current && dragId.current !== scene.id) onDrop(dragId.current, scene.id);
            dragId.current = null;
          }}>
          <strong>{String(scene.order).padStart(2, '0')} · {scene.title}</strong>
          <small>{scene.duration_ms ? formatMs(scene.duration_ms) : 'untimed'} · {cardReadiness(scene)}</small>
        </button>
        {index < scenes.length - 1 && <button type="button" className="cs-insert" disabled={busy}
          aria-label={`Insert a card after Card ${scene.order}`} title="Insert a card here"
          onClick={() => onInsert(index + 1)}>＋</button>}
      </span>)}
    </div>
  </div>;
}

export function CardMenu({ scene, busy, onRename, onApprove, onToggleLock, onArchive, onMove, onHowTo, onDownload }: {
  scene: StudioScene; busy: boolean;
  onRename: (scene: StudioScene, title: string) => void;
  onApprove: (scene: StudioScene) => void;
  onToggleLock: (scene: StudioScene) => void;
  onArchive: (scene: StudioScene) => void;
  onMove: (scene: StudioScene, direction: -1 | 1) => void;
  onHowTo: (scene: StudioScene) => void;
  onDownload?: (scene: StudioScene) => void;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(scene.title);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  if (!open) return <button type="button" className="cs-btn" aria-label={`Card ${scene.order} options`} onClick={() => setOpen(true)}>•••</button>;
  if (renaming) return <form className="cs-menu" onSubmit={event => {
    event.preventDefault();
    if (title.trim()) onRename(scene, title.trim());
    setRenaming(false); setOpen(false);
  }}>
    <label>Card title<input aria-label={`New title for Card ${scene.order}`} value={title}
      onChange={event => setTitle(event.target.value)} maxLength={160} autoFocus /></label>
    <button type="submit" className="cs-primary" disabled={busy || !title.trim()}>Save</button>
    <button type="button" className="cs-btn" onClick={() => { setRenaming(false); setOpen(false); }}>Cancel</button>
  </form>;
  return <div className="cs-menu" role="menu" aria-label={`Card ${scene.order} options`}>
    <button type="button" disabled={busy} onClick={() => { setTitle(scene.title); setRenaming(true); }}>Rename</button>
    {scene.approval === 'approved'
      ? <button type="button" disabled={busy} onClick={() => { onApprove(scene); setOpen(false); }}>Request changes</button>
      : <button type="button" disabled={busy} onClick={() => { onApprove(scene); setOpen(false); }}>Approve card</button>}
    <button type="button" disabled={busy} onClick={() => { onToggleLock(scene); setOpen(false); }}>
      {scene.locked_at ? 'Unlock card' : 'Lock card'}</button>
    <button type="button" disabled={busy} onClick={() => onMove(scene, -1)}>Move earlier</button>
    <button type="button" disabled={busy} onClick={() => onMove(scene, 1)}>Move later</button>
    <button type="button" disabled={busy} onClick={() => { onHowTo(scene); setOpen(false); }}>How to create this</button>
    {onDownload && <button type="button" disabled={busy} onClick={() => { onDownload(scene); setOpen(false); }}>Download card PDF ↓</button>}
    {confirmingArchive
      ? <><p className="cs-confirm">Archive this card? Its Shots leave the live order but stay readable.</p>
        <button type="button" className="cs-danger" disabled={busy} onClick={() => { onArchive(scene); setOpen(false); setConfirmingArchive(false); }}>Archive card</button>
        <button type="button" disabled={busy} onClick={() => setConfirmingArchive(false)}>Keep it</button></>
      : <button type="button" disabled={busy} onClick={() => setConfirmingArchive(true)}>Archive…</button>}
    <button type="button" onClick={() => { setOpen(false); setConfirmingArchive(false); }}>Close</button>
  </div>;
}

export function ShotMenu({ shot, displayId, busy, onRename, onApprove, onExecute, onDuration, onDownload }: {
  shot: StudioShot; displayId: string; busy: boolean;
  onRename: (shot: StudioShot, title: string) => void; onApprove: (shot: StudioShot) => void;
  onExecute: (shot: StudioShot, method: StudioShot['execution_method']) => void;
  onDuration: (shot: StudioShot, durationMs: number | null) => void;
  onDownload?: (shot: StudioShot) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(shot.title);
  const [renaming, setRenaming] = useState(false);
  const [duration, setDuration] = useState(shot.planned_duration_ms == null ? '' : String(shot.planned_duration_ms));
  if (!open) return <button type="button" className="cs-btn" aria-label={`Shot ${displayId} options`} onClick={() => setOpen(true)}>•••</button>;
  if (renaming) return <form className="cs-menu" onSubmit={event => {
    event.preventDefault();
    if (title.trim()) onRename(shot, title.trim());
    setRenaming(false); setOpen(false);
  }}>
    <label>Shot title<input aria-label={`New title for Shot ${displayId}`} value={title}
      onChange={event => setTitle(event.target.value)} maxLength={160} autoFocus /></label>
    <button type="submit" className="cs-primary" disabled={busy || !title.trim()}>Save</button>
    <button type="button" className="cs-btn" onClick={() => { setRenaming(false); setOpen(false); }}>Cancel</button>
  </form>;
  return <div className="cs-menu" role="menu" aria-label={`Shot ${displayId} options`}>
    <button type="button" disabled={busy} onClick={() => { setTitle(shot.title); setRenaming(true); }}>Rename</button>
    <form onSubmit={event => {
      event.preventDefault();
      onDuration(shot, duration.trim() === '' ? null : Number(duration));
      setOpen(false);
    }}>
      <label>Duration (ms)<input value={duration} onChange={event => setDuration(event.target.value)}
        inputMode="numeric" placeholder="Undecided" disabled={busy} /></label>
      <button type="submit" className="cs-primary" disabled={busy}>Save duration</button>
    </form>
    <label>Execution for {shot.title}
      <select value={shot.execution_method} disabled={busy}
        onChange={event => { onExecute(shot, event.target.value as StudioShot['execution_method']); setOpen(false); }}>
        <option value="real">Real — shoot it</option>
        <option value="ai">AI — directed playbook</option>
        <option value="hybrid">Hybrid — shoot + AI</option>
      </select></label>
    <button type="button" disabled={busy} onClick={() => { onApprove(shot); setOpen(false); }}>Approve shot</button>
    {onDownload && (shot.execution_method === 'ai' || shot.execution_method === 'hybrid') && <button type="button" disabled={busy} onClick={() => { onDownload(shot); setOpen(false); }}>Download prompt card ↓</button>}
    <button type="button" onClick={() => setOpen(false)}>Close</button>
  </div>;
}

export function DetailsDrawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return <>
    <div className="cs-scrim" onClick={onClose} aria-hidden="true" />
    <aside className="cs-drawer" role="dialog" aria-modal="true" aria-label={title}>
      <div className="cs-drawer-head"><h2>{title}</h2><button type="button" className="cs-icon" onClick={onClose} aria-label="Close details">×</button></div>
      <div className="cs-drawer-body">{children}</div>
    </aside>
  </>;
}

export function EmptyCards({ liveJobs, busy, onAsk, onBlank }: {
  liveJobs: number; busy: boolean; onAsk: () => void; onBlank: () => void;
}) {
  return <section className="cs-empty" aria-label="No production cards yet">
    <p className="eyebrow">PRODUCTION SEQUENCE</p>
    <h2>This Production has no cards yet.</h2>
    {liveJobs > 0
      ? <p role="status">TONDE is building cards in the background ({liveJobs} running). They appear here as soon as each one is ready — stay on this page.</p>
      : <p>Describe the first moment to TONDE, or start with one blank card and direct it from there.</p>}
    <div className="cs-empty-actions">
      <button type="button" className="cs-primary" disabled={busy} onClick={onAsk}>Ask TONDE to develop it →</button>
      <button type="button" className="cs-btn" disabled={busy} onClick={onBlank}>Add a blank card</button>
    </div>
  </section>;
}
