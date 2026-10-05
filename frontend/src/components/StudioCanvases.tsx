import { useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, ArrowUpRight, Plus, RefreshCw, Scan, Send } from 'lucide-react';
import { productionService, type DirectorBrief, type DirectorCommandResult, type DirectorEvidenceRef, type DirectorRealityReport, type DirectorReferenceSurface, type DirectorRuntimeFit, type DirectorStory, type DirectorStudio, type DirectorTechnique } from '../services/productions';
import { safeError } from '../services/errors';
import { EmptyState, PartialState } from './StateComponents';
import { formatRuntime } from '../types/domain';

export type CanvasProps = { workspaceId: string; productionId: string; surface: DirectorStudio; refresh: () => void };

const EPISTEMIC_LABEL: Record<string, string> = { observed: 'Observed', estimated: 'Estimated', recommended: 'Recommended', unknown: 'Unknown' };
const REALITY_STATUS_LABEL: Record<string, string> = { available: 'Available', partial: 'Partially available', missing: 'Missing', unknown: 'Unverified', safe: 'Safe', risk: 'Risk', unsuitable: 'Unsuitable', requires_adaptation: 'Needs adaptation' };

function epistemicLabel(value: string): string { return EPISTEMIC_LABEL[value] ?? value.replaceAll('_', ' '); }
function joinList(values: readonly string[] | null | undefined): string { return (values ?? []).join(', '); }
function splitList(value: string): string[] { return value.split(',').map(item => item.trim()).filter(Boolean); }
function timecode(ms: number | null): string { return ms === null ? 'whole clip' : formatRuntime(ms); }

export function EpistemicTag({ value }: { value: string }) {
  return <span className={`epistemic-tag epistemic-${value}`} title={`${epistemicLabel(value)} — this is how TONDE knows it`}>{epistemicLabel(value)}</span>;
}

function EvidenceLine({ evidence }: { evidence: DirectorEvidenceRef[] }) {
  if (!evidence.length) return null;
  return <ul className="evidence-list" aria-label="Supporting evidence">{evidence.map((item, index) => <li key={`${item.kind}-${index}`}><span className="evidence-kind">{item.kind.replaceAll('_', ' ')}</span>{item.kind === 'timecode' || item.kind === 'time_range' || item.kind === 'frame' || item.kind === 'measurement' ? <span className="timecode">{timecode(item.start_ms)}{item.end_ms !== null && item.end_ms !== item.start_ms ? `–${timecode(item.end_ms)}` : ''}</span> : null}{item.frame_id ? <span className="timecode">{item.frame_id}</span> : null}{item.detail ? <span>{item.detail}</span> : null}</li>)}</ul>;
}

export function ReferenceFindings({ reference }: { reference: DirectorReferenceSurface }) {
  return <div className="reference-detail">
    <dl className="reference-capability"><div><dt>Capability</dt><dd>{reference.capability.capability.replaceAll('_', ' ')}</dd></div><div><dt>Media bytes</dt><dd>{reference.capability.media_bytes.replaceAll('_', ' ')}</dd></div><div><dt>Role</dt><dd>{reference.role.replaceAll('_', ' ')}</dd></div><div><dt>Status</dt><dd>{reference.status.replaceAll('_', ' ')}</dd></div><div><dt>Produced by</dt><dd>{reference.producer}</dd></div></dl>
    <p className="capability-note" role="status">{reference.capability.note}</p>
    {reference.stages.length > 0 && <p className="subtle">Stages reached: {joinList(reference.stages)}</p>}
    {reference.summary && <p>{reference.summary}</p>}
    {reference.findings.length > 0 && <section aria-label="Reference findings"><h4>Findings</h4><ul className="reference-findings">{reference.findings.map(finding => <li key={finding.finding_id}><p><EpistemicTag value={finding.epistemic} /><strong>{finding.category.replaceAll('_', ' ')}</strong> · confidence {finding.confidence}</p><p>{finding.statement}</p><EvidenceLine evidence={finding.evidence} />{finding.limitations.length > 0 && <p className="subtle">Limits: {joinList(finding.limitations)}</p>}</li>)}</ul></section>}
    {reference.techniques.length > 0 && <section aria-label="Extracted techniques"><h4>Techniques</h4><ul className="reference-techniques">{reference.techniques.map(technique => <li key={technique.canonical_id}><p><strong>{technique.name}</strong> · {technique.category.replaceAll('_', ' ')} · {technique.importance}</p><p>{technique.description}</p><p className="subtle">Effect: {technique.effect}</p><p className="subtle">Real Production: {technique.practical_concept}</p><p className="subtle">AI Creation: {technique.ai_concept}</p>{technique.conditions.length > 0 && <p className="subtle">Conditions: {joinList(technique.conditions)}</p>}</li>)}</ul></section>}
    {'sections' in reference.style && reference.style.sections.length > 0 && <section aria-label="Style DNA"><h4>Style DNA</h4>{reference.style.palette.length > 0 && <p className="subtle">Palette: {joinList(reference.style.palette)}</p>}<ul className="style-sections">{reference.style.sections.map(section => <li key={section.section}><p><EpistemicTag value={section.epistemic} /><strong>{section.section}</strong> · confidence {section.confidence}</p><p>{section.description}</p>{section.directives.length > 0 && <ul className="directive-list">{section.directives.map(directive => <li key={directive}>{directive}</li>)}</ul>}</li>)}</ul></section>}
    {reference.causal.length > 0 && <section aria-label="What makes this work"><h4>What makes this work</h4>{reference.causal.map(item => <article className="causal-card" key={item.question}><p className="eyebrow">{item.question}</p><p>{item.explanation}</p><p className="subtle">Drivers: {joinList(item.drivers)} · confidence {item.confidence}</p></article>)}</section>}
    {reference.adaptation_notes.length > 0 && <section aria-label="Adaptation notes"><h4>Adapting this without copying</h4><ul className="directive-list">{reference.adaptation_notes.map(note => <li key={note}>{note}</li>)}</ul></section>}
    {reference.limitations.length > 0 && <section aria-label="Analysis limitations"><h4>Limitations</h4><ul className="directive-list">{reference.limitations.map(limit => <li key={limit}>{limit}</li>)}</ul></section>}
  </div>;
}

export function BriefCanvas({ workspaceId, productionId, surface, refresh }: CanvasProps) {
  const brief = surface.brief;
  const [draft, setDraft] = useState<DirectorBrief | null>(brief);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { setDraft(brief); }, [brief]);
  if (!draft) return <PartialState title="No Brief yet">This Production has no Intelligent Brief until the Director plans it. Open Home, describe the Production and BUILD PRODUCTION.</PartialState>;
  const field = (label: string, key: keyof DirectorBrief, type: 'text' | 'number' = 'text') => <label>{label}<input type={type} value={draft[key] === null || draft[key] === undefined ? '' : String(draft[key])} onChange={event => setDraft(current => current === null ? current : { ...current, [key]: type === 'number' ? (event.target.value === '' ? null : Number(event.target.value)) : event.target.value })} /></label>;
  const listField = (label: string, key: 'tone' | 'style_direction' | 'hard_constraints' | 'deliverables' | 'cast' | 'environments') => <label>{label}<input value={joinList(draft[key])} onChange={event => setDraft(current => current === null ? current : { ...current, [key]: splitList(event.target.value) })} /></label>;
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null); setNotice(null);
    try { const saved = await productionService.saveDirectorBrief(workspaceId, productionId, surface.brief_revision, draft); setNotice(`Brief saved as revision ${saved.revision}.`); refresh(); }
    catch (failure) { setError(safeError(failure).message); }
    finally { setBusy(false); }
  };
  return <form className="intel-panel" onSubmit={save} aria-label="Intelligent Brief">
    <header className="intel-heading"><div><p className="eyebrow">THE INTELLIGENT BRIEF</p><h3>{draft.producer === 'model' ? 'Model-refined Brief' : 'Deterministic Brief'}</h3></div><span className="pill">Revision {surface.brief_revision ?? 1}</span></header>
    <p className="subtle">The Brief is the shared Creative Truth. Editing it changes the Brief only; Story, Script and Scenes stay as applied until you direct a new plan.</p>
    <div className="intel-grid">
      {field('Production goal', 'production_goal')}
      {field('Audience', 'audience')}
      {field('Core message', 'core_message')}
      {field('Desired response', 'desired_response')}
      {field('Platform', 'platform')}
      {field('Aspect ratio', 'aspect_ratio')}
      {field('Target runtime (ms)', 'runtime', 'number')}
      {field('Product / brand', 'product_brand')}
      {field('Product category', 'product_category')}
      {listField('Tone', 'tone')}
      {listField('Style direction', 'style_direction')}
      {listField('Hard constraints', 'hard_constraints')}
      {listField('Deliverables', 'deliverables')}
      {listField('Cast', 'cast')}
      {listField('Environments', 'environments')}
    </div>
    <label>Creative concept<textarea rows={3} value={draft.creative_concept} onChange={event => setDraft(current => current === null ? current : { ...current, creative_concept: event.target.value })} /></label>
    <label>Story approach<textarea rows={3} value={draft.story_approach} onChange={event => setDraft(current => current === null ? current : { ...current, story_approach: event.target.value })} /></label>
    <fieldset className="runtime-fieldset"><legend>Runtime target</legend><label>Kind<select value={draft.runtime.kind} onChange={event => setDraft(current => current === null ? current : { ...current, runtime: { ...current.runtime, kind: event.target.value } })}>{['exact', 'range', 'approximate', 'none'].map(kind => <option key={kind} value={kind}>{kind}</option>)}</select></label><label>Exact (ms)<input type="number" min={0} value={draft.runtime.exact_ms ?? ''} onChange={event => setDraft(current => current === null ? current : { ...current, runtime: { ...current.runtime, exact_ms: event.target.value === '' ? null : Number(event.target.value) } })} /></label><label>Minimum (ms)<input type="number" min={0} value={draft.runtime.min_ms ?? ''} onChange={event => setDraft(current => current === null ? current : { ...current, runtime: { ...current.runtime, min_ms: event.target.value === '' ? null : Number(event.target.value) } })} /></label><label>Maximum (ms)<input type="number" min={0} value={draft.runtime.max_ms ?? ''} onChange={event => setDraft(current => current === null ? current : { ...current, runtime: { ...current.runtime, max_ms: event.target.value === '' ? null : Number(event.target.value) } })} /></label></fieldset>
    <section className="brief-notes"><h4>Assumptions</h4>{draft.assumptions.length ? <ul className="directive-list">{draft.assumptions.map(item => <li key={item.statement}>{item.statement}<span className="subtle"> ({item.status.replaceAll('_', ' ')})</span></li>)}</ul> : <p className="subtle">No open assumptions were recorded.</p>}
      <h4>Decisions</h4>{draft.open_decisions.length ? <ul className="directive-list">{draft.open_decisions.map(item => <li key={item.id}>{item.question} — {item.answered && item.answer ? <strong>{item.answer}</strong> : <span className="subtle">unanswered{item.blocking ? ' (required)' : ''}</span>}</li>)}</ul> : <p className="subtle">No open decisions.</p>}
      {draft.conflicts.length > 0 && <><h4>Conflicts</h4><ul className="directive-list">{draft.conflicts.map(item => <li key={item.topic}>{item.topic}: {joinList(item.values)} → {item.resolution} ({item.resolved_by.replaceAll('_', ' ')})</li>)}</ul></>}</section>
    {error && <p role="alert" className="error-text">{error}</p>}{notice && <p role="status" className="subtle">{notice}</p>}
    <div className="intel-actions"><button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save Brief'}</button><button type="button" disabled={busy} onClick={() => { setDraft(brief); setNotice(null); setError(null); }}>Discard changes</button></div>
  </form>;
}

export function ReferenceCanvas({ workspaceId, productionId, surface, refresh }: CanvasProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [role, setRole] = useState('style');
  const [sourceType, setSourceType] = useState<'description' | 'url'>('description');
  const [sourceValue, setSourceValue] = useState('');
  const roles = ['story', 'camera', 'lighting', 'composition', 'movement', 'pacing', 'color', 'sound', 'style', 'character', 'product', 'environment'];
  const analyze = async (referenceId: string, assignedRole: string) => {
    setBusy(referenceId); setError(null); setNotice(null);
    try { const result = await productionService.analyzeDirectorReference(workspaceId, productionId, { reference_id: referenceId, role: assignedRole }); setNotice(`Analysis ${result.status}: ${result.findings_saved ?? result.findings.length} finding(s), ${result.techniques_saved ?? result.techniques.length} technique(s) saved.`); refresh(); }
    catch (failure) { setError(safeError(failure).message); }
    finally { setBusy(null); }
  };
  const addAndAnalyze = async (event: FormEvent) => {
    event.preventDefault(); if (!sourceValue.trim()) return;
    setBusy('new'); setError(null); setNotice(null);
    try {
      const referenceId = await productionService.addReference(workspaceId, productionId, sourceType === 'url' ? { source_type: 'url', source_url: sourceValue.trim() } : { source_type: 'description', source_description: sourceValue.trim() });
      setSourceValue('');
      const result = await productionService.analyzeDirectorReference(workspaceId, productionId, { reference_id: referenceId, role });
      setNotice(`${sourceType === 'url' ? 'URL' : 'Written'} reference analysed: ${result.status} (${result.capability.capability.replaceAll('_', ' ')}).`);
      refresh();
    } catch (failure) { setError(safeError(failure).message); }
    finally { setBusy(null); }
  };
  return <div className="intel-panel" aria-label="Reference analysis">
    <header className="intel-heading"><div><p className="eyebrow">REFERENCE INTELLIGENCE</p><h3>{surface.references.length} reference(s) on this Production</h3></div><span className="pill">{Object.keys(surface.reference_roles).length} role(s) assigned</span></header>
    <p className="subtle">TONDE states what it could actually access. Metadata-only, inaccessible and unavailable media never produce fabricated observations.</p>
    <form className="inline-form reference-add" onSubmit={addAndAnalyze}><label>New reference<select value={sourceType} onChange={event => setSourceType(event.target.value as 'description' | 'url')}><option value="description">Written description</option><option value="url">Reference URL (metadata only)</option></select></label><label>{sourceType === 'url' ? 'URL' : 'Description'}<input required value={sourceValue} onChange={event => setSourceValue(event.target.value)} placeholder={sourceType === 'url' ? 'https://…' : 'What are we looking at?'} /></label><label>Intended role<select value={role} onChange={event => setRole(event.target.value)}>{roles.map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label><button className="primary" disabled={busy !== null || !sourceValue.trim()}><Plus size={15} />{busy === 'new' ? 'Analysing…' : 'Add & analyse'}</button></form>
    {error && <p role="alert" className="error-text">{error}</p>}{notice && <p role="status" className="subtle">{notice}</p>}
    {!surface.references.length ? <EmptyState title="No references recorded">Add a written description, a URL or an uploaded file. Analysis always states its capability before it makes a claim.</EmptyState> : <ul className="reference-list">{surface.references.map(reference => <li key={reference.reference_id} className="reference-card">
      <header><div><h4>{reference.source_description || reference.source_url || 'Uploaded reference'}</h4><p className="subtle">{reference.source_type.replaceAll('_', ' ')} · {reference.rights_classification.replaceAll('_', ' ')} · {reference.state.replaceAll('_', ' ')}</p></div><span className="pill">{reference.role.replaceAll('_', ' ')}</span></header>
      <ReferenceFindings reference={reference} />
      <div className="intel-actions"><button type="button" disabled={busy !== null} onClick={() => void analyze(reference.reference_id, reference.role)}><RefreshCw size={14} />{busy === reference.reference_id ? 'Analysing…' : reference.status === 'not_started' ? 'Analyse now' : 'Re-analyse'}</button><label className="inline-role">Role<select value={reference.role} onChange={event => setRole(event.target.value)} aria-label={`Role for ${reference.source_description || reference.reference_id}`}>{roles.map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label><button type="button" disabled={busy !== null} onClick={() => void analyze(reference.reference_id, role)}><Scan size={14} /> Analyse with this role</button></div>
    </li>)}</ul>}
  </div>;
}

export function StoryCanvas({ workspaceId, productionId, surface, refresh }: CanvasProps) {
  const [story, setStory] = useState<DirectorStory | null>(surface.story);
  const [alternatives, setAlternatives] = useState<DirectorStory[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { setStory(surface.story); }, [surface.story]);
  const loadAlternatives = async () => {
    setBusy(true); setError(null); setNotice(null);
    try { const result = await productionService.directorStoryAlternatives(workspaceId, productionId, 3); setAlternatives(result.alternatives); setNotice(result.note); }
    catch (failure) { setError(safeError(failure).message); }
    finally { setBusy(false); }
  };
  const useDirection = async (variation: string) => {
    setBusy(true); setError(null); setNotice(null);
    try { const result = await productionService.directorCommand(workspaceId, productionId, { text: `Regenerate the story as the ${variation} variation`, apply: true, expected_production_revision: surface.production.revision }); setNotice(result.applied ? `Applied: ${joinList(result.changes)}` : result.answer ?? 'Direction applied.'); refresh(); }
    catch (failure) { setError(safeError(failure).message); }
    finally { setBusy(false); }
  };
  if (!story) return <PartialState title="No Story yet">The Story is written when the Director builds a production plan. Open Home, describe the Production and BUILD PRODUCTION.</PartialState>;
  return <div className="intel-panel" aria-label="Story">
    <header className="intel-heading"><div><p className="eyebrow">STORY · {story.variation.replaceAll('_', ' ')}</p><h3>{story.title}</h3></div><span className="pill">{story.grammar.replaceAll('_', ' ')} · {story.producer === 'model' ? 'model' : 'deterministic'}</span></header>
    <p>{story.logline}</p>
    <dl className="story-facts"><div><dt>Premise</dt><dd>{story.premise}</dd></div><div><dt>Central question</dt><dd>{story.central_question}</dd></div><div><dt>Protagonist</dt><dd>{story.protagonist || 'Not specified'}</dd></div><div><dt>Desire</dt><dd>{story.desire || 'Not specified'}</dd></div><div><dt>Conflict</dt><dd>{story.conflict || 'Not specified'}</dd></div><div><dt>Stakes</dt><dd>{story.stakes || 'Not specified'}</dd></div><div><dt>Hook</dt><dd>{story.hook || 'Not specified'}</dd></div><div><dt>Payoff</dt><dd>{story.payoff || 'Not specified'}</dd></div>{story.call_to_action && <div><dt>Call to action</dt><dd>{story.call_to_action}</dd></div>}<div><dt>Runtime</dt><dd>{formatRuntime(story.runtime_ms)}</dd></div><div><dt>Dialogue</dt><dd>{story.dialogue_mode ? story.dialogue_mode.replaceAll('_', ' ') : 'Not specified'}{story.dialogue_approach ? ` — ${story.dialogue_approach}` : ''}</dd></div></dl>
    <ol className="story-beats">{story.beats.map(beat => <li key={beat.id}><p><strong>{beat.name}</strong> · beat {beat.order} · {beat.planned_duration_ms === null ? 'untimed' : formatRuntime(beat.planned_duration_ms)}</p><p>{beat.content}</p><p className="subtle">{beat.story_function}{beat.emotion ? ` · ${beat.emotion}` : ''}</p>{beat.visual_idea && <p className="subtle">Visual idea: {beat.visual_idea}</p>}{beat.techniques.length > 0 && <p className="subtle">Techniques: {joinList(beat.techniques)}</p>}</li>)}</ol>
    <p className="subtle">Emotional progression: {joinList(story.emotional_progression)}</p>
    <dl className="story-facts"><div><dt>Beginning</dt><dd>{story.beginning}</dd></div><div><dt>Middle</dt><dd>{story.middle}</dd></div><div><dt>Ending</dt><dd>{story.ending}</dd></div>{story.theme && <div><dt>Theme</dt><dd>{story.theme}</dd></div>}</dl>
    {story.assumptions.length > 0 && <p className="assumption-note"><strong>Assumptions:</strong> {joinList(story.assumptions)}</p>}
    <div className="intel-actions"><button type="button" disabled={busy} onClick={() => void loadAlternatives()}><RefreshCw size={14} />{busy ? 'Working…' : 'Show three alternatives'}</button></div>
    {error && <p role="alert" className="error-text">{error}</p>}{notice && <p role="status" className="subtle">{notice}</p>}
    {alternatives.length > 0 && <section aria-label="Story alternatives"><h4>Alternative directions (your selected Story is unchanged until you choose)</h4><ul className="story-alternatives">{alternatives.map(alternative => <li key={alternative.variation}><p><strong>{alternative.title}</strong> · {alternative.variation.replaceAll('_', ' ')}</p><p>{alternative.logline}</p><p className="subtle">{alternative.beats.length} beat(s) · {formatRuntime(alternative.runtime_ms)}</p><button type="button" disabled={busy} onClick={() => void useDirection(alternative.variation)}>Use this direction <ArrowUpRight size={14} /></button></li>)}</ul></section>}
  </div>;
}

export function ScriptCanvas({ workspaceId, productionId, surface, refresh }: CanvasProps) {
  const [alternatives, setAlternatives] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const preview = async (operation: string) => {
    setBusy(operation); setError(null); setNotice(null);
    try { const result = await productionService.directorDialogueOperation(workspaceId, productionId, operation); setAlternatives(result.line_alternatives); setNotice(result.answer ?? 'Line alternatives ready.'); }
    catch (failure) { setError(safeError(failure).message); }
    finally { setBusy(null); }
  };
  const applyOperation = async (operation: string) => {
    setBusy(operation); setError(null); setNotice(null);
    const text = operation === 'shorter' ? 'Rewrite the dialogue lines shorter' : operation === 'sharpen' ? 'Sharpen the dialogue lines' : operation === 'natural' ? 'Make the dialogue lines more natural' : 'Rewrite the dialogue lines';
    try { const result = await productionService.directorCommand(workspaceId, productionId, { text, apply: true, expected_production_revision: surface.production.revision }); setNotice(result.applied ? `Applied: ${joinList(result.changes)}` : result.answer ?? 'Reviewed.'); refresh(); }
    catch (failure) { setError(safeError(failure).message); }
    finally { setBusy(null); }
  };
  const document = surface.documents?.script;
  const dialogueMode = surface.story?.dialogue_mode ?? null;
  const spoken = surface.scenes.reduce((total, scene) => total + scene.dialogue.filter(line => line.kind !== 'pause' && line.kind !== 'reaction').length, 0);
  if (!surface.scenes.length) return <PartialState title="No Script yet">A Script appears when the plan writes Scenes and lines. Photography Productions may have no spoken lines at all.</PartialState>;
  const operationButtons: Array<[string, string]> = [['shorter', 'shorter'], ['sharpen', 'sharper'], ['natural', 'more natural'], ['rewrite', 'rewritten']];
  return <div className="intel-panel" aria-label="Script">
    <header className="intel-heading"><div><p className="eyebrow">SCRIPT · {dialogueMode ? dialogueMode.replaceAll('_', ' ') : 'dialogue not set'}</p><h3>{document?.title ?? surface.story?.title ?? surface.production.title}</h3></div><span className="pill">{surface.scenes.length} scene(s) · {spoken} spoken line(s)</span></header>
    {surface.story?.dialogue_approach && <p className="subtle">{surface.story.dialogue_approach}</p>}
    <RuntimeFitBar fit={surface.runtime_fit} />
    <div className="intel-actions"><button type="button" disabled={busy !== null} onClick={() => void preview('shorter')}>Preview shorter lines</button><button type="button" disabled={busy !== null} onClick={() => void preview('sharpen')}>Preview sharper lines</button><button type="button" className="primary" disabled={busy !== null} onClick={() => void applyOperation('shorter')}>{busy === 'shorter' ? 'Applying…' : 'Apply shorter lines'}</button></div>
    {error && <p role="alert" className="error-text">{error}</p>}{notice && <p role="status" className="subtle">{notice}</p>}
    {Object.keys(alternatives).length > 0 && <ul className="line-alternatives" aria-label="Line alternatives">{Object.entries(alternatives).map(([lineId, options]) => <li key={lineId}><p className="eyebrow">{lineId}</p><ul>{options.map(option => <li key={option}>{option}</li>)}</ul></li>)}</ul>}
    {document?.content ? <section aria-label="Script document"><h4>Persisted Script</h4><pre className="script-document">{document.content}</pre></section> : <p className="subtle">No persisted Script document exists yet.</p>}
    <section aria-label="Structured dialogue"><h4>Structured Scenes and Dialogue</h4><ol className="script-scenes">{surface.scenes.map(scene => <li key={scene.id}>
      <header><p className="eyebrow">SCENE {scene.order ?? '—'}</p><h4>{scene.title}</h4><span className="pill">{formatRuntime(scene.planned_duration_ms)}</span></header>
      {scene.environment && <p className="subtle">Environment: {scene.environment}</p>}
      {scene.action_lines.length > 0 && <ul className="action-lines" aria-label={`Action for scene ${scene.order ?? ''}`}>{scene.action_lines.map(line => <li key={line}>{line}</li>)}</ul>}
      {scene.products.length > 0 && <p className="subtle">Product direction: {joinList(scene.products)}</p>}
      {scene.dialogue.length > 0 ? <table className="dialogue-table"><caption className="sr-only">Dialogue for scene {scene.order ?? ''}</caption><thead><tr><th scope="col">#</th><th scope="col">Kind</th><th scope="col">Speaker</th><th scope="col">Content</th><th scope="col">Direction</th><th scope="col">Time</th></tr></thead><tbody>{scene.dialogue.map((line, index) => <tr key={line.id}><td>{index + 1}</td><td>{line.kind.replaceAll('_', ' ')}</td><td>{line.speaker ?? '—'}</td><td>{line.content || '—'}</td><td>{[line.intention, line.delivery, line.subtext && `subtext: ${line.subtext}`].filter(Boolean).join(' · ') || '—'}</td><td>{line.duration_ms === null ? 'untimed' : formatRuntime(line.duration_ms)}{line.pause_after_ms ? ` (+${line.pause_after_ms}ms pause)` : ''}</td></tr>)}</tbody></table> : <p className="subtle">No spoken lines in this Scene.</p>}
      {scene.dialogue_notes && <p className="subtle">Notes: {scene.dialogue_notes}</p>}
      <p className="subtle">Dialogue operations: {operationButtons.map(([key, label]) => <button type="button" key={key} className="text-link" disabled={busy !== null} onClick={() => void applyOperation(key)}>{label}</button>)}</p>
    </li>)}</ol></section>
  </div>;
}

export function RuntimeFitBar({ fit }: { fit: DirectorRuntimeFit }) {
  const label = { fits: 'Runtime fits exactly', over: 'Over the assigned runtime', under: 'Under the assigned runtime', unresolved: 'Runtime unresolved' }[fit.status];
  return <section className={`runtime-fit runtime-${fit.status}`} aria-label="Runtime fit"><p><strong>{label}</strong> · target {formatRuntime(fit.target_ms)} · assigned {formatRuntime(fit.assigned_ms)} · dialogue {formatRuntime(fit.dialogue_ms)} · action {formatRuntime(fit.action_ms)} · slack {formatRuntime(fit.slack_ms)}</p></section>;
}

export function RealityCanvas({ workspaceId, productionId, surface, refresh }: CanvasProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const reality: DirectorRealityReport | null = surface.reality;
  const recheck = async () => {
    setBusy(true); setError(null); setNotice(null);
    try { const result = await productionService.directorCommand(workspaceId, productionId, { text: 'Make this shootable with my setup', apply: true, expected_production_revision: surface.production.revision }); setNotice(result.applied ? `Adaptations applied: ${joinList(result.adaptations_applied.length ? result.adaptations_applied : result.changes)}` : result.answer ?? 'Reality Check re-run.'); refresh(); }
    catch (failure) { setError(safeError(failure).message); }
    finally { setBusy(false); }
  };
  if (!reality) return <PartialState title="No Reality Check yet">Reality Check compares the plan with your Setup only after a plan is built. It reports Unverified rather than inventing availability.</PartialState>;
  const domains = Object.entries(reality.domains);
  return <div className="intel-panel" aria-label="Reality check">
    <header className="intel-heading"><div><p className="eyebrow">PRODUCTION REALITY CHECK</p><h3>{reality.feasibility === 'ready' ? 'Ready with what you have' : reality.feasibility === 'adapt' ? 'Ready after adaptation' : 'Blocked until a gap is closed'}</h3></div><span className="pill">{reality.complexity} complexity</span></header>
    <p>{reality.summary}</p>
    {domains.length > 0 && <ul className="reality-domains">{domains.map(([domain, status]) => <li key={domain}><strong>{domain.replaceAll('_', ' ')}</strong><span>{REALITY_STATUS_LABEL[status] ?? status.replaceAll('_', ' ')}</span></li>)}</ul>}
    {reality.items.length > 0 && <ul className="reality-items">{reality.items.map(item => <li key={`${item.domain}-${item.requirement}`}><p><strong>{item.requirement}</strong> · {item.domain.replaceAll('_', ' ')} · {(REALITY_STATUS_LABEL[item.status] ?? item.status.replaceAll('_', ' '))} · confidence {item.confidence}</p><p>{item.recommendation}</p>{item.resource && <p className="subtle">Resource: {item.resource}</p>}{item.evidence.length > 0 && <p className="subtle">Evidence: {joinList(item.evidence)}</p>}</li>)}</ul>}
    {reality.conflicts.length > 0 && <section aria-label="Reality conflicts"><h4>Conflicts</h4><ul className="directive-list">{reality.conflicts.map(conflict => <li key={conflict}>{conflict}</li>)}</ul></section>}
    {reality.adaptations.length > 0 && <section aria-label="Reality adaptations"><h4>Adaptations</h4><ul className="reality-adaptations">{reality.adaptations.map(item => <li key={`${item.scope}-${item.target}`}><p><strong>{item.target}</strong> · {item.scope}</p><p>{item.change}</p><p className="subtle">{item.reason}</p></li>)}</ul></section>}
    <section className="setup-check"><h4>Setup considered</h4>{surface.reality_used_setup ? <p className="subtle">This check used your listed Setup.</p> : <p className="subtle">No Setup items were listed, so availability is Unverified rather than assumed.</p>}{surface.setup_listed.length > 0 ? <p className="subtle">Listed: {joinList(surface.setup_listed)}</p> : <p className="subtle">Nothing is listed in Setup yet. Add real equipment in Setup to make this check concrete.</p>}{reality.inventory_used.length > 0 && <p className="subtle">Used: {joinList(reality.inventory_used)}</p>}{reality.notes.length > 0 && <ul className="directive-list">{reality.notes.map(note => <li key={note}>{note}</li>)}</ul>}</section>
    <div className="intel-actions"><button type="button" className="primary" disabled={busy} onClick={() => void recheck()}><AlertTriangle size={14} />{busy ? 'Re-running…' : 'Re-check against my Setup'}</button></div>
    {error && <p role="alert" className="error-text">{error}</p>}{notice && <p role="status" className="subtle">{notice}</p>}
  </div>;
}

export function DirectorCommandResultPanel({ result }: { result: DirectorCommandResult }) {
  return <article className="director-answer" aria-label="Director answer">
    <p className="eyebrow">{result.command.kind.replaceAll('_', ' ')} · {result.command.scope} · confidence {result.command.confidence}</p>
    {result.answer && <p>{result.answer}</p>}
    <p className="subtle">{result.rationale}</p>
    {result.changes.length > 0 && <ul className="directive-list">{result.changes.map(change => <li key={change}>{change}</li>)}</ul>}
    {result.causal.length > 0 && <section aria-label="Causal answer">{result.causal.map(item => <div className="causal-card" key={item.question}><p className="eyebrow">{item.question}</p><p>{item.explanation}</p><p className="subtle">Drivers: {joinList(item.drivers)}</p></div>)}</section>}
    {Object.keys(result.line_alternatives).length > 0 && <ul className="line-alternatives">{Object.entries(result.line_alternatives).map(([lineId, options]) => <li key={lineId}><p className="eyebrow">{lineId}</p><ul>{options.map(option => <li key={option}>{option}</li>)}</ul></li>)}</ul>}
    {result.adaptations_applied.length > 0 && <p className="subtle">Adaptations applied: {joinList(result.adaptations_applied)}</p>}
    {result.limitations.length > 0 && <p className="subtle">Limitations: {joinList(result.limitations)}</p>}
    {!result.applied && result.plan && <p className="status-note" role="status"><Send size={14} /> A change is prepared for this Production. Use Apply to persist it.</p>}
    {result.applied && <p className="status-note" role="status">Applied and saved to this Production{typeof result.applied.production_revision === 'number' ? ` (revision ${result.applied.production_revision})` : ''}.</p>}
  </article>;
}

export function TechniqueTable({ techniques }: { techniques: DirectorTechnique[] }) {
  if (!techniques.length) return <p className="subtle">No Technique has been extracted from a Reference yet. Discovered Techniques appear here and in the reference detail.</p>;
  return <ul className="library-list">{techniques.map(technique => <li className="library-row" key={technique.canonical_id}><span><strong>{technique.name}</strong><small>{technique.category.replaceAll('_', ' ')} · {technique.importance} · confidence {technique.confidence}</small><small>{technique.description}</small></span><span className="pill">{technique.canonical_id}</span></li>)}</ul>;
}
