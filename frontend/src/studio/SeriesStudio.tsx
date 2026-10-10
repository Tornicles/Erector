import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarClock, Clapperboard, Play, Plus, RefreshCw, Repeat } from 'lucide-react';
import { safeError } from '../services/errors';
import {
  longFormService, type GenerateAheadJob, type GenerateAheadPreview, type GenerateAheadResult, type GenerateDepth,
  type GenerateHorizon, type ProductionLine, type SeriesOverview, type SeriesRow, type SlotSet,
} from '../services/longForm';
import { LoadingState, PartialState } from '../components/StateComponents';

/**
 * Series Studio: recurring Production without a second Production system.
 *
 * A Series is an association layer over canonical Productions: Episodes reference the same
 * workspace Assets, and Generate Ahead only creates Production shells plus Episode
 * associations at real cadence slots. It previews first, requires confirmation, never
 * overwrites an existing Episode, and records the requested depth instead of pretending the
 * Story, Script or Shots were written.
 */

const HORIZONS: GenerateHorizon[] = ['tomorrow', 'next_7', 'next_14', 'next_30', 'entire_series', 'custom'];
const DEPTHS: GenerateDepth[] = ['ideas_only', 'briefs', 'story', 'script', 'complete_plan'];
const CADENCES = ['daily', 'weekdays', 'weekly', 'selected_weekdays', 'custom', 'none'];
const DEPTH_LABEL: Record<GenerateDepth, string> = {
  ideas_only: 'Ideas Only', briefs: 'Briefs', story: 'Story', script: 'Script', complete_plan: 'Complete Production Plan',
};
const HORIZON_LABEL: Record<GenerateHorizon, string> = {
  tomorrow: 'Tomorrow', next_7: 'Next 7 days', next_14: 'Next 14 days', next_30: 'Next 30 days',
  entire_series: 'Entire Series', custom: 'Custom',
};

export function SeriesStudioCanvas({ workspaceId, projectId, seriesId, onSelectSeries }: {
  workspaceId: string; projectId: string; seriesId: string | null;
  onSelectSeries: (seriesId: string) => void;
}) {
  const [series, setSeries] = useState<SeriesRow[] | null>(null);
  const [overview, setOverview] = useState<SeriesOverview | null>(null);
  const [line, setLine] = useState<ProductionLine | null>(null);
  const [slots, setSlots] = useState<SlotSet | null>(null);
  const [preview, setPreview] = useState<GenerateAheadPreview | null>(null);
  const [generated, setGenerated] = useState<GenerateAheadResult | null>(null);
  const [jobs, setJobs] = useState<GenerateAheadJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<'recurring' | 'narrative'>('recurring');
  const [timezone, setTimezone] = useState('UTC');
  const [cadence, setCadence] = useState('daily');
  const [weekdays, setWeekdays] = useState('');
  const [runtimeSeconds, setRuntimeSeconds] = useState('');
  const [titlePattern, setTitlePattern] = useState('{series} {n}');
  const [plannedEpisodes, setPlannedEpisodes] = useState('');
  const [collectionTitle, setCollectionTitle] = useState('');
  const [horizon, setHorizon] = useState<GenerateHorizon>('next_7');
  const [depth, setDepth] = useState<GenerateDepth>('ideas_only');
  const [holdSlots, setHoldSlots] = useState('');
  const [topics, setTopics] = useState('');
  const [directorText, setDirectorText] = useState('');
  const [directorAnswer, setDirectorAnswer] = useState<string | null>(null);

  useEffect(() => {
    let active = true; setLoading(true); setError(null);
    longFormService.listSeries(workspaceId, projectId)
      .then(rows => { if (active) setSeries(rows); })
      .catch(failure => { if (active) { setSeries(null); setError(safeError(failure).message); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceId, projectId, reloadKey]);

  useEffect(() => {
    if (!seriesId) { setOverview(null); setLine(null); setSlots(null); setJobs([]); return; }
    let active = true;
    Promise.all([longFormService.overview(workspaceId, seriesId), longFormService.productionLine(workspaceId, seriesId),
      longFormService.slots(workspaceId, seriesId, { horizon }), longFormService.jobs(workspaceId, seriesId)])
      .then(([seriesOverview, productionLine, slotSet, jobList]) => {
        if (!active) return;
        setOverview(seriesOverview); setLine(productionLine); setSlots(slotSet); setJobs(jobList.jobs);
      })
      .catch(failure => { if (active) setError(safeError(failure).message); });
    return () => { active = false; };
  }, [workspaceId, seriesId, horizon, reloadKey]);

  const refresh = useCallback(() => setReloadKey(value => value + 1), []);
  const run = useCallback(async (action: () => Promise<unknown>, describe: (result: unknown) => string) => {
    setWorking(true); setError(null); setNote(null);
    try { const result = await action(); setNote(describe(result)); refresh(); return result; }
    catch (failure) { setError(safeError(failure).message); return null; }
    finally { setWorking(false); }
  }, [refresh]);

  const guard = working;
  const cadenceMetadata = () => {
    const metadata: Record<string, unknown> = { kind: cadence };
    if (cadence === 'selected_weekdays' && weekdays.trim()) metadata.weekdays = weekdays.split(',').map(value => Number(value.trim())).filter(Number.isFinite);
    return metadata;
  };

  return <section className="series-studio" aria-label="Series Studio">
    <header className="movie-mode-head">
      <div><p className="eyebrow">SERIES</p><h3>Recurring production</h3></div>
      <p className="subtle">Every Episode is its own canonical Production. Series context is referenced, never copied.</p>
    </header>

    {error && <div className="save-error" role="alert">{error}<button onClick={() => setError(null)}>Dismiss</button></div>}
    {note && <p className="studio5-note" role="status">{note}</p>}

    {loading && !series ? <LoadingState label="Reading this project's Series…" />
      : series === null ? <PartialState title="Series are unavailable" action={<button onClick={refresh}>Try again</button>}>
        The Series list could not be read. Nothing was invented.
      </PartialState>
      : <>
        <div className="series-picker" role="group" aria-label="Series">
          {series.length === 0 && <p className="subtle">No Series yet in this project. Create one below, or keep working on a single Production.</p>}
          {series.map(row => <button key={row.id} type="button" aria-pressed={row.id === seriesId}
            className={row.id === seriesId ? 'selected' : ''} onClick={() => onSelectSeries(row.id)}>
            <Repeat size={14} /> {row.title}
            <span className="pill subtle">{String(row.series_kind)}</span>
            <span className="pill subtle">{row.timezone}</span>
          </button>)}
        </div>

        <form className="series-create" onSubmit={event => { event.preventDefault(); if (!title.trim()) return;
          void run(() => longFormService.createSeries(workspaceId, projectId, {
            title: title.trim(), series_kind: kind, timezone: timezone.trim() || 'UTC', cadence_metadata: cadenceMetadata(),
            format: { production_type: 'recurring_content', execution_method: 'real',
              runtime_target_ms: runtimeSeconds.trim() ? Math.round(Number(runtimeSeconds) * 1000) : undefined,
              title_pattern: titlePattern.trim() || '{series} {n}',
              planned_episodes: plannedEpisodes.trim() ? Number(plannedEpisodes) : undefined },
          }), result => {
            const created = result as { series_id?: string };
            if (created.series_id) onSelectSeries(created.series_id);
            return 'Created the Series. Seasons are optional.';
          }); }}>
          <p className="eyebrow">NEW SERIES</p>
          <label>Title<input value={title} maxLength={160} onChange={event => setTitle(event.target.value)} placeholder="Daily Personal Finance" /></label>
          <label>Kind<select value={kind} onChange={event => setKind(event.target.value as 'recurring' | 'narrative')}>
            <option value="recurring">Recurring content</option><option value="narrative">Narrative</option></select></label>
          <label>Timezone<input value={timezone} maxLength={60} onChange={event => setTimezone(event.target.value)} placeholder="Europe/London" /></label>
          <label>Cadence<select value={cadence} onChange={event => setCadence(event.target.value)}>
            {CADENCES.map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>
          {cadence === 'selected_weekdays' && <label>Weekdays (1=Mon … 7=Sun)
            <input value={weekdays} onChange={event => setWeekdays(event.target.value)} placeholder="1,3,5" /></label>}
          <label>Runtime target (seconds)<input value={runtimeSeconds} onChange={event => setRuntimeSeconds(event.target.value)} placeholder="45" /></label>
          <label>Title pattern<input value={titlePattern} maxLength={160} onChange={event => setTitlePattern(event.target.value)} /></label>
          <label>Planned episodes<input value={plannedEpisodes} onChange={event => setPlannedEpisodes(event.target.value)} placeholder="10" /></label>
          <button type="submit" disabled={guard || !title.trim()}><Plus size={14} /> Create Series</button>
          <p className="subtle">Dates are computed in this timezone from the cadence — never from UTC drift.</p>
        </form>
      </>}

    {seriesId && overview && <>
      <section aria-label="Series overview">
        <div className="series-overview-head">
          <h4>{overview.title}</h4>
          <span className="pill">{String(overview.series_kind)}</span>
          <span className="pill subtle">{overview.timezone}</span>
          <span className="pill subtle">{overview.counts.episodes_active} active Episodes</span>
          <span className="pill subtle">next number {overview.counts.next_episode_number}</span>
          {overview.counts.planned_episodes && <span className="pill subtle">{overview.counts.planned_episodes} planned</span>}
        </div>
        <p className="subtle">{overview.note}</p>
        <div className="series-reuse">
          <p className="eyebrow">REUSED ASSETS</p>
          {overview.reuse.length === 0
            ? <p className="subtle">No Assets referenced yet. Style, host and Product references stay canonical Assets.</p>
            : <ul>{overview.reuse.map(asset => <li key={asset.asset_id}>{asset.name} · {asset.asset_type}{asset.missing ? ' · missing' : ''}</li>)}</ul>}
        </div>
        <form className="series-collection" onSubmit={event => { event.preventDefault(); if (!collectionTitle.trim()) return;
          void run(() => longFormService.saveCollection(workspaceId, seriesId, { title: collectionTitle.trim() }),
            () => 'Saved the Season/Collection.').then(() => setCollectionTitle('')); }}>
          <label>Season / Collection<input value={collectionTitle} maxLength={160} onChange={event => setCollectionTitle(event.target.value)} /></label>
          <button type="submit" disabled={guard || !collectionTitle.trim()}><Plus size={14} /> Save Collection</button>
          <p className="subtle">Seasons are optional: a recurring Series does not need them.</p>
        </form>
        {overview.collections.length > 0 && <ul className="series-collections">
          {overview.collections.map(collection => <li key={collection.collection_id}>{collection.title} · {collection.episodes} Episode(s) · {collection.lifecycle}</li>)}
        </ul>}
      </section>

      <section aria-label="Production Line">
        <p className="eyebrow">PRODUCTION LINE</p>
        {!line ? <LoadingState label="Reading Episode state…" /> : <>
          <table className="series-line">
            <caption>Where each Episode really is, with its real blockers. No completion percentage is invented.</caption>
            <thead><tr><th scope="col">Episode</th><th scope="col">Date</th><th scope="col">Requested</th><th scope="col">Depth now</th><th scope="col">State</th><th scope="col">Readiness</th><th scope="col">Blockers</th></tr></thead>
            <tbody>
              {line.items.length === 0 && <tr><td colSpan={7} className="subtle">No Episodes yet. Generate Ahead creates future Production shells at real cadence slots.</td></tr>}
              {line.items.map(item => <tr key={item.episode_id}>
                <td>
                  {item.production_id
                    ? <Link to={`/studio/${item.production_id}?tool=Movie Mode`}>{item.episode_number ?? '—'} · {item.title}</Link>
                    : <>{item.episode_number ?? '—'} · {item.title}</>}
                </td>
                <td>{item.planned_date ?? '—'}</td>
                <td>{item.requested_depth_label || (item.requested_depth ? DEPTH_LABEL[item.requested_depth] : '—')}</td>
                <td>{item.depth_label ?? item.depth}</td>
                <td>{item.line_state_label ?? item.line_state}</td>
                <td><span className={`pill readiness-${(item.readiness.state ?? 'UNKNOWN').toLowerCase().replaceAll(' ', '-')}`}>{item.readiness.state}</span>
                  {' '}<span className="subtle">{item.readiness.blocking} blocking · {item.readiness.warnings} warning(s)</span></td>
                <td>{item.blockers.length === 0 ? <span className="subtle">none</span>
                  : <ul>{item.blockers.map(blocker => <li key={blocker.code} className={blocker.severity === 'blocking' ? 'studio5-warn' : ''}>
                    <AlertTriangle size={12} /> {blocker.message} <span className="subtle">— {blocker.action}</span></li>)}</ul>}</td>
              </tr>)}
            </tbody>
          </table>
          <p className="subtle" role="status">{line.note}{line.readiness_is_criteria_based ? ' Readiness is criteria-based.' : ''}</p>
        </>}
      </section>

      <section aria-label="Generate Ahead">
        <p className="eyebrow">GENERATE AHEAD</p>
        <form className="generate-ahead" onSubmit={event => { event.preventDefault();
          void run(() => longFormService.previewGenerateAhead(workspaceId, seriesId, {
            horizon, depth, hold_slots: holdSlots.split(',').map(value => value.trim()).filter(Boolean),
            topics: topics.split(',').map(value => value.trim()).filter(Boolean),
          }), () => 'Preview only: nothing was created.').then(result => {
            setPreview(result as GenerateAheadPreview | null); setGenerated(null);
          }); }}>
          <label>Horizon<select value={horizon} onChange={event => setHorizon(event.target.value as GenerateHorizon)}>
            {HORIZONS.map(value => <option key={value} value={value}>{HORIZON_LABEL[value]}</option>)}</select></label>
          <label>Depth<select value={depth} onChange={event => setDepth(event.target.value as GenerateDepth)}>
            {DEPTHS.map(value => <option key={value} value={value}>{DEPTH_LABEL[value]}</option>)}</select></label>
          <label>Hold slots (dates)<input value={holdSlots} onChange={event => setHoldSlots(event.target.value)} placeholder="2026-10-08" /></label>
          <label>Topics<input value={topics} onChange={event => setTopics(event.target.value)} placeholder="Emergency fund" /></label>
          <button type="submit" disabled={guard}><CalendarClock size={14} /> Preview</button>
        </form>

        {preview && <div className="generate-preview" role="status">
          <p className="eyebrow">PREVIEW · {HORIZON_LABEL[preview.horizon]} · {preview.depth_label}</p>
          <p>{preview.counts.open} open · {preview.counts.preserved} preserved · {preview.counts.held} held · {preview.counts.total} total
            {' '}in {preview.timezone} (today {preview.today})</p>
          <ul className="series-slots">
            {preview.slots.map(slot => <li key={slot.slot_key} className={`slot-${slot.state}`}>
              {slot.planned_date ?? slot.slot_key} · {slot.state}{slot.episode_number ? ` · Episode ${slot.episode_number}` : ''}
            </li>)}
          </ul>
          <p className="subtle">{preview.depth_note}</p>
          <p className="subtle">{preview.do_not_overwrite}</p>
          <p className="subtle">{preview.reuse_note}</p>
          {preview.requires_confirmation && <button type="button" disabled={guard} onClick={() => void run(
            () => longFormService.generateAhead(workspaceId, seriesId, {
              horizon: preview.horizon, depth: preview.depth,
              hold_slots: holdSlots.split(',').map(value => value.trim()).filter(Boolean),
              topics: topics.split(',').map(value => value.trim()).filter(Boolean),
              expected_series_revision: preview.series_revision,
            }), () => 'Applied Generate Ahead.').then(result => setGenerated(result as GenerateAheadResult | null))}>
            <Play size={14} /> Confirm and create {preview.counts.open} Episode shell(s)</button>}
        </div>}

        {generated && <div className="generate-result" role="status">
          <p className="eyebrow">CREATED · {generated.state.toUpperCase()}</p>
          <p>{generated.counts.created} created · {generated.counts.preserved} preserved · {generated.counts.blocked} blocked · {generated.counts.failed} failed</p>
          <ul>{generated.created_episodes.map(episode => <li key={episode.episode_id}>
            Episode {episode.episode_number ?? '—'} · {episode.title} · {episode.planned_date ?? 'no date'}
            {episode.production_id ? <> · <Link to={`/studio/${episode.production_id}?tool=Movie Mode`}>open Production</Link></> : null}
          </li>)}</ul>
          <p className="subtle">{generated.note}</p>
        </div>}

        {jobs.length > 0 && <div className="generate-jobs">
          <p className="eyebrow">DURABLE JOBS</p>
          <ul>{jobs.map(job => <li key={job.job_id}>
            <strong>{job.horizon}</strong> · {DEPTH_LABEL[job.depth]} · {job.state}
            {' '}· {job.created_count} created, {job.preserved_count} preserved, {job.blocked_count} blocked, {job.failed_count} failed
            {job.note ? <span className="subtle"> — {job.note}</span> : null}
            {(job.blocked_count > 0 || job.failed_count > 0) && <button type="button" disabled={guard}
              onClick={() => void run(() => longFormService.retry(workspaceId, job.job_id), () => 'Retried only the blocked and failed slots.')}>
              <RefreshCw size={12} /> Retry blocked slots</button>}
            {job.items.length > 0 && <ul className="generate-items">{job.items.map((item, index) => <li key={`${job.job_id}-${index}`}>
              {item.planned_date ?? item.slot_key ?? 'slot'} · {item.state}{item.error_message ? ` — ${item.error_message}` : ''}
            </li>)}</ul>}
          </li>)}</ul>
        </div>}
      </section>

      <section aria-label="Series Director" className="movie-mode-director">
        <p className="eyebrow">DIRECTOR · SERIES COMMAND</p>
        <form onSubmit={event => { event.preventDefault(); setDirectorAnswer(null);
          void longFormService.seriesDirectorScope(workspaceId, seriesId, directorText)
            .then(answer => setDirectorAnswer(`${answer.next_horizon_label ? `Horizon ${HORIZON_LABEL[answer.next_horizon_label as GenerateHorizon]}. ` : ''}Recent titles: ${answer.context.recent_titles.map(row => row.title).join(', ') || 'none'}. Avoid list: ${answer.context.avoid_list.join(', ') || 'empty'}. ${answer.rule}`))
            .catch(failure => setError(safeError(failure).message)); }}>
          <label>Direction<input value={directorText} onChange={event => setDirectorText(event.target.value)}
            placeholder="Plan next seven episodes but don't repeat this week's topics." /></label>
          <button type="submit" disabled={guard || !directorText.trim()}>Resolve Series scope</button>
        </form>
        {directorAnswer && <p role="status" className="subtle">{directorAnswer}</p>}
        <p className="subtle"><Clapperboard size={12} /> Series context is bounded to titles, dates and states.</p>
      </section>
    </>}
  </section>;
}

export { HORIZONS as GENERATE_HORIZONS, DEPTHS as GENERATE_DEPTHS };
