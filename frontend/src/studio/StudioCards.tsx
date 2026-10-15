import { useEffect, useRef, useState, type ReactNode, type TouchEvent as ReactTouchEvent,
  type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import type { StudioScene, StudioShot } from '../services/productions';
import { productionVersioningService } from '../services/productionVersioning';
import { safeError } from '../services/errors';
import { formatMs } from './StudioTimeline';
import { approvalLabel } from './StudioTimeline';
import { cardExecution, cardReadiness, nextActionForScene, orderedShots, shotDisplayId } from './cards';
import type { FloatingCardView } from './floating';
import type { CardFocusArea } from '../services/productions';

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

export function HeroCard({ scene, index, active, selectedShotId, onFocus, onSelectShot, onPrimary, menu,
  floating, onOpenCard, onFocusArea }: {
  scene: StudioScene; index: number; active: boolean; selectedShotId: string | null;
  onFocus: () => void; onSelectShot: (shotId: string) => void;
  onPrimary: (scene: StudioScene) => void; menu: ReactNode;
  /** Canonical floating Card view: summarized values of the SAME Card fields the expanded view shows. */
  floating?: FloatingCardView; onOpenCard?: () => void; onFocusArea?: (area: CardFocusArea) => void;
}) {
  const readiness = cardReadiness(scene);
  const execution = cardExecution(scene);
  const action = nextActionForScene(scene);
  const results = scene.shots.reduce((total, shot) => total + shot.result_count, 0);
  const shots = orderedShots(scene);
  // Clicking the centered Card opens the same Card expanded; clicking a neighbour centres it first.
  const openOrFocus = () => { if (active && onOpenCard) onOpenCard(); else onFocus(); };
  return <article className={`cs-hero${active ? ' active' : ''}`} data-scene={scene.id}
    aria-label={`Card ${scene.order}: ${scene.title}`} aria-hidden={!active} onClick={openOrFocus}>
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
        {floating && floating.audience && <>
          <p className="cs-label">AUDIENCE SHOULD FEEL</p>
          <p className="cs-copy">{floating.audience}</p>
        </>}
        <p className="cs-label">SHOTS · {shots.length}</p>
        <p className="cs-copy">{shots.length === 0
          ? 'No coverage planned yet.'
          : shots.map(item => item.displayId).join(' · ')}</p>
        {floating && <div className="cs-quick" role="group" aria-label={`Card ${scene.order} areas`}>
          {floating.areas.map(area => <button key={area.area} type="button" className="cs-quick-btn"
            aria-label={`Open ${area.label.toLowerCase()} direction`} disabled={!onFocusArea}
            onClick={event => { event.stopPropagation(); onFocusArea?.(area.area); }}>
            <span className="cs-quick-key">{area.label}</span>
            <strong>{area.summary || (area.written ? 'Written in the expanded Card' : 'Building…')}</strong>
          </button>)}
        </div>}
        {floating && <div className="cs-quick-shots">
          {floating.shots.slice(0, 5).map(item => <button key={item.shot.id} type="button"
            className="cs-quick-shot" aria-label={`Open Shot ${item.displayId} ${item.shot.title}`}
            onClick={event => { event.stopPropagation(); onSelectShot(item.shot.id); }}>
            <span className="cs-quick-key">{item.displayId} · {item.method}</span>
            <strong>{item.shot.title}</strong>
          </button>)}
        </div>}
        {floating && floating.withinBudget === false && <p className="cs-label" role="status">
          THIS CARD IS ABOVE THE FLOATING WORD BUDGET — OPEN IT FOR THE FULL DIRECTION.</p>}
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
          <p className="cs-next-title">{floating?.nextAction || action.detail}</p>
          <button type="button" className="cs-primary" onClick={event => { event.stopPropagation(); onPrimary(scene); }}>
            {action.label} →</button>
          {onOpenCard && <button type="button" className="cs-btn" aria-label={`Open Card ${scene.order} expanded`}
            onClick={event => { event.stopPropagation(); onOpenCard(); }}>OPEN CARD →</button>}
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

export function HeroCarousel({ scenes, activeId, selectedShotId, onFocusScene, onSelectShot, onPrimary, renderMenu,
  onOpenCard, onFocusArea, floatingForScene }: {
  scenes: StudioScene[]; activeId: string | null; selectedShotId: string | null;
  onFocusScene: (sceneId: string) => void; onSelectShot: (sceneId: string, shotId: string) => void;
  onPrimary: (scene: StudioScene) => void; renderMenu: (scene: StudioScene) => ReactNode;
  onOpenCard?: (sceneId: string) => void; onFocusArea?: (sceneId: string, area: CardFocusArea) => void;
  floatingForScene?: (scene: StudioScene) => FloatingCardView;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const programmatic = useRef(0);
  const activeIndex = Math.max(0, scenes.findIndex(scene => scene.id === activeId));
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const go = (delta: -1 | 1) => {
    const next = scenes[Math.min(Math.max(activeIndex + delta, 0), scenes.length - 1)];
    if (next && next.id !== scenes[activeIndex]?.id) onFocusScene(next.id);
  };
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const onScroll = () => {
      if (Date.now() - programmatic.current < 650) return;
      const cards = [...track.querySelectorAll<HTMLElement>('[data-scene]')];
      if (!cards.length) return;
      const bounds = track.getBoundingClientRect();
      const center = bounds.left + bounds.width / 2;
      const visible = cards.filter(card => {
        const rect = card.getBoundingClientRect();
        return rect.right > bounds.left + 1 && rect.left < bounds.right - 1;
      });
      if (!visible.length) return;
      const best = visible.reduce((closest, card) => {
        const rect = card.getBoundingClientRect();
        const bestRect = closest.getBoundingClientRect();
        return Math.abs(rect.left + rect.width / 2 - center) < Math.abs(bestRect.left + bestRect.width / 2 - center)
          ? card : closest;
      });
      if (best.dataset.scene && best.dataset.scene !== scenes[activeIndex]?.id) {
        programmatic.current = Date.now();
        onFocusScene(best.dataset.scene);
      }
    };
    track.addEventListener('scroll', onScroll, { passive: true });
    return () => track.removeEventListener('scroll', onScroll);
  }, [activeIndex, onFocusScene, scenes]);
  useEffect(() => {
    const track = trackRef.current;
    const card = track?.querySelector<HTMLElement>(`[data-scene="${scenes[activeIndex]?.id}"]`);
    if (!track || !card) return;
    programmatic.current = Date.now();
    // scrollTo is not implemented by jsdom and can be missing in older embedded
    // browsers; assigning scrollLeft preserves the exact target without failing render.
    if (typeof track.scrollTo === 'function') track.scrollTo({ left: card.offsetLeft, behavior: 'smooth' });
    else track.scrollLeft = card.offsetLeft;
  }, [activeId, scenes]);
  const onTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  };
  const onTouchEnd = (event: ReactTouchEvent<HTMLDivElement>) => {
    const start = touchStart.current;
    const touch = event.changedTouches[0];
    touchStart.current = null;
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy)) return;
    suppressClick.current = true;
    go(dx < 0 ? 1 : -1);
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || (event.target as HTMLElement).closest('button,input,textarea,select,a')) return;
    touchStart.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || !touchStart.current) return;
    const { x, y } = touchStart.current;
    const dx = event.clientX - x;
    const dy = event.clientY - y;
    touchStart.current = null;
    if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy)) {
      suppressClick.current = true;
      go(dx < 0 ? 1 : -1);
    }
  };
  const onCarouselKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
      || target.isContentEditable || target.closest('[role="textbox"]')) return;
    event.preventDefault();
    go(event.key === 'ArrowRight' ? 1 : -1);
  };
  const onCarouselClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  };
  return <div className="cs-carousel-shell">
    <div className="cs-carousel" ref={trackRef} role="region" aria-roledescription="carousel" aria-label="Production cards"
      tabIndex={0} onKeyDown={onCarouselKeyDown} onClickCapture={onCarouselClickCapture}
      onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onTouchCancel={() => { touchStart.current = null; }}
      onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { touchStart.current = null; }}>
      {scenes.map((scene, index) => <HeroCard key={scene.id} scene={scene} index={index}
        active={scene.id === scenes[activeIndex]?.id} selectedShotId={selectedShotId}
        onFocus={() => { if (scene.id !== scenes[activeIndex]?.id) onFocusScene(scene.id); }}
        onSelectShot={shotId => onSelectShot(scene.id, shotId)}
        onPrimary={onPrimary} menu={renderMenu(scene)}
        floating={floatingForScene?.(scene)}
        onOpenCard={onOpenCard ? () => onOpenCard(scene.id) : undefined}
        onFocusArea={onFocusArea ? area => onFocusArea(scene.id, area) : undefined} />)}
    </div>
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
          style={{ flexGrow: Math.max(scene.duration_ms ?? scene.planned_duration_ms ?? 1, 1) }}
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
