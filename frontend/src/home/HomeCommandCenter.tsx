import { Link } from 'react-router-dom';
import type { FormEvent } from 'react';
import type { Production } from '../types/domain';
import type { Job } from '../services/prompt11';
import { PRODUCT } from '../types/product';
import { formatRuntime } from '../types/domain';
import { EmptyState, ErrorState, LoadingState } from '../components/StateComponents';
import type { AttentionItem, LifecycleStage } from './commandCenter';
import { failedJobs, liveJobs } from './commandCenter';

export function PriorityPanel({ top, rest }: { top: AttentionItem | null; rest: AttentionItem[] }) {
  return <aside className="hm-priority-panel" aria-label="TONDE priority">
    <div>
      <p className="eyebrow">TONDE PRIORITY</p>
      <h3>{top ? top.title : 'Nothing needs you right now.'}</h3>
      <p>{top ? top.detail : 'Your Productions are moving normally. Continue current work or start something new.'}</p>
    </div>
    {rest.length > 0 && <div className="hm-priority-list">{rest.map(item => <div className="hm-priority-item" key={item.id}>
      <span className={`hm-dot${item.kind === 'failed_job' ? ' bad' : item.kind === 'decision' ? ' warn' : ' info'}`} aria-hidden="true" />
      <div><strong>{item.title}</strong><small>{item.detail}</small></div>
    </div>)}</div>}
  </aside>;
}

export function AttentionStrip({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return null;
  return <section className="hm-section" aria-label="Needs your attention">
    <div className="hm-section-head">
      <div><p className="eyebrow">NEEDS YOUR ATTENTION</p><h2>Only what can move work forward</h2>
        <p>Blockers, failed jobs and drafts. Everything else stays out of the way.</p></div>
      <Link className="hm-btn" to="/projects">View all</Link>
    </div>
    <div className="hm-attention-strip">{items.map(item => <article className="hm-attention-card" key={item.id}>
      <div className="hm-top"><span className="hm-type">{item.eyebrow}</span></div>
      <h3>{item.title}</h3>
      <p>{item.detail}</p>
      <Link className="hm-btn" to={item.href}>{item.actionLabel} →</Link>
    </article>)}</div>
  </section>;
}

export function ContinueCard({ production, sceneCount, shotCount, resultsReady, blockers, href }: {
  production: Production; sceneCount: number | null; shotCount: number | null;
  resultsReady: number | null; blockers: number | null; href: string;
}) {
  const face = production.execution_method === 'ai' ? 'AI CREATION' : production.execution_method === 'hybrid' ? 'HYBRID' : 'REAL PRODUCTION';
  return <section className="hm-section" aria-label="Continue">
    <div className="hm-section-head"><div><p className="eyebrow">CONTINUE</p><h2>Resume the exact production context</h2>
      <p>Go back to the Scene, Shot, Result or decision — not a generic project homepage.</p></div></div>
    <article className="hm-continue-card">
      <div className="hm-continue-art" aria-hidden="true"><span className="hm-chip">{PRODUCT.productionTypes[production.production_type]} · {face}</span></div>
      <div className="hm-continue-info">
        <p className="eyebrow">{production.title}</p>
        <h2>{blockers ? 'Unblock and keep directing.' : production.approval === 'approved' ? 'Approved — keep directing.' : 'Pick up exactly where you stopped.'}</h2>
        <p>{PRODUCT.approvals[production.approval]}{production.planned_duration_ms !== null ? ` · ${formatRuntime(production.planned_duration_ms)}` : ''} · Updated {new Date(production.updated_at).toLocaleDateString()}</p>
        <div className="hm-continue-meta">
          {sceneCount !== null && <span><b>{sceneCount}</b> Scenes</span>}
          {shotCount !== null && <span><b>{shotCount}</b> Shots</span>}
          {resultsReady !== null && <span><b>{resultsReady}</b> Results</span>}
          {blockers !== null && <span><b>{blockers}</b> blockers</span>}
        </div>
        <div className="hm-continue-actions">
          <Link className="hm-primary" to={href}>Continue in Studio →</Link>
          {(resultsReady ?? 0) > 0 && <Link className="hm-btn" to={`/studio/${production.id}?tool=Results`}>Review Results</Link>}
        </div>
      </div>
    </article>
  </section>;
}

export function LifecycleLine({ stages, productionTitle }: { stages: LifecycleStage[]; productionTitle: string }) {
  return <section className="hm-section" aria-label="Current lifecycle">
    <div className="hm-section-head"><div><p className="eyebrow">CURRENT LIFECYCLE</p><h2>Where {productionTitle} stands</h2>
      <p>Derived from the Production's real Scenes, Shots, Results and approval — never decorative.</p></div></div>
    <div className="hm-pipeline" role="list">{stages.map(stage => <div key={stage.key} role="listitem"
      className={`hm-stage${stage.state === 'done' ? ' done' : stage.state === 'active' ? ' active' : ''}`}>
      <strong>{stage.label}</strong><small>{stage.note}</small>
    </div>)}</div>
  </section>;
}

export function LiveJobs({ jobs, loading, error, onRetry }: {
  jobs: Job[]; loading: boolean; error: string | null; onRetry: () => void;
}) {
  const live = liveJobs(jobs);
  const failed = failedJobs(jobs);
  if (!loading && !error && live.length === 0 && failed.length === 0) return null;
  return <article className="hm-panel" aria-label="TONDE is working">
    <div className="hm-panel-head"><h3>TONDE is working</h3><span>{live.length > 0 ? `${live.length} LIVE` : `${failed.length} NEED YOU`}</span></div>
    {loading && !jobs.length ? <LoadingState label="Checking background work…" /> : error ? <ErrorState message={error} retry={onRetry} /> : <div className="hm-list">
      {live.map(job => <div className="hm-row" key={job.job_id}>
        <div><strong>{job.job_type_display_name ?? job.job_type.replaceAll('_', ' ')}</strong>
          <small>{job.state_line ?? job.status_label ?? job.status}{typeof job.progress === 'number' ? ` · ${job.progress}% recorded` : ' · Processing'}</small>
          {typeof job.progress === 'number' && <div className="hm-progress" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }} /></div>}</div>
        <Link className="hm-btn" to="/jobs">Open</Link>
      </div>)}
      {failed.map(job => <div className="hm-row" key={job.job_id}>
        <div><strong>{job.job_type_display_name ?? job.job_type.replaceAll('_', ' ')}</strong>
          <small role="alert">{job.error_code ? `${job.error_code}: ` : ''}{job.error_message ?? 'Failed.'}</small></div>
        <Link className="hm-btn" to="/jobs">Retry job</Link>
      </div>)}
    </div>}
  </article>;
}

export function QuickStartBox({ intent, onChange, onSubmit, disabled, busy }: {
  intent: string; onChange: (value: string) => void; onSubmit: (event: FormEvent) => void;
  disabled: boolean; busy: boolean;
}) {
  return <form className="hm-start-box" onSubmit={onSubmit} aria-label="Start something new">
    <label className="sr-only" htmlFor="home-quick-idea">Start something new</label>
    <textarea id="home-quick-idea" value={intent} onChange={event => onChange(event.target.value)}
      placeholder="Or start something new…" rows={2} disabled={disabled} />
    <div className="hm-start-bottom">
      <span className="hm-hint">Uploads, references and scripts live in the full intake below.</span>
      <button type="submit" className="hm-primary" disabled={disabled || !intent.trim() || busy}>{busy ? 'Planning…' : <>DIRECT THIS →</>}</button>
    </div>
  </form>;
}

export function StartExamples({ onUse }: { onUse: (example: string) => void }) {
  const examples = [
    { type: 'IDEA', title: 'Describe it naturally', text: '“I want to make a cinematic documentary about street food businesses.”', value: 'I want to make a cinematic documentary about street food businesses.' },
    { type: 'REFERENCE', title: 'Show TONDE what inspired you', text: 'Bring a video, image, song or script from the intake above and explain what you like about it.', value: 'I want something inspired by this movie.' },
    { type: 'CONSTRAINT', title: 'Tell TONDE what you have', text: '“I only have my phone and one light.” TONDE adapts without stopping the idea.', value: 'I want to make a short film. I only have my phone and one light.' },
  ];
  return <section className="hm-section" aria-label="Start from anything">
    <div className="hm-section-head"><div><p className="eyebrow">START FROM ANYTHING</p><h2>TONDE decides what should happen next</h2>
      <p>You do not need to know production terminology before you begin.</p></div></div>
    <div className="hm-attention-strip">{examples.map(example => <article className="hm-attention-card" key={example.type}>
      <div className="hm-top"><span className="hm-type">{example.type}</span></div>
      <h3>{example.title}</h3><p>{example.text}</p>
      <button type="button" className="hm-btn" onClick={() => onUse(example.value)}>Use example →</button>
    </article>)}</div>
  </section>;
}

