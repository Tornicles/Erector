import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react';
import { useModalFocus } from '../hooks/useModalFocus';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowUpRight, Plus, Clapperboard, Search, Upload, X, ArchiveRestore, Archive } from 'lucide-react';
import type { Database } from '../types/database';
import type { Row } from '../types/domain';
import { requireSupabase } from '../lib/supabase';
import { mediaService } from '../services/media';
import { useAuth } from '../contexts/AuthContext';
import { productionService, PAGE_SIZE } from '../services/productions';
import { safeError } from '../services/errors';
import { EmptyState, ErrorState, LoadingState } from '../components/StateComponents';
import { formatRuntime, type Production } from '../types/domain';
import { PRODUCT } from '../types/product';
import { type DirectorCollaborationMode, type DirectorPlanResponse } from '../services/productions';
type IntakeAttachment = { clientId: string; file: File; state: 'uploading' | 'uploaded' | 'failed'; error?: string; mediaId?: string };
type IntakeOrigin = { source_type: Database['tonde']['Enums']['reference_source']; source_url?: string; source_description?: string; media_id?: string; provenance?: Row<'production_references'>['provenance'] };
export function HomePage() {
  const { workspaceId } = useAuth();
  const navigate = useNavigate();
  const [intent, setIntent] = useState(() => { try { const context=JSON.parse(localStorage.getItem('tonde:intake-context')||'null') as {description?:string}|null; return context?.description ?? ''; } catch { return ''; } });
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<'describe' | 'upload' | 'url' | 'import' | 'record'>('describe');
  const [attachments, setAttachments] = useState<IntakeAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [work, setWork] = useState<Production[]>([]);
  const [workLoading, setWorkLoading] = useState(true);
  const [workError, setWorkError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [createdProductionId, setCreatedProductionId] = useState<string | null>(null);
  const [plan, setPlan] = useState<DirectorPlanResponse | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [collaboration, setCollaboration] = useState<DirectorCollaborationMode>('stop_at_major_decisions');
  const [planBusy, setPlanBusy] = useState(false);
  const [commitBusy, setCommitBusy] = useState(false);
  const [planError, setPlanError] = useState<string|null>(null);
  const readyToDirect = intent.trim().length > 0 || attachments.some(item => item.state === 'uploaded') || isReferenceUrl(url);
  const intakeLocked = !!createdProductionId;
  useEffect(() => {
    if (!workspaceId) { setWork([]); setWorkError(null); setWorkLoading(false); return; }
    let active = true;
    setWorkLoading(true); setWorkError(null);
    productionService.list(workspaceId).then(items => { if (active) setWork(orderWork(items).slice(0, 8)); }).catch(failure => { if (active) setWorkError(safeError(failure).message); }).finally(() => { if (active) setWorkLoading(false); });
    return () => { active = false; };
  }, [workspaceId]);
  const addFiles = async (files: FileList | File[] | null) => {
    if (!files?.length) return;
    if (!workspaceId) { setError('Your workspace is not ready. Retry after signing in again.'); return; }
    const selectedFiles = Array.from(files);
    if (selectedFiles.length + attachments.length > 8) { setError('A Production intake can contain up to 8 files. Remove a file before adding more.'); return; }
    const additions = selectedFiles.slice(0, 8 - attachments.length).map(file => ({ clientId: crypto.randomUUID(), file, state: 'uploading' as const }));
    setAttachments(current => [...current, ...additions]); setError(null);
    await Promise.all(additions.map(async ({ clientId, file }) => {
      try {
        const media = await mediaService.upload(workspaceId, file);
        setAttachments(current => current.map(item => item.clientId === clientId ? { ...item, state: 'uploaded', mediaId: media.id } : item));
      } catch (failure) {
        setAttachments(current => current.map(item => item.clientId === clientId ? { ...item, state: 'failed', error: safeError(failure).message } : item));
      }
    }));
  };
  const pendingIntake = useRef<{ productionId: string; references: IntakeOrigin[]; nextReference: number } | null>(null);
  const intakeStorageKey = workspaceId ? `tonde:director-plan:${workspaceId}` : null;
  const runPlan = async (targetId: string, mode: DirectorCollaborationMode, nextAnswers: Record<string,string>, goalOverride?: string) => {
    if (!workspaceId) return null;
    const goal = (goalOverride ?? intent).trim() || plan?.intent.goal || '';
    const response = await productionService.directorPlan(workspaceId, targetId, {
      goal, collaboration_mode: mode, answered_decisions: nextAnswers, include_optional_questions: true,
    });
    setPlan(response); setAnswers(nextAnswers); setCreatedProductionId(targetId);
    if (intakeStorageKey) localStorage.setItem(intakeStorageKey, JSON.stringify({ productionId: targetId, goal, collaboration: mode, answers: nextAnswers }));
    return response;
  };
  useEffect(() => {
    if (!workspaceId || !intakeStorageKey) return;
    let active = true;
    const restore = async () => {
      try {
        const raw = localStorage.getItem(intakeStorageKey);
        if (!raw) return;
        const saved = JSON.parse(raw) as { productionId?: string; goal?: string; collaboration?: DirectorCollaborationMode; answers?: Record<string,string> };
        if (!saved.productionId) return;
        pendingIntake.current = { productionId: saved.productionId, references: [], nextReference: 0 };
        setCreatedProductionId(saved.productionId);
        if (saved.goal) setIntent(saved.goal);
        const mode = saved.collaboration ?? 'stop_at_major_decisions';
        setCollaboration(mode);
        const response = await productionService.directorPlan(workspaceId, saved.productionId, {
          goal: saved.goal ?? '', collaboration_mode: mode, answered_decisions: saved.answers ?? {}, include_optional_questions: true,
        });
        if (!active) return;
        setPlan(response); setAnswers(saved.answers ?? {});
      } catch (failure) {
        if (active) setPlanError(safeError(failure).message);
      }
    };
    void restore();
    return () => { active = false; };
  }, [workspaceId, intakeStorageKey]);
  const beginDirector = async (event: FormEvent) => {
    event.preventDefault(); if (!workspaceId || !readyToDirect || busy || planBusy) return;
    setPlanBusy(true); setPlanError(null);
    try {
      let pending = pendingIntake.current;
      if (!pending) {
        const productionId = createdProductionId ?? await productionService.create(workspaceId, intent.trim().slice(0,160)||'Untitled Production');
        pending = { productionId, references: [
          ...attachments.filter(item=>item.state==='uploaded'&&item.mediaId).map(item=>({source_type:'upload' as const,media_id:item.mediaId!})),
          ...(isReferenceUrl(url)?[{source_type:'url' as const,source_url:url.trim()}]:[]),
          ...(intent.trim()?[{source_type:'description' as const,source_description:intent.trim(),...(intakeProvenance()?{provenance:intakeProvenance()!}:{})}]:[]),
        ], nextReference: 0 };
        pendingIntake.current = pending;
        setCreatedProductionId(productionId);
      }
      while (pending.nextReference < pending.references.length) {
        await productionService.addReference(workspaceId, pending.productionId, pending.references[pending.nextReference]);
        pending.nextReference += 1;
      }
      await runPlan(pending.productionId, collaboration, answers);
    } catch(failure) { setPlanError(safeError(failure).message); }
    finally { setPlanBusy(false); }
  };
  const submitDecision = async (id:string,value:string) => {
    if(!workspaceId||!createdProductionId||!plan)return;
    setPlanBusy(true); setPlanError(null);
    try {
      const next = { ...answers, [id]: value };
      const question = plan.questions.find(item=>item.id===id)?.question ?? id;
      await productionService.recordDirectorDecisions(workspaceId, createdProductionId, { [id]: value }, 'intake', { [id]: question });
      await runPlan(createdProductionId, collaboration, next);
    }catch(failure){setPlanError(safeError(failure).message);}finally{setPlanBusy(false);}
  };
  const buildProduction = async () => {
    if(!workspaceId||!createdProductionId||!plan)return;
    setCommitBusy(true); setPlanError(null);
    try {
      const current = await productionService.get(workspaceId, createdProductionId);
      const result = await productionService.directorCommit(workspaceId, createdProductionId, {
        operation_id: plan.operation.operation_id, expected_production_revision: current.revision,
        bundle: plan.bundle, explicit_confirmation: true,
      });
      if(intakeStorageKey)localStorage.removeItem(intakeStorageKey);
      pendingIntake.current = null;
      const target = result.production_id ?? createdProductionId;
      setIntent(''); setUrl(''); setAttachments([]); setPlan(null); setAnswers({}); setCreatedProductionId(null); localStorage.removeItem('tonde:intake-context');
      navigate(`/studio/${target}`);
    }catch(failure){setPlanError(safeError(failure).message);}finally{setCommitBusy(false);}
  };
  const openQuestions = (plan?.questions ?? []).filter(question => !question.answered);
  const requiredOpen = openQuestions.filter(question => question.blocking && !answers[question.id]);
  return <div className="page home-page">
    <header className="compact-header home-intro"><p className="eyebrow">TONDE · YOUR AI PRODUCTION DIRECTOR</p><h1>What do you want to make?</h1><p>Describe an idea, add a reference, or bring in something you already have.</p></header>
    {plan&&createdProductionId ? <section className="director-intake-panel" aria-label="Director intake"><header className="intake-progress"><p className="eyebrow">{requiredOpen.length?'KEY DECISIONS':plan.operation.status?'DIRECTOR BRIEF · PLAN READY':'DIRECTOR BRIEF'}</p><h2>TONDE is shaping one Master Production</h2><p>{plan.intent.primary_type.replaceAll('_',' ')}{plan.intent.runtime_ms!==null?` · ${formatRuntime(plan.intent.runtime_ms)}`:''}{plan.intent.platform?` · ${plan.intent.platform}`:''}</p></header>
      <p className="subtle">{plan.producer==='model'?'A configured model refined this plan through the validated provider contract.':'No model provider is configured, so this plan is deterministic. Nothing here is presented as model reasoning.'}</p>
      {plan.limitations.length>0&&<ul className="capability-notes">{plan.limitations.map(note=><li key={note}>{note}</li>)}</ul>}
      {plan.provider.ffmpeg_available===false&&<p className="capability-note" role="status">Frame extraction is unavailable in this environment, so video References are measured from metadata and audio only.</p>}
      {plan.reference_influence.length>0&&<ul className="capability-notes">{plan.reference_influence.map(note=><li key={note}>{note}</li>)}</ul>}
      <dl className="director-brief"><div><dt>Production type</dt><dd>{plan.intent.primary_type.replaceAll('_',' ')}</dd></div><div><dt>Runtime</dt><dd>{plan.intent.runtime_ms===null?'Not required / unresolved':formatRuntime(plan.intent.runtime_ms)}</dd></div><div><dt>Platform</dt><dd>{plan.intent.platform||'Not specified'}</dd></div><div><dt>Execution</dt><dd>{plan.intent.execution}</dd></div><div><dt>Dialogue</dt><dd>{plan.intent.dialogue_mode?plan.intent.dialogue_mode.replaceAll('_',' '):'Not specified'}</dd></div></dl>
      <label className="collaboration-select">How should TONDE work?<select value={collaboration} disabled={planBusy||commitBusy} onChange={event=>{const value=event.target.value as DirectorCollaborationMode;setCollaboration(value);if(createdProductionId)void runPlan(createdProductionId,value,answers);}}><option value="guide_step_by_step">Guide Me Step-by-Step</option><option value="stop_at_major_decisions">Build It, Stop at Major Decisions</option><option value="complete_first_draft">Build Complete First Draft</option></select></label>
      {plan.brief.open_decisions.some(decision=>decision.answered&&decision.answer)&&<ul className="director-decided" aria-label="Decided questions">{plan.brief.open_decisions.filter(decision=>decision.answered&&decision.answer).map(decision=><li key={decision.id}><strong>{decision.question}</strong> — {decision.answer}</li>)}</ul>}
      {openQuestions.map(question=><article className="director-question" key={question.id}><h3>{question.question}{question.blocking?' *':''}</h3><p>{question.why}</p><p className="subtle">Impact {question.impact} · confidence {question.confidence}{question.depends_on.length?` · depends on ${question.depends_on.join(', ')}`:''}</p>{question.options.length>0?<div>{question.options.map(option=><button key={option} type="button" disabled={planBusy||commitBusy} onClick={()=>void submitDecision(question.id,option)}>{option}</button>)}{question.allow_tonde_decides&&!question.options.includes('TONDE decides')&&<button type="button" disabled={planBusy||commitBusy} onClick={()=>void submitDecision(question.id,'TONDE decides')}>TONDE decides</button>}</div>:<form onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);void submitDecision(question.id,String(form.get('answer')||''));}}><label>{question.id==='runtime'?'Target runtime':'Your answer'}<input name="answer" required/></label><button type="submit" className="primary" disabled={planBusy||commitBusy}>Save answer</button></form>}</article>)}
      {openQuestions.length===0&&<p className="subtle">Every open decision is answered. Building writes the Brief, Story, Script, Scenes, Characters, Environments, Products and Style to this Production.</p>}
      {plan.brief.assumptions.length>0&&<p className="assumption-note"><strong>Assumptions:</strong> {plan.brief.assumptions.map(assumption=>assumption.statement).join(' ')}</p>}
      {plan.reality&&<section className="reality-card"><p className="eyebrow">PRODUCTION REALITY CHECK · {plan.reality.feasibility.toUpperCase()} · {plan.reality.complexity} complexity</p><p>{plan.reality.summary}</p>{plan.reality.items.slice(0,6).map(item=><p key={`${item.domain}-${item.requirement}`}><strong>{item.status.replaceAll('_',' ').toUpperCase()} · {item.requirement}</strong> — {item.recommendation}</p>)}{plan.reality.conflicts.slice(0,3).map(conflict=><p className="subtle" key={conflict}>Conflict: {conflict}</p>)}</section>}
      {plan.story&&<section className="story-preview"><p className="eyebrow">STORY · {plan.story.variation.replaceAll('_',' ').toUpperCase()} · DRAFT PREVIEW · NOT APPROVAL</p><h3>{plan.story.title}</h3><p>{plan.story.logline}</p><p>{plan.story.premise}</p><p className="subtle">Central question: {plan.story.central_question}</p><ol>{plan.story.beats.map(beat=><li key={beat.id}>{beat.name} · {beat.planned_duration_ms===null?'untimed':formatRuntime(beat.planned_duration_ms)}<small>{beat.content}</small></li>)}</ol></section>}
      {plan.script&&plan.script.scenes.length>0&&<section className="story-preview script-preview"><p className="eyebrow">SCRIPT · {plan.script.dialogue_mode?plan.script.dialogue_mode.replaceAll('_',' '):'no dialogue mode'}</p>{plan.script.scenes.slice(0,4).map(scene=><article key={scene.scene_order}><h4>{scene.heading}</h4>{scene.action.map(action=><p key={action}>{action}</p>)}{scene.lines.map((line,index)=><p key={`${scene.scene_order}-${index}`}><strong>{line.speaker??line.kind.replaceAll('_',' ')}</strong> {line.content}{line.intention?` — ${line.intention}`:''}</p>)}</article>)}{plan.script.scenes.length>4&&<p className="subtle">+{plan.script.scenes.length-4} more Scene(s) in the full Script.</p>}</section>}
      {plan.scenes.length>0&&<section className="story-preview"><p className="eyebrow">PLANNED SCENES · DRAFT PREVIEW · NOT APPROVAL</p><ol>{plan.scenes.map(scene=><li key={scene.order}>{scene.title} · {formatRuntime(scene.planned_duration_ms)}<small>{scene.purpose}</small></li>)}</ol></section>}
      <p className="subtle">Runtime fit: target {formatRuntime(plan.runtime_fit.target_ms)} · assigned {formatRuntime(plan.runtime_fit.assigned_ms)} · dialogue {formatRuntime(plan.runtime_fit.dialogue_ms)} · action {formatRuntime(plan.runtime_fit.action_ms)} · status {plan.runtime_fit.status}</p>
      {plan.characters.length>0&&<p className="subtle">Characters: {plan.characters.map(character=>`${character.name} (${character.role})`).join(', ')}</p>}
      {plan.environments.length>0&&<p className="subtle">Environments: {plan.environments.map(environment=>environment.name).join(', ')}</p>}
      {plan.products.length>0&&<p className="subtle">Products: {plan.products.map(product=>`${product.name} (${product.required_visibility})`).join(', ')}</p>}
      {plan.style_bible&&<p className="subtle">Style: {plan.style_bible.sections.map(section=>section.section).join(', ')||'no Style sections yet'}</p>}
      {planError&&<p role="alert" className="intake-error">{planError}</p>}
      <div className="director-submit"><button type="button" className="primary" disabled={planBusy||commitBusy||requiredOpen.length>0||plan.reality.feasibility==='blocked'} title={requiredOpen.length?'Answer the required production decisions before building':'Write this plan to the Production'} onClick={()=>void buildProduction()}>{commitBusy?'Building…':'BUILD PRODUCTION'}</button><button type="button" disabled={planBusy||commitBusy} onClick={()=>{if(createdProductionId)void runPlan(createdProductionId,collaboration,answers);}}>{planBusy?'Re-planning…':'Re-plan with these decisions'}</button></div>
      <Link className="text-link" to={`/studio/${createdProductionId}`}>Open this Production in Studio <ArrowUpRight size={14}/></Link>
    </section> : <form className="director-entry" onSubmit={beginDirector}>
      <div className="intake-tabs" role="tablist" aria-label="How would you like to start?">{([['describe','Describe'],['upload','Upload'],['url','Paste URL'],['import','Import'],['record','Record']] as const).map(([key,label]) => <button key={key} type="button" role="tab" aria-selected={mode === key} className={mode === key ? 'active' : ''} onClick={() => { setMode(key); if (key === 'upload') inputRef.current?.click(); }}>{label}</button>)}</div>
      {mode === 'describe' && <label className="sr-only" htmlFor="director-intent">Describe what you want to make</label>}
      <textarea id="director-intent" aria-label="Describe what you want to make" value={intent} onChange={event => setIntent(event.target.value)} placeholder={'“I want a 30-second coffee commercial.”\n\nDescribe the thing you want to make — no category required.'} rows={5} disabled={intakeLocked} />
      {mode === 'url' && <label className="intake-secondary">Reference URL<input aria-label="Reference URL" inputMode="url" type="url" placeholder="Paste a supported reference link" value={url} onChange={event => setUrl(event.target.value)} disabled={intakeLocked}/>{url&&<small className="subtle">{referenceProvider(url)} · Access and media analysis are not verified.</small>}</label>}
      {!workspaceId && <div className="capability-note" role="status">Local preview only — connect a Supabase workspace to create Productions, load work or upload private media.</div>}
      {mode === 'upload' && !workspaceId && <div className="capability-note" role="status">Private uploads need a connected Supabase workspace.</div>}
      {mode === 'import' && <div className="capability-note" role="status">No external import source is connected yet. Upload a file or paste a reference URL instead.</div>}
      {mode === 'record' && <div className="capability-note" role="status">Recording is not configured in this workspace yet. You can upload an audio file when ready.</div>}
      <input ref={inputRef} className="sr-only" type="file" multiple disabled={!workspaceId} accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,audio/mpeg,audio/wav,audio/mp4,application/pdf,text/plain" onChange={event => { void addFiles(event.target.files); event.currentTarget.value = ''; }} aria-label="Upload references" />
      {attachments.length > 0 && <><ul className="attachment-list" aria-label="Reference uploads">{attachments.map(item => <li key={item.clientId}><span className="attachment-type">{item.file.type.split('/')[0] || 'file'}</span><span>{item.file.name}<small>{item.state === 'uploaded' ? 'Uploaded · not analyzed' : item.state === 'uploading' ? 'Uploading…' : item.error}</small></span>{item.state==='failed'&&<button type="button" disabled={intakeLocked} onClick={()=>void addFiles([item.file])}>Retry upload</button>}<button type="button" aria-label={`Remove ${item.file.name} from intake only; uploaded media is retained`} disabled={intakeLocked} onClick={() => setAttachments(current => current.filter(candidate => candidate.clientId !== item.clientId))}><X size={15} /></button></li>)}</ul><p className="intake-truth">Up to 8 files, 50 MB each. Removing a file here only removes it from intake; uploaded private media is retained.</p></>}
      {planError&&!plan&&<p role="alert" className="intake-error">{planError}</p>}
      {error && <div role="alert" className="intake-error"><p className="error-text">{error}</p>{createdProductionId&&<><p className="subtle">Your Production is saved. Direct This again to retry the remaining intake links, or open the Production now.</p><Link className="text-link" to={`/studio/${createdProductionId}`}>Open the Production started from this intake <ArrowUpRight size={14}/></Link></>}</div>}
      <div className="director-submit"><button type="button" className="secondary-action" disabled={!workspaceId} title={!workspaceId ? 'Connect a Supabase workspace to upload private media' : undefined} onClick={() => { setMode('upload'); inputRef.current?.click(); }}><Upload size={16} /> Add reference</button><button className="primary" disabled={!workspaceId || !readyToDirect || planBusy || attachments.some(item => item.state === 'uploading')}>{planBusy ? 'Planning…' : 'DIRECT THIS'}<ArrowUpRight size={17} /></button></div>
      <label className="collaboration-select">How should TONDE work?<select value={collaboration} onChange={event=>setCollaboration(event.target.value as typeof collaboration)}><option value="guide_step_by_step">Guide Me Step-by-Step</option><option value="stop_at_major_decisions">Build It, Stop at Major Decisions</option><option value="complete_first_draft">Build Complete First Draft</option></select></label>
      <p className="intake-truth">References are saved to this production. Uploading does not mean TONDE has analyzed them.</p>
    </form>}
    <section className="your-work" aria-labelledby="your-work-heading"><div className="section-heading"><div><p className="eyebrow">YOUR NEXT ACTIONS</p><h2 id="your-work-heading">Your Work</h2></div><Link to="/projects">All Projects <ArrowUpRight size={15} /></Link></div>
      {workLoading ? <LoadingState label="Loading your work…" /> : workError ? <ErrorState message={workError} retry={() => { if(!workspaceId)return;setWorkLoading(true); productionService.list(workspaceId).then(items => setWork(orderWork(items).slice(0, 8))).catch(failure => setWorkError(safeError(failure).message)).finally(() => setWorkLoading(false)); }} /> : !workspaceId ? <EmptyState title="Connect a workspace to see Your Work">Your Productions and private uploads appear here when Supabase is configured.</EmptyState> : work.length ? <div className="work-list">{work.map(item => <Link className="work-row" key={item.id} to={`/studio/${item.id}`}><Clapperboard size={19} /><span><strong>{item.title}</strong><small>{PRODUCT.productionTypes[item.production_type]} · {PRODUCT.approvals[item.approval]}</small></span><span className="work-action">{item.approval === 'needs_review' || item.approval === 'changed_after_approval' ? 'Review' : 'Continue'}<ArrowUpRight size={15} /></span></Link>)}</div> : <EmptyState title="Your first production starts here">Describe it above and Direct This. Your next meaningful actions will appear here.</EmptyState>}
    </section>
  </div>;
}
type ProjectFilter = 'all' | 'draft' | 'review' | 'approved' | 'changed' | 'archived';
export function ProjectsPage({ studio = false }: { studio?: boolean }) {
  const { workspaceId } = useAuth(); const navigate = useNavigate();
  const [items, setItems] = useState<Production[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const [hasLoadWorkspace, setHasLoadWorkspace] = useState<string | null>(null);
  const [title, setTitle] = useState(''); const [busy, setBusy] = useState(false); const [page, setPage] = useState(0); const [refresh, setRefresh] = useState(0);
  const [confirmArchive,setConfirmArchive]=useState<Production|null>(null);
  const [renamingId,setRenamingId]=useState<string|null>(null);const [renamingTitle,setRenamingTitle]=useState('');const [savingRename,setSavingRename]=useState(false);
  const [filter, setFilter] = useState<ProjectFilter>('all');  const [searchInput, setSearchInput] = useState(''); const [search, setSearch] = useState('');
  useEffect(() => { const timer = window.setTimeout(() => { setSearch(searchInput.trim()); setPage(0); }, 150); return () => window.clearTimeout(timer); }, [searchInput]);
  const options = useMemo(() => ({
    search: search || undefined,
    lifecycle: filter === 'archived' ? 'archived' as const : 'active' as const,
    approvals: (filter === 'draft' ? ['draft'] : filter === 'review' ? ['needs_review'] : filter === 'approved' ? ['approved'] : filter === 'changed' ? ['changed_after_approval'] : undefined) as Database['tonde']['Enums']['approval'][] | undefined,
  }), [search, filter]);
  useEffect(() => {
    if (!workspaceId) { setItems([]); setLoading(false); setError(null); setHasLoadWorkspace(null); return; }
    let active = true; setLoading(true); setError(null);
    productionService.list(workspaceId, page * PAGE_SIZE, options).then(data => { if (active) { setItems(data); setHasLoadWorkspace(workspaceId); } }).catch(e => { if (active) setError(safeError(e).message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceId, page, refresh, options]);
  const create = (event: FormEvent) => {
    event.preventDefault(); if (!workspaceId || !title.trim()) return;
    setBusy(true); setError(null);
    productionService.create(workspaceId, title).then(id => navigate(`/studio/${id}`)).catch(e => setError(safeError(e).message)).finally(() => setBusy(false));
  };
  const selected = workspaceId ? localStorage.getItem(`tonde:${workspaceId}:production`) : null;
  const filterOptions: Array<[ProjectFilter, string]> = [['all','All'],['draft','Draft'],['review','Needs Review'],['approved','Approved'],['changed','Changed After Approval'],['archived','Archived']];
  const restore = (production: Production) => { void productionService.restore(production).then(() => setRefresh(v => v + 1)).catch(e => setError(safeError(e).message)); };
  const rename=async(event:FormEvent,production:Production)=>{event.preventDefault();if(!renamingTitle.trim())return;setSavingRename(true);setError(null);try{await productionService.saveTitle(production,renamingTitle);setRenamingId(null);setRenamingTitle('');setRefresh(value=>value+1);}catch(failure){setError(safeError(failure).message);}finally{setSavingRename(false);}};
  return <div className="page"><header className="compact-header"><p className="eyebrow">{studio ? 'THE PRODUCTION WORKSPACE' : 'ORGANIZE THE CREATIVE WORK'}</p><h1>{studio ? 'Studio' : 'Projects'}</h1><p>{studio ? 'Choose a Production. Open directly into the Studio.' : 'Find and manage your Productions. Open Studio to make changes.'}</p></header>
    {!studio && <form className="production-search" role="search" onSubmit={e => e.preventDefault()}><label htmlFor="project-search">Search productions</label><span><Search size={17} /><input id="project-search" value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Search by production name" /><button type="button" aria-label="Clear search" onClick={() => setSearchInput('')} disabled={!searchInput}><X size={15} /></button></span></form>}
    <form className="inline-form" onSubmit={create}><label>{studio ? 'Production title' : 'Start a production'}<input value={title} onChange={e => setTitle(e.target.value)} maxLength={160} required placeholder="What are you making?" disabled={!workspaceId} /></label><button className="primary" disabled={!workspaceId || busy || !title.trim()} title={!workspaceId ? 'Connect a Supabase workspace to create a Production' : undefined}><Plus size={16} />{busy ? 'Creating…' : 'DIRECT THIS'}</button></form>{!workspaceId && <p className="subtle" role="status">Local preview only — connect a Supabase workspace to create and manage Productions.</p>}
    {studio && selected && <Link className="text-link" to={`/studio/${selected}`}>Continue selected production <ArrowUpRight size={15} /></Link>}
    {!studio && <><div className="filter-bar" role="group" aria-label="Production approval filter">{filterOptions.map(([value,label]) => <button type="button" key={value} className={filter === value ? 'selected' : ''} aria-pressed={filter === value} onClick={() => { setFilter(value); setPage(0); }}>{label}</button>)}</div><p className="subtle">Rename, archive and restore are available. Duplicate and permanent delete are not offered; production history is retained.</p></>}
    {!workspaceId && <EmptyState title="Connect a workspace to browse Productions">Supabase is not configured for this preview. Production data stays unavailable rather than being simulated.</EmptyState>}
    {error && <ErrorState message={error} retry={() => setRefresh(v => v + 1)} />}
    {workspaceId && loading ? <LoadingState label="Loading productions…" /> : workspaceId && items.length ? <div className="production-list">{items.map(production => <div className="production-row" key={production.id}><Clapperboard size={22} />{renamingId===production.id?<form className="production-rename" onSubmit={event=>void rename(event,production)}><label>Production name<input aria-label={`New name for ${production.title}`} maxLength={160} autoFocus value={renamingTitle} onChange={event=>setRenamingTitle(event.target.value)}/></label><button className="primary" disabled={savingRename||!renamingTitle.trim()}>{savingRename?'Saving…':'Save name'}</button><button type="button" disabled={savingRename} onClick={()=>setRenamingId(null)}>Cancel</button></form>:<Link to={`/studio/${production.id}`}><h2>{production.title}</h2><p>{PRODUCT.productionTypes[production.production_type]} · {formatRuntime(production.planned_duration_ms)} · Updated {new Date(production.updated_at).toLocaleDateString()}</p></Link>}<span className="pill">{PRODUCT.approvals[production.approval]}</span>{filter === 'archived' ? <button aria-label={`Restore ${production.title}`} onClick={() => restore(production)}><ArchiveRestore size={15} /> Restore</button> : <><button aria-label={`Rename ${production.title}`} onClick={()=>{setRenamingId(production.id);setRenamingTitle(production.title);}}>Rename</button><button aria-label={`Archive ${production.title}`} onClick={() => setConfirmArchive(production)}><Archive size={15} /> Archive</button></>}<Link className="open-studio" aria-label={`Open Studio for ${production.title}`} to={`/studio/${production.id}`}>Open Studio <ArrowUpRight size={15} /></Link></div>)}</div> : workspaceId && !error && hasLoadWorkspace === workspaceId && <EmptyState title={search ? 'No productions match that search' : filter === 'archived' ? 'No archived productions' : filter === 'review' ? 'No Productions need review' : filter === 'approved' ? 'No approved Productions yet' : filter === 'changed' ? 'No Productions changed after approval' : 'Room for your first production'}>{search ? 'Try a different title or clear the search.' : 'Projects help you find and manage work; Productions open directly in Studio.'}</EmptyState>}
    {confirmArchive&&<div className="command-scrim" onMouseDown={event=>{if(event.target===event.currentTarget)setConfirmArchive(null);}}><section className="notification-dialog" role="dialog" aria-modal="true" aria-labelledby="archive-production-title"><div className="notification-heading"><h2 id="archive-production-title">Archive {confirmArchive.title}?</h2><button type="button" aria-label="Cancel archive" onClick={()=>setConfirmArchive(null)}><X size={17}/></button></div><p>Archiving hides this Production from active lists. Its production history and reusable Assets are retained; you can restore it later.</p>{error&&<p role="alert" className="error-text">{error}</p>}<div className="dialog-actions"><button type="button" onClick={()=>setConfirmArchive(null)}>Cancel</button><button type="button" className="danger-action" onClick={()=>{void productionService.archive(confirmArchive).then(()=>{setConfirmArchive(null);setRefresh(v=>v+1);}).catch(failure=>setError(safeError(failure).message));}}>Archive Production</button></div></section></div>}
    <div className="pagination"><button disabled={page === 0 || loading} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {page + 1}</span><button disabled={items.length < PAGE_SIZE || loading} onClick={() => setPage(p => p + 1)}>Next</button></div>
  </div>;
}
const copy = {
  discover: ['Discover', 'A place for production inspiration.', 'Reference discovery and analysis arrive in later prompts. Nothing is imported or analyzed automatically.'],
  assets: ['Assets', 'Reusable identities. Consistent productions.', 'Characters, voices, products, environments, wardrobe, props, vehicles, style bibles, and brand assets share a durable workspace identity. The asset library interface comes next.'],
  setup: ['Setup', 'What you make productions with.', 'Cameras, lenses, lighting, audio, stabilization, software, AI tools, and equipment kits belong here. Environments belong to productions or Assets—not Setup.'],
  settings: ['Settings', 'Your application preferences.', 'Appearance, notifications, and account preferences are separate from production capability. Their persistent foundation is ready; the complete settings experience comes later.'],
  account: ['Account / profile', 'Your TONDE identity.', 'Supabase manages your authentication. The application profile stores display name, locale, timezone, and onboarding state.'],
  help: ['Help / support', 'A clear foundation for your work.', 'TONDE is being built in a staged sequence. Intelligence, generation, and export controls are intentionally unavailable until their services are implemented.'],
} as const;
const assetCategories = Object.entries(PRODUCT.assetTypes) as Array<[keyof typeof PRODUCT.assetTypes, string]>;
const PRODUCT_RESOURCE_OPTIONS: Database['tonde']['Enums']['resource_type'][] = ['camera','phone_camera','lens','light','modifier','stand','microphone','recorder','wireless_audio','gimbal','tripod','monopod','slider','drone','action_camera','filter','monitor','rigging','accessory','editing_software','photo_software','ai_tool'];
function resourceTypeLabel(value:Database['tonde']['Enums']['resource_type']) {
  const labels:Record<Database['tonde']['Enums']['resource_type'],string>={camera:'Camera',phone_camera:'Phone camera',lens:'Lens',light:'Light',modifier:'Light modifier',stand:'Stand',microphone:'Microphone',recorder:'Audio recorder',wireless_audio:'Wireless audio',gimbal:'Gimbal',tripod:'Tripod',monopod:'Monopod',slider:'Slider',drone:'Drone',action_camera:'Action camera',filter:'Filter',monitor:'Monitor',rigging:'Rigging',accessory:'Accessory',editing_software:'Editing software',photo_software:'Photo software',ai_tool:'AI tool'};
  return labels[value];
}
const resourceCategories = [
  { key: 'camera', label: 'Cameras & Phones', values: ['camera','phone_camera'] },
  { key: 'lens', label: 'Lenses', values: ['lens'] },
  { key: 'light', label: 'Lighting', values: ['light','modifier','stand'] },
  { key: 'microphone', label: 'Audio', values: ['microphone','recorder','wireless_audio'] },
  { key: 'gimbal', label: 'Stabilization', values: ['gimbal','tripod','monopod','slider'] },
  { key: 'drone', label: 'Drones', values: ['drone'] },
  { key: 'action_camera', label: 'Action Cameras', values: ['action_camera'] },
  { key: 'accessory', label: 'Filters / Monitors / Rigging / Accessories', values: ['filter','monitor','rigging','accessory'] },
  { key: 'editing_software', label: 'Editing Software', values: ['editing_software'] },
  { key: 'photo_software', label: 'Photo Software', values: ['photo_software'] },
  { key: 'ai_tool', label: 'AI Tools', values: ['ai_tool'] },
] as const;
function referenceProvider(value:string) {
  try { const host=new URL(value).hostname.toLowerCase().replace(/^www\./,'');if(host==='youtube.com'||host==='youtu.be'||host.endsWith('.youtube.com'))return 'YouTube reference';if(host==='tiktok.com'||host.endsWith('.tiktok.com'))return 'TikTok reference';if(host==='instagram.com'||host.endsWith('.instagram.com'))return 'Instagram reference';if(host==='vimeo.com'||host.endsWith('.vimeo.com'))return 'Vimeo reference';return 'Reference URL'; } catch { return 'Reference URL'; }
}
function orderWork(items: Production[]) {
  const actionable=items.filter(item=>item.approval!=='approved');
  const priority: Record<Production['approval'], number> = { needs_review: 0, changed_after_approval: 1, draft: 2, approved: 3 };
  return [...actionable].sort((a, b) => priority[a.approval] - priority[b.approval] || b.updated_at.localeCompare(a.updated_at));
}
function isReferenceUrl(value:string) {
  try { const parsed=new URL(value.trim());return (parsed.protocol==='https:'||parsed.protocol==='http:')&&!!parsed.hostname; } catch { return false; }
}
function intakeProvenance(): Row<'production_references'>['provenance'] | null {
  try {
    const context = JSON.parse(localStorage.getItem('tonde:intake-context') || 'null') as { origin?: string; technique?: string } | null;
    return context?.technique ? { origin: context.origin ?? 'discover', reference_kind: 'production_technique', technique_name: context.technique } : null;
  } catch { return null; }
}
export function DiscoverPage() {
  const { workspaceId } = useAuth(); const navigate = useNavigate();
  const [tab,setTab]=useState<'techniques'|'saved-techniques'|'references'>('techniques'); const [search,setSearch]=useState(''); const [references,setReferences]=useState<Row<'production_references'>[]>([]); const [busy,setBusy]=useState(false); const [error,setError]=useState<string|null>(null);
  useEffect(()=>{if(!workspaceId)return;let active=true;setBusy(true);productionService.listReferences(workspaceId).then(items=>{if(active)setReferences(items);}).catch(failure=>{if(active)setError(safeError(failure).message);}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;}},[workspaceId]);
  const techniques=[
    {name:'Product Orbit',purpose:'Reveal shape, material and finish through controlled camera movement.',best:'A small hero product with a clear silhouette.',real:'Slow slider or turntable move; lock exposure and reflections.',ai:'Describe one smooth orbit direction and preserve label geometry.',tags:['product','camera movement','commercial']},
    {name:'Handheld Tension',purpose:'Make a moment feel immediate and unstable without losing subject readability.',best:'A character under pressure or entering unfamiliar space.',real:'Restrained handheld drift with deliberate frame-left/right geography.',ai:'Specify subtle operator movement, not uncontrolled shake.',tags:['performance','movement','story']},
    {name:'Overhead Food Shot',purpose:'Show ingredients, arrangement and process clearly from above.',best:'Food preparation and tabletop compositions.',real:'Secure an overhead camera; diffuse the key and manage utensil shadows.',ai:'Describe the surface layout, top-down camera and clean shadow direction.',tags:['food','composition','lighting']},
    {name:'Silhouette Reveal',purpose:'Introduce a subject through shape before revealing identifying detail.',best:'A dramatic entrance or suspenseful reveal.',real:'Backlight through haze only when safe and practical; expose for the outline.',ai:'Hold the face in shadow, then define the reveal in a later shot.',tags:['lighting','story','reveal']},
    {name:'Match Cut',purpose:'Connect two shots through a repeated shape, movement or composition.',best:'A transition that carries an idea across time or place.',real:'Plan corresponding frame position and action end/start states.',ai:'State the visual match and preserve continuity across both shots.',tags:['editing','transition','continuity']},
    {name:'Dolly Zoom',purpose:'Create a perspective shift while keeping subject scale relatively stable.',best:'A deliberate moment of disorientation.',real:'Coordinate dolly travel and zoom with rehearsal; requires controlled space.',ai:'Specify the changing background perspective and stable subject size.',tags:['camera','lens','movement']},
  ];
  const filteredTechniques=techniques.filter(item=>`${item.name} ${item.purpose} ${item.tags.join(' ')}`.toLowerCase().includes(search.toLowerCase()));
  const [savedIds,setSavedIds]=useState<string[]>(()=>readSavedTechniques());
  const save=(name:string)=>{const next=savedIds.includes(name)?savedIds.filter(item=>item!==name):[...savedIds,name];setSavedIds(next);localStorage.setItem('tonde:saved-discover',JSON.stringify(next));setError(null);};
  const startWith=(description:string,technique?:string)=>{localStorage.setItem('tonde:intake-context',JSON.stringify({description,origin:'discover',technique}));navigate('/home');};
  return <div className="page"><header className="compact-header"><p className="eyebrow">PRODUCTION KNOWLEDGE & REFERENCES</p><h1>Discover</h1><p>Techniques and reference material to help you direct original work.</p></header><div className="discover-toolbar"><label>Search production knowledge<input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Product reveal, handheld tension, match cut…" /></label><div role="tablist" aria-label="Discover collection">{(['techniques','saved-techniques','references'] as const).map(value=><button key={value} role="tab" aria-selected={tab===value} className={tab===value?'selected':''} onClick={()=>setTab(value)}>{value==='techniques'?'Techniques':value==='saved-techniques'?'Saved Techniques':'Production References'}</button>)}</div></div>
    {error&&<ErrorState message={error} retry={()=>setError(null)}/ >}{tab==='techniques'?<section className="technique-list" aria-label="Production techniques">{filteredTechniques.map(item=><article className="technique-row" key={item.name}><div><p className="eyebrow">{item.tags.join(' · ')}</p><h2>{item.name}</h2><p>{item.purpose}</p><small>Best use · {item.best}</small><details><summary>Execution notes</summary><p><strong>Real Production:</strong> {item.real}</p><p><strong>AI Creation:</strong> {item.ai}</p></details></div><div className="technique-actions"><button onClick={()=>save(item.name)} aria-pressed={savedIds.includes(item.name)}>{savedIds.includes(item.name)?'Saved':'Save'}</button><button className="primary" onClick={()=>startWith(`Use the ${item.name} technique: ${item.purpose}`,item.name)}>Direct This</button></div></article>)}{!filteredTechniques.length&&<EmptyState title="No techniques match that search">Try another production term.</EmptyState>}</section>:tab==='saved-techniques'?<><p className="subtle">Saved techniques are stored in this browser; they are not Production References.</p><section className="technique-list" aria-label="Saved techniques">{techniques.filter(item=>savedIds.includes(item.name)&&`${item.name} ${item.purpose} ${item.tags.join(' ')}`.toLowerCase().includes(search.toLowerCase())).map(item=><article className="technique-row" key={item.name}><div><p className="eyebrow">{item.tags.join(' · ')}</p><h2>{item.name}</h2><p>{item.purpose}</p><small>Best use · {item.best}</small></div><div className="technique-actions"><button onClick={()=>save(item.name)} aria-pressed="true">Remove saved</button><button className="primary" onClick={()=>startWith(`Use the ${item.name} technique: ${item.purpose}`,item.name)}>Direct This</button></div></article>)}{!techniques.some(item=>savedIds.includes(item.name)&&`${item.name} ${item.purpose} ${item.tags.join(' ')}`.toLowerCase().includes(search.toLowerCase()))&&<EmptyState title={savedIds.some(name=>techniques.some(item=>item.name===name))?'No saved techniques match that search':'No saved techniques yet'}>Save a production technique to keep it handy in this browser.</EmptyState>}</section></>:busy?<LoadingState label="Loading saved references…"/>:references.length?<div className="library-list">{references.filter(reference=>!search||`${reference.source_url||''} ${reference.source_description||''} ${reference.source_type}`.toLowerCase().includes(search.toLowerCase())).map(reference=><article className="library-row reference-row" key={reference.id}><span><strong>{reference.source_description||reference.source_url||'Saved reference'}</strong><small>{reference.source_type} · {reference.rights_classification.replaceAll('_',' ')} · {reference.state}</small><small>Associated with an authorized TONDE Production</small></span><span className="pill">Not analyzed here</span><button onClick={()=>startWith(`Create original work inspired by this reference: ${reference.source_description||reference.source_url||'saved reference'}`)}>Direct This</button></article>)}</div>:<EmptyState title="No Production References yet">References belong to individual Productions. Discover techniques you save are listed separately in Saved Techniques.</EmptyState>}
  </div>;
}
function readSavedTechniques(): string[] {
  try { const parsed: unknown = JSON.parse(localStorage.getItem('tonde:saved-discover') || '[]'); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []; }
  catch { return []; }
}
export function FoundationPage({ area }: { area: keyof typeof copy }) {
  const [title, subtitle, description] = copy[area];
  if (area === 'assets') return <AssetsLibrary />;
  if (area === 'setup') return <SetupLibrary />;
  if (area === 'settings') return <SettingsFoundation />;
  return <div className="page"><header className="compact-header"><p className="eyebrow">TONDE FOUNDATION</p><h1>{title}</h1><p>{subtitle}</p></header><EmptyState title="The foundation is ready">{description}</EmptyState></div>;
}
function AssetsLibrary() {
  const { workspaceId } = useAuth();
  const [category,setCategory]=useState<string>('all'); const [search,setSearch]=useState(''); const [items,setItems]=useState<Row<'assets'>[]>([]); const [busy,setBusy]=useState(true); const [error,setError]=useState<string|null>(null); const [selected,setSelected]=useState<Row<'assets'>|null>(null); const [assetUsage,setAssetUsage]=useState<number|null>(null);const [archiveAsset,setArchiveAsset]=useState<Row<'assets'>|null>(null);const [adding,setAdding]=useState(false); const [saving,setSaving]=useState(false); const [name,setName]=useState(''); const [kind,setKind]=useState<keyof typeof PRODUCT.assetTypes>('character');
  const drawerRef=useRef<HTMLDivElement>(null);const archiveDialogRef=useRef<HTMLElement>(null);const [drawerRestoreTarget,setDrawerRestoreTarget]=useState<HTMLElement|null>(null);const [archiveRestoreTarget,setArchiveRestoreTarget]=useState<HTMLElement|null>(null);
  useModalFocus(!!selected&&!archiveAsset,drawerRestoreTarget,drawerRef,'.drawer-close');useModalFocus(!!archiveAsset,archiveRestoreTarget,archiveDialogRef);
  const load=async()=>{if(!workspaceId){setItems([]);setBusy(false);setError(null);return;}setBusy(true);setError(null);try{let query=requireSupabase().from('assets').select('*').eq('workspace_id',workspaceId).eq('lifecycle','active').order('updated_at',{ascending:false}).limit(40);if(category!=='all')query=query.eq('asset_type',category as never);if(search.trim())query=query.ilike('name',`%${search.trim().replace(/[\\%_]/g,'\\$&')}%`);const {data,error}=await query; if(error)throw error;setItems(data??[]);}catch(failure){setError(safeError(failure).message);}finally{setBusy(false);}};
  useEffect(()=>{const timer=window.setTimeout(()=>{void load();},search?250:0);return()=>window.clearTimeout(timer);},[workspaceId,category,search]);
  const create=async(event:FormEvent)=>{event.preventDefault();if(!workspaceId||!name.trim())return;setSaving(true);setError(null);try{const {data,error}=await requireSupabase().from('assets').insert({workspace_id:workspaceId,asset_type:kind,name:name.trim()}).select().single();if(error)throw error;setName('');setSelected(data);await load();}catch(failure){setError(safeError(failure).message);}finally{setSaving(false);}};
  const openAsset=async(asset:Row<'assets'>,trigger:HTMLElement)=>{setDrawerRestoreTarget(trigger);setSelected(asset);setAssetUsage(null);if(!workspaceId)return;try{const {count,error}=await requireSupabase().from('scope_bindings').select('id',{count:'exact',head:true}).eq('workspace_id',workspaceId).eq('asset_id',asset.id);if(error)throw error;setAssetUsage(count??0);}catch(failure){setError(safeError(failure).message);}};
  return <div className="page"><header className="compact-header"><p className="eyebrow">REUSABLE PRODUCTION ENTITIES</p><h1>Assets</h1><p>Reusable identities for people, places, products, and creative language. Cameras and software live in Setup.</p></header>{!workspaceId&&<p className="capability-note" role="status">Local preview only — connect a Supabase workspace to browse or save reusable Assets.</p>}<div className="asset-toolbar"><label>Filter assets<select value={category} onChange={e=>setCategory(e.target.value)}><option value="all">All asset types</option>{assetCategories.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label className="asset-search">Search assets<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Find an asset" /></label><button type="button" className="primary" disabled={!workspaceId} title={!workspaceId?'Connect a Supabase workspace to save Assets':undefined} onClick={()=>setAdding(v=>!v)}><Plus size={16}/>{adding?'Cancel':'Add Asset'}</button></div>{adding&&<form className="inline-form asset-create" onSubmit={create}><label>Asset name<input autoFocus required maxLength={160} value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Marcus" /></label><label>Asset type<select value={kind} onChange={e=>setKind(e.target.value as keyof typeof PRODUCT.assetTypes)}>{assetCategories.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><button className="primary" disabled={!workspaceId||saving||!name.trim()}>{saving?'Saving…':'Save asset'}</button></form>}{error&&<ErrorState message={error} retry={()=>void load()}/ >}{busy?<LoadingState label="Loading assets…"/>:items.length?<div className="library-list">{items.map(item=><button key={item.id} className="library-row" onClick={event=>void openAsset(item,event.currentTarget)}><span><strong>{item.name}</strong><small>{PRODUCT.assetTypes[item.asset_type as keyof typeof PRODUCT.assetTypes]} · Updated {new Date(item.updated_at).toLocaleDateString()}</small></span><span className="pill">{PRODUCT.approvals[item.approval]}</span><ArrowUpRight size={16}/></button>)}</div>:!error&&<EmptyState title={category==='character'?'No characters saved':category==='product'?'No products saved':`No ${category==='all'?'assets':PRODUCT.assetTypes[category as keyof typeof PRODUCT.assetTypes]?.toLowerCase()+' saved'}`}><p>Reusable Assets keep production identities consistent. Add an entity when you want to reference it across productions.</p><button className="primary" disabled={!workspaceId} onClick={()=>setAdding(true)}><Plus size={15}/>Add Asset</button></EmptyState>}{selected&&<div ref={drawerRef} className="detail-drawer" role="dialog" aria-modal="true" aria-label={`${selected.name} asset details`}><button className="drawer-close" aria-label="Close asset details" onClick={()=>setSelected(null)}><X size={18}/></button><p className="eyebrow">{PRODUCT.assetTypes[selected.asset_type as keyof typeof PRODUCT.assetTypes]}</p><h2>{selected.name}</h2><p>{selected.description||'No additional description.'}</p><p className="subtle">{assetUsage===null?'Checking Production use…':assetUsage===0?'Not currently bound to a Production.':'Bound in '+assetUsage+' Production scope(s). Existing snapshots are not rewritten when this library identity changes.'}</p><button onClick={event=>{setArchiveRestoreTarget(event.currentTarget);setArchiveAsset(selected);}}><Archive size={15}/>Archive Asset</button></div>}{archiveAsset&&<div className="command-scrim" onMouseDown={event=>{if(event.target===event.currentTarget)setArchiveAsset(null);}}><section ref={archiveDialogRef} className="notification-dialog" role="dialog" aria-modal="true" aria-labelledby="archive-asset-title"><div className="notification-heading"><h2 id="archive-asset-title">Archive {archiveAsset.name}?</h2><button type="button" aria-label="Cancel archive" onClick={()=>setArchiveAsset(null)}><X size={17}/></button></div><p>{assetUsage===null?'Production usage could not be confirmed. Cancel and retry before archiving.':assetUsage>0?`This Asset is bound in ${assetUsage} Production scope(s). Archive will not delete its identity or media, but it may affect future selections.`:'This Asset is not currently bound to a Production.'}</p><div className="dialog-actions"><button type="button" onClick={()=>setArchiveAsset(null)}>Cancel</button><button type="button" className="danger-action" disabled={assetUsage===null} onClick={async()=>{try{const {error}=await requireSupabase().from('assets').update({lifecycle:'archived'}).eq('workspace_id',workspaceId!).eq('id',archiveAsset.id);if(error)throw error;setArchiveAsset(null);setSelected(null);await load();}catch(failure){setError(safeError(failure).message);}}}>Archive Asset</button></div></section></div>}</div>;
}
function SetupLibrary(){
  const {workspaceId}=useAuth();  const [category,setCategory]=useState<string>('all');const [items,setItems]=useState<Row<'production_resources'>[]>([]);const [kitResources,setKitResources]=useState<Row<'kit_resources'>[]>([]);const [kits,setKits]=useState<Row<'equipment_kits'>[]>([]);const [search,setSearch]=useState('');const [kitSearch,setKitSearch]=useState('');const [busy,setBusy]=useState(true);const [error,setError]=useState<string|null>(null);const [adding,setAdding]=useState(false);const [saving,setSaving]=useState(false);const [name,setName]=useState('');const [kind,setKind]=useState<Database['tonde']['Enums']['resource_type']>('camera');
  const load=async()=>{if(!workspaceId){setItems([]);setKits([]);setKitResources([]);setBusy(false);setError(null);return;}setBusy(true);setError(null);try{let query=requireSupabase().from('production_resources').select('*').eq('workspace_id',workspaceId).eq('lifecycle','active').order('updated_at',{ascending:false}).limit(40);if(category!=='all'){const group=resourceCategories.find(item=>item.key===category);if(group)query=query.in('resource_type',[...group.values] as never);}if(search.trim())query=query.ilike('name',`%${search.trim().replace(/[\\%_]/g,'\\$&')}%`);const [resources,kitsResult,memberships]=await Promise.all([query,requireSupabase().from('equipment_kits').select('*').eq('workspace_id',workspaceId).eq('lifecycle','active').order('name').limit(40),requireSupabase().from('kit_resources').select('*').eq('workspace_id',workspaceId)]);if(resources.error)throw resources.error;if(kitsResult.error)throw kitsResult.error;if(memberships.error)throw memberships.error;setItems(resources.data??[]);setKits(kitsResult.data??[]);setKitResources(memberships.data??[]);}catch(failure){setError(safeError(failure).message);}finally{setBusy(false);}};
  useEffect(()=>{const timer=window.setTimeout(()=>{void load();},search?250:0);return()=>window.clearTimeout(timer);},[workspaceId,category,search]);
  const create=async(event:FormEvent)=>{event.preventDefault();if(!workspaceId||!name.trim())return;setSaving(true);setError(null);try{const {error}=await requireSupabase().from('production_resources').insert({workspace_id:workspaceId,resource_type:kind,name:name.trim()});if(error)throw error;setName('');setAdding(false);await load();}catch(failure){setError(safeError(failure).message);}finally{setSaving(false);}};
  const [kitName,setKitName]=useState('');const [addingKit,setAddingKit]=useState(false);const [kitError,setKitError]=useState<string|null>(null);const [kitSelection,setKitSelection]=useState<Record<string,string>>({});const [kitBusy,setKitBusy]=useState<string|null>(null);
  const availableKitItems=items.filter(resource=>`${resource.name} ${resource.manufacturer??''} ${resource.model??''}`.toLowerCase().includes(kitSearch.toLowerCase()));
  const makeKit=async(event:FormEvent)=>{event.preventDefault();if(!kitName.trim()||!workspaceId)return;setKitError(null);setAddingKit(true);try{const {error}=await requireSupabase().from('equipment_kits').insert({workspace_id:workspaceId,name:kitName.trim()});if(error)throw error;setKitName('');setAddingKit(false);await load();}catch(failure){setKitError(safeError(failure).message);}finally{setAddingKit(false);}};
  const changeKitMembership=async(kitId:string,resourceId:string,remove=false)=>{if(!workspaceId)return;setKitBusy(kitId);setKitError(null);try{const client=requireSupabase();const result=remove?await client.from('kit_resources').delete().eq('workspace_id',workspaceId).eq('kit_id',kitId).eq('resource_id',resourceId):await client.from('kit_resources').insert({workspace_id:workspaceId,kit_id:kitId,resource_id:resourceId});if(result.error)throw result.error;await load();}catch(failure){setKitError(safeError(failure).message);}finally{setKitBusy(null);}};
  return <div className="page"><header className="compact-header"><p className="eyebrow">PRODUCTION CAPABILITIES</p><h1>Setup</h1><p>What TONDE can assume you have access to. Setup is optional and can grow as you work.</p></header>{!workspaceId&&<p className="capability-note" role="status">Local preview only — connect a Supabase workspace to manage production tools and kits.</p>}<div className="asset-toolbar"><label>Tool category<select value={category} onChange={e=>setCategory(e.target.value)}><option value="all">All tools</option>{resourceCategories.map(({key,label})=><option key={key} value={key}>{label}</option>)}</select></label><label className="asset-search">Search setup<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Camera, software, AI tool…" /></label><button type="button" className="primary" disabled={!workspaceId} title={!workspaceId?'Connect a Supabase workspace to save tools':undefined} onClick={()=>setAdding(v=>!v)}><Plus size={15}/>Add Tool</button><button type="button" disabled={!workspaceId} title={!workspaceId?'Connect a Supabase workspace to save kits':undefined} onClick={()=>setAddingKit(value=>!value)}>Create Kit</button></div>{addingKit&&<form className="inline-form asset-create" onSubmit={makeKit}><label>Kit name<input required value={kitName} onChange={event=>setKitName(event.target.value)} placeholder="Travel Kit" /></label><button className="primary" disabled={!workspaceId||!kitName.trim()||addingKit}>{addingKit?'Creating…':'Create Kit'}</button></form>}{kitError&&<p className="error-text" role="alert">{kitError}</p>}{adding&&<form className="inline-form" onSubmit={create}><label>Tool name<input required value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Sony A6700" /></label><label>Tool type<select value={kind} onChange={e=>setKind(e.target.value as Database['tonde']['Enums']['resource_type'])}>{PRODUCT_RESOURCE_OPTIONS.map(value=><option key={value} value={value}>{resourceTypeLabel(value)}</option>)}</select></label><button className="primary" disabled={!workspaceId||!name.trim()||saving}>{saving?'Saving…':'Save tool'}</button></form>}{error&&<ErrorState message={error} retry={()=>void load()}/ >}{busy?<LoadingState label="Loading your Setup…"/>:items.length?<div className="library-list">{items.map(item=><div className="library-row" key={item.id}><span><strong>{item.name}</strong><small>{resourceTypeLabel(item.resource_type)}{item.manufacturer?` · ${item.manufacturer}`:''}{item.model?` ${item.model}`:''}</small></span><span className="pill">{item.lifecycle}</span><button aria-label={`Edit ${item.name}`} onClick={()=>{const next=window.prompt('Edit tool name',item.name);if(next?.trim()){void (async()=>{try{const {error}=await requireSupabase().from('production_resources').update({name:next.trim()}).eq('workspace_id',workspaceId!).eq('id',item.id);if(error)throw error;await load();}catch(failure){setError(safeError(failure).message);}})();}}}>Edit</button></div>)}</div>:!error&&<EmptyState title="TONDE doesn't know your equipment yet">Cameras, lenses, audio, lighting, editing and AI tools can adapt future production direction. Add only what you have.</EmptyState>}<section className="kit-section"><div className="section-heading"><div><p className="eyebrow">REUSABLE GROUPS</p><h2>Equipment Kits</h2></div><span>{kits.length} kits</span></div>{kits.length?<ul className="kit-list">{kits.map(kit=>{const members=kitResources.filter(membership=>membership.kit_id===kit.id);const currentSelection=kitSelection[kit.id]??'';return <li key={kit.id}><strong>{kit.name}</strong><div className="kit-members"><span>{members.length?members.map(membership=>{const resource=items.find(item=>item.id===membership.resource_id);return <span className="kit-member" key={membership.resource_id}>{resource?.name??'Setup item'}{membership.quantity>1?` × ${membership.quantity}`:''}<button type="button" aria-label={`Remove ${resource?.name??'item'} from ${kit.name}`} disabled={kitBusy===kit.id} onClick={()=>void changeKitMembership(kit.id,membership.resource_id,true)}><X size={13}/></button></span>;}):<small>No tools in this kit yet.</small>}</span><label className="sr-only" htmlFor={`kit-resource-${kit.id}`}>Setup item for {kit.name}</label><select id={`kit-resource-${kit.id}`} value={currentSelection} onChange={event=>setKitSelection(value=>({...value,[kit.id]:event.target.value}))}><option value="">Choose a Setup item</option>{availableKitItems.filter(resource=>!members.some(member=>member.resource_id===resource.id)).map(resource=><option value={resource.id} key={resource.id}>{resource.name}</option>)}</select><input aria-label={`Search Setup items for ${kit.name}`} value={kitSearch} onChange={event=>setKitSearch(event.target.value)} placeholder="Search Setup items"/><button type="button" disabled={!currentSelection||kitBusy===kit.id} onClick={()=>void changeKitMembership(kit.id,currentSelection)}>{kitBusy===kit.id?'Saving…':'Add item'}</button></div></li>;})}</ul>:<p className="subtle">Create kits such as Travel, Interview or Studio. Kits reference Setup items instead of duplicating them.</p>}</section></div>;
}
function SettingsFoundation(){
 const {session}=useAuth();
 const {section:routeSection}=useParams();
 const navigate=useNavigate();
 const validSections=['account','appearance','notifications','connections','storage','privacy','billing','help'];
 const [section,setSection]=useState(validSections.includes(routeSection??'')?routeSection!:'account');  const [accountReady,setAccountReady]=useState(false);
  const [appearance,setAppearance]=useState<'dark'|'light'|'system'>(()=>{const saved=localStorage.getItem('tonde:appearance');return saved==='light'||saved==='system'?saved:'dark';});
  const [reducedMotion,setReducedMotion]=useState(false);
 const [displayName,setDisplayName]=useState('');
 const [savingName,setSavingName]=useState(false);
 const [emailNotifications,setEmailNotifications]=useState(true);
 const [inAppNotifications,setInAppNotifications]=useState(true);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState<string|null>(null);
 const [notice,setNotice]=useState<string|null>(null);
 const sections=[['account','Account'],['appearance','Appearance'],['notifications','Notifications'],['connections','Connections'],['storage','Storage & Data'],['privacy','Privacy & Security'],['billing','Billing'],['help','Help']];
 useEffect(()=>{if(routeSection&&validSections.includes(routeSection))setSection(routeSection);else if(routeSection)navigate('/settings/account',{replace:true});},[routeSection,navigate]);
 useEffect(()=>{document.documentElement.dataset.appearance=appearance;document.documentElement.dataset.reducedMotion=String(reducedMotion);},[appearance,reducedMotion]);
 useEffect(()=>{    if(!session?.user.id){setLoading(false);return;}
  let active=true;
  const load=async()=>{setLoading(true);setError(null);try{
   const client=requireSupabase();
   const [profile,preferences]=await Promise.all([
    client.from('profiles').select('display_name').eq('user_id',session.user.id).maybeSingle(),
    client.from('user_preferences').select('appearance,email_notifications,in_app_notifications,reduced_motion').eq('user_id',session.user.id).maybeSingle(),
   ]);
   if(profile.error)throw profile.error;
   if(preferences.error)throw preferences.error;
   if(active){setDisplayName(profile.data?.display_name??'');if(preferences.data){setEmailNotifications(preferences.data.email_notifications);setInAppNotifications(preferences.data.in_app_notifications);const localMotion=localStorage.getItem('tonde:reduced-motion');if(localMotion===null){setReducedMotion(preferences.data.reduced_motion);localStorage.setItem('tonde:reduced-motion',String(preferences.data.reduced_motion));}const localAppearance=localStorage.getItem('tonde:appearance');if(!['dark','light','system'].includes(localAppearance??'')&&(preferences.data.appearance==='dark'||preferences.data.appearance==='system')){setAppearance(preferences.data.appearance);localStorage.setItem('tonde:appearance',preferences.data.appearance);}}setAccountReady(true);}
  }catch(failure){if(active)setError(safeError(failure).message);}finally{if(active)setLoading(false);}};
  void load();return()=>{active=false;};
 },[session?.user.id]);
 const saveName=async(event:FormEvent)=>{event.preventDefault();if(!session?.user.id||!displayName.trim())return;setSavingName(true);setError(null);setNotice(null);try{const client=requireSupabase();const result=accountReady?await client.from('profiles').update({display_name:displayName.trim()}).eq('user_id',session.user.id):await client.from('profiles').upsert({user_id:session.user.id,display_name:displayName.trim()});if(result.error)throw result.error;setAccountReady(true);setNotice('Display name saved.');}catch(failure){setError(safeError(failure).message);}finally{setSavingName(false);}};
 const updateNotification=async(key:'email_notifications'|'in_app_notifications',value:boolean)=>{if(!session?.user.id)return;setError(null);setNotice(null);try{const client=requireSupabase();const payload=key==='email_notifications'?{email_notifications:value}:{in_app_notifications:value};const result=accountReady?await client.from('user_preferences').update(payload).eq('user_id',session.user.id):await client.from('user_preferences').upsert({user_id:session.user.id,...payload});if(result.error)throw result.error;setAccountReady(true);if(key==='email_notifications')setEmailNotifications(value);else setInAppNotifications(value);setNotice('Notification preference saved.');}catch(failure){setError(safeError(failure).message);}};
 const setTheme=async(value:'dark'|'light'|'system')=>{const previous=appearance;setAppearance(value);localStorage.setItem('tonde:appearance',value);setError(null);if(value==='light'){setNotice('Light appearance is saved in this browser; your account preference is unchanged.');return;}setNotice('Appearance saved in this browser.');if(!session?.user.id)return;try{const client=requireSupabase();const result=accountReady?await client.from('user_preferences').update({appearance:value}).eq('user_id',session.user.id):await client.from('user_preferences').upsert({user_id:session.user.id,appearance:value});if(result.error)throw result.error;setAccountReady(true);setNotice('Appearance saved to your account and this browser.');}catch(failure){setAppearance(previous);localStorage.setItem('tonde:appearance',previous);setError(safeError(failure).message);setNotice(null);}};
 const updateReducedMotion=async(value:boolean)=>{if(!session?.user.id)return;const previous=reducedMotion;setReducedMotion(value);localStorage.setItem('tonde:reduced-motion',String(value));setError(null);setNotice(null);try{const client=requireSupabase();const result=accountReady?await client.from('user_preferences').update({reduced_motion:value}).eq('user_id',session.user.id):await client.from('user_preferences').upsert({user_id:session.user.id,reduced_motion:value});if(result.error)throw result.error;setAccountReady(true);setNotice('Motion preference saved to your account and this browser.');}catch(failure){setReducedMotion(previous);localStorage.setItem('tonde:reduced-motion',String(previous));setError(safeError(failure).message);}};
 return <div className="page"><header className="compact-header"><p className="eyebrow">APPLICATION & ACCOUNT</p><h1>Settings</h1><p>Account, privacy and application preferences — not production resources.</p></header><div className="settings-layout"><nav aria-label="Settings sections">{sections.map(([id,label])=><button type="button" key={id} className={section===id?'selected':''} aria-current={section===id?'page':undefined} onClick={()=>{setSection(id);setError(null);setNotice(null);navigate(`/settings/${id}`);}}>{label}</button>)}</nav><section className="settings-content" aria-live="polite"><h2>{sections.find(([id])=>id===section)?.[1]}</h2>{loading?<LoadingState label="Loading account preferences…"/>:<>
  {!session?.user.id&&<p className="capability-note" role="status">Local preview only — connect Supabase and sign in to load or save account settings.</p>}{error&&<p className="error-text" role="alert">{error}</p>}{notice&&<p className="subtle" role="status">{notice}</p>}
  {section==='account'&&<><p>Signed in as <strong>{session?.user.email||'your account'}</strong>.</p><form className="settings-profile-form" onSubmit={saveName}><label htmlFor="settings-display-name">Display name</label><input id="settings-display-name" maxLength={160} value={displayName} onChange={event=>setDisplayName(event.target.value)} placeholder="Your name"/><button className="primary" disabled={!session?.user.id||savingName||!displayName.trim()} title={!session?.user.id?'Sign in to save your account name':undefined}>{savingName?'Saving…':'Save name'}</button></form><p className="subtle">Password, email verification and sign-in methods are managed by Supabase Auth.</p></>}
  {section==='appearance'&&<><label>Color appearance<select aria-label="Color appearance" value={appearance} onChange={event=>void setTheme(event.target.value as typeof appearance)}><option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option></select></label><label className="settings-toggle"><input type="checkbox" checked={reducedMotion} disabled={!session?.user.id} onChange={event=>void updateReducedMotion(event.target.checked)}/> Reduce motion</label><p className="subtle">Appearance is applied in this browser. Dark and system preferences also sync to your account; the database does not yet represent an account-wide light theme.</p></>}
  {section==='notifications'&&<><p>Notification choices are saved to your account. Job, review and email delivery services are not connected yet.</p><label className="settings-toggle"><input type="checkbox" checked={inAppNotifications} disabled={!session?.user.id} onChange={event=>void updateNotification('in_app_notifications',event.target.checked)}/> In-app notifications</label><label className="settings-toggle"><input type="checkbox" checked={emailNotifications} disabled={!session?.user.id} onChange={event=>void updateNotification('email_notifications',event.target.checked)}/> Email notifications</label></>}
  {section==='connections'&&<p>No external content connections are configured. Google sign-in availability depends on the Supabase project. TONDE will not show providers as connected without verified authorization.</p>}
  {section==='storage'&&<p>Private uploads currently accept supported media up to 50 MB each. Storage usage and data exports are not available yet.</p>}
  {section==='privacy'&&<p>Workspace media remains private. Session listing, account deletion and media-retention controls require the secure account service.</p>}
  {section==='billing'&&<p>No billing provider or plan is configured for this workspace.</p>}
  {section==='help'&&<p>A support contact channel is not configured in this workspace yet.</p>}
 </>}</section></div></div>;
}

