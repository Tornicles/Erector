import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Production } from '../types/domain';
import { PRODUCT } from '../types/product';
import { formatRuntime } from '../types/domain';
import type { LiveItem } from './liveEngine';

const DEPTH = ['hl-focus', 'hl-left', 'hl-right', 'hl-back-left', 'hl-back-right'] as const;

const DOT: Record<LiveItem['type'], string> = {
  failed_job: 'bad',
  blocker: 'warn',
  result_ready: 'blue',
  job_active: '',
  continue: 'violet',
};

/**
 * TONDE Live: at most five ranked objects in a depth field.
 * - DOM order is always rank order (stable for screen readers); only visual
 *   depth classes move when priority changes, with CSS transitions.
 * - No timer-based rotation: motion is state-driven. The only ambient motion
 *   is the live pulse, paused on hover/focus-within and removed entirely
 *   under prefers-reduced-motion.
 * - Every object is a real link to its exact destination.
 */
export function TondeLive({ items, active }: { items: LiveItem[]; active: boolean }) {
  const [paused, setPaused] = useState(false);
  if (items.length === 0) {
    return <aside className="hl-live" aria-label="TONDE Live">
      <div className="hl-live-head">
        <div><strong>TONDE LIVE</strong><small>Priority, progress and readiness.</small></div>
        <div className="hl-live-state"><span className="hl-pulse" aria-hidden="true" />{active ? 'ACTIVE' : 'QUIET'}</div>
      </div>
      <p className="hl-live-empty" role="status">Nothing needs your attention right now.</p>
    </aside>;
  }
  return <aside className={`hl-live${paused ? ' is-paused' : ''}`} aria-label="TONDE Live"
    onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
    onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
    <div className="hl-live-head">
      <div><strong>TONDE LIVE</strong><small>Priority, progress and readiness in motion.</small></div>
      <div className="hl-live-state"><span className="hl-pulse" aria-hidden="true" />{active ? 'ACTIVE' : 'QUIET'}</div>
    </div>
    <div className="hl-space">
      <div className="hl-core" aria-hidden="true"><div><strong>TONDE</strong><small>DIRECTOR ACTIVE</small></div></div>
      <p className="hl-caption" aria-hidden="true">closest = most important</p>
      {items.map((item, index) => <Link key={item.id} to={item.href}
        className={`hl-card ${DEPTH[Math.min(index, DEPTH.length - 1)]}`}
        aria-label={`${item.eyebrow}: ${item.title}. ${item.reason}. Opens ${item.productionTitle ?? 'the relevant context'}.`}>
        <span className="hl-type">{item.eyebrow}</span>
        <strong>{item.title}</strong>
        <small>{item.summary}</small>
        <span className="hl-status"><span className={`hl-dot ${DOT[item.type]}`} aria-hidden="true" />{item.reason}</span>
      </Link>)}
    </div>
  </aside>;
}

export interface CarouselProduction {
  production: Production;
  sceneCount: number | null;
  shotCount: number | null;
  resultsReady: number | null;
  blockers: number | null;
  /** Exact continue destination (saved Studio context when known). */
  href: string;
  /** Secondary action: review evidence when it exists, else open Studio. */
  secondary: { label: string; href: string } | null;
  headline: string;
  standfirst: string;
}

function CarouselCard({ entry, active, state, onCenter }: {
  entry: CarouselProduction; active: boolean; state: 'prev' | 'next' | 'far'; onCenter: () => void;
}) {
  const { production } = entry;
  const face = production.execution_method === 'ai' ? 'AI' : production.execution_method === 'hybrid' ? 'HYBRID' : 'REAL';
  const type = PRODUCT.productionTypes[production.production_type] ?? production.production_type.replaceAll('_', ' ');
  return <article className={`hl-production${active ? ' active' : state === 'far' ? '' : ` ${state}`}`}
    aria-label={`${production.title}${active ? ' (in focus)' : ''}`} aria-current={active ? 'true' : undefined}>
    <div className="hl-production-art" aria-hidden="true"><span className="hl-chip">{type} · {face}</span></div>
    <div className="hl-production-info">
      <p className="eyebrow">{production.title}</p>
      <h2>{active ? entry.headline : production.title}</h2>
      {active && <p>{entry.standfirst}</p>}
      <div className="hl-production-meta">
        {entry.sceneCount !== null && <span><b>{entry.sceneCount}</b> cards</span>}
        {entry.shotCount !== null && <span><b>{entry.shotCount}</b> shots</span>}
        {(entry.resultsReady ?? 0) > 0 && <span><b>{entry.resultsReady}</b> Results</span>}
        {(entry.blockers ?? 0) > 0 && <span><b>{entry.blockers}</b> blockers</span>}
        {active && <span>{PRODUCT.approvals[production.approval]}{production.planned_duration_ms !== null ? ` · ${formatRuntime(production.planned_duration_ms)}` : ''}</span>}
      </div>
      <div className="hl-production-actions">
        {active
          ? <><Link className="hm-primary" to={entry.href}>Continue →</Link>
            {entry.secondary && <Link className="hm-btn" to={entry.secondary.href}>{entry.secondary.label}</Link>}</>
          : <button type="button" className="hm-btn" onClick={onCenter} aria-label={`Focus ${production.title}`}>Focus</button>}
      </div>
    </div>
  </article>;
}

/**
 * Continue carousel in the Studio card language: one dominant centered
 * production, neighbours partially visible. Scroll-snap + arrows + keyboard;
 * clicking a side card centers it without navigating.
 */
export function ProductionCarousel({ entries }: { entries: CarouselProduction[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [center, setCenter] = useState(0);
  useEffect(() => { setCenter(0); }, [entries.map(entry => entry.production.id).join('|')]);
  useEffect(() => {
    const el = trackRef.current?.querySelector<HTMLElement>(`[data-index="${center}"]`);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [center]);
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let timer = 0;
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const middle = track.getBoundingClientRect().left + track.clientWidth / 2;
        let best = center;
        let bestDist = Infinity;
        track.querySelectorAll<HTMLElement>('[data-index]').forEach(el => {
          const rect = el.getBoundingClientRect();
          const dist = Math.abs(rect.left + rect.width / 2 - middle);
          const index = Number(el.dataset.index ?? 0);
          if (dist < bestDist) { bestDist = dist; best = index; }
        });
        if (best !== center) setCenter(best);
      }, 120);
    };
    track.addEventListener('scroll', onScroll, { passive: true });
    return () => { track.removeEventListener('scroll', onScroll); window.clearTimeout(timer); };
  }, [center]);
  if (entries.length === 0) return null;
  const go = (delta: -1 | 1) => setCenter(value => Math.min(Math.max(value + delta, 0), entries.length - 1));
  return <div className="hl-production-shell">
    <button type="button" className="hl-arrow" aria-label="Previous production" disabled={center === 0} onClick={() => go(-1)}>←</button>
    <div className="hl-carousel" ref={trackRef} role="region" aria-roledescription="carousel" aria-label="Continue productions"
      onKeyDown={event => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        if ((event.target as HTMLElement).tagName === 'TEXTAREA') return;
        event.preventDefault();
        go(event.key === 'ArrowRight' ? 1 : -1);
      }}>
      {entries.map((entry, index) => <div key={entry.production.id} data-index={index} className="hl-slide">
        <CarouselCard entry={entry} active={index === center}
          state={index === center - 1 ? 'prev' : index === center + 1 ? 'next' : 'far'}
          onCenter={() => setCenter(index)} />
      </div>)}
    </div>
    <button type="button" className="hl-arrow" aria-label="Next production" disabled={center === entries.length - 1} onClick={() => go(1)}>→</button>
  </div>;
}

/** At most one secondary strip; renders nothing when there is nothing to say. */
export function HomeContextStrip({ item }: { item: LiveItem | null }) {
  if (!item) return null;
  return <div className="hl-strip" role="status">
    <div><strong>{item.title} — {item.summary}</strong><small>Also in TONDE Live. Nothing else needs you.</small></div>
    <Link className="hm-btn" to={item.href}>Open →</Link>
  </div>;
}

export function HomeStartBox({ intent, onChange, onSubmit, disabled, busy, source, onSource, children }: {
  intent: string; onChange: (value: string) => void; onSubmit: (event: FormEvent) => void;
  disabled: boolean; busy: boolean; source: string; onSource: (source: 'describe' | 'upload' | 'url' | 'import' | 'record') => void;
  children?: ReactNode;
}) {
  const sources = [['upload', '＋ Upload'], ['url', '↗ Reference'], ['describe', '◉ Describe'], ['import', '▤ Script'], ['record', '◉ Record']] as const;
  return <form className="hl-start" onSubmit={onSubmit} aria-label="Director intake">
    <label className="sr-only" htmlFor="home-direct-idea">Tell TONDE what you want to make</label>
    <textarea id="home-direct-idea" aria-label="Describe what you want to make" value={intent}
      onChange={event => onChange(event.target.value)} placeholder="Tell TONDE what you want to make…"
      rows={3} disabled={disabled} />
    <div className="hl-start-bottom">
      <div className="hl-sources" role="group" aria-label="Intake source">
        {sources.map(([key, label]) => <button key={key} type="button" aria-pressed={source === key} onClick={() => onSource(key)}>{label}</button>)}
      </div>
      <button type="submit" className="hm-primary" disabled={disabled || !intent.trim() || busy}>{busy ? 'Planning…' : <>DIRECT THIS →</>}</button>
    </div>
    {children}
  </form>;
}
