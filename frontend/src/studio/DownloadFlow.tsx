import { useEffect, useMemo, useRef, useState } from 'react';
import { safeError } from '../services/errors';
import { exportService, type DownloadScopeRefs } from '../services/exports';
import { longFormService } from '../services/longForm';
import type { StudioReadModel, StudioScene } from '../services/productions';
import {
  availableChoices,
  availableIncludes,
  buildScope,
  cardRef,
  creatingMessage,
  type DownloadAct,
  type DownloadChoice,
} from './downloadScope';
import { cardExecution, cardGaps, cardReadiness, nextActionForScene, orderedCards, orderedShots } from './cards';

/**
 * Card-native DOWNLOAD (canonical Download Sequence: Choose → Set up → Create → Download).
 *
 * Every creator-facing download is a PDF of the Studio Cards themselves, rendered server-side from
 * the pinned Production version — never a redesigned report, and never demo fixtures. The dialog
 * reuses `exportService` request/build/download polling, so Step 3 reports real export state
 * (requested → building → ready/failed) instead of fake progress percentages.
 *
 * The preview uses {@link CardPrintView}, the print presentation of the same Card model Studio
 * renders interactively: same content hierarchy and derivation (`cards.ts`), with buttons, inputs
 * and hover chrome removed, videos reduced to representative intent text, and collapsed sections
 * expanded. Studio and PDF share one source of truth and cannot drift apart.
 */

type FlowChoice = DownloadChoice | 'shot';

export interface DownloadFlowInitial {
  choice?: FlowChoice;
  sceneId?: string | null;
  shotId?: string | null;
}

function pad(order: number): string {
  return String(order).padStart(2, '0');
}

/** Print presentation of one Production Card: no buttons, no inputs, everything expanded. */
export function CardPrintView({ scene, style }: { scene: StudioScene; style: 'standard' | 'print' }) {
  const readiness = cardReadiness(scene);
  const execution = cardExecution(scene);
  const action = nextActionForScene(scene);
  const shots = orderedShots(scene);
  const gaps = cardGaps(scene);
  return (
    <article className={`pcp-card pcp-${style}`} aria-label={`Print preview of Card ${pad(scene.order)}`}>
      <header className="pcp-head">
        <span className="pcp-brand">TONDE · {cardRef(scene.order)}</span>
        <span className="pcp-status">
          {execution} · {readiness}
        </span>
      </header>
      <h4 className="pcp-title">{scene.title}</h4>
      {scene.purpose && <p className="pcp-purpose">{scene.purpose}</p>}
      <div className="pcp-visual" aria-hidden="true">
        <span className="pcp-k">VISUAL</span>
        <p>{scene.visual_intent || 'No visual intent recorded.'}</p>
      </div>
      <section className="pcp-section">
        <h5>WHAT HAPPENS</h5>
        <p>{scene.description || 'Tell TONDE what should happen here.'}</p>
      </section>
      {(scene.opening_state || scene.ending_state) && (
        <section className="pcp-section">
          <h5>CONTINUITY</h5>
          {scene.opening_state && <p>Starts: {scene.opening_state}</p>}
          {scene.ending_state && <p>Ends: {scene.ending_state}</p>}
        </section>
      )}
      {scene.action_lines.length > 0 && (
        <section className="pcp-section">
          <h5>ACTOR / SUBJECT DIRECTION</h5>
          <ul>
            {scene.action_lines.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </section>
      )}
      {shots.length > 0 && (
        <section className="pcp-section">
          <h5>SHOTS · {shots.length}</h5>
          <ul className="pcp-shots">
            {shots.map(({ shot, displayId }) => (
              <li key={shot.id}>
                <strong>
                  {displayId} · {shot.title}
                </strong>
                <span>
                  {[shot.framing, shot.movement, shot.execution_method.toUpperCase()]
                    .filter(Boolean)
                    .join(' · ')}
                  {shot.planned_duration_ms != null
                    ? ` · ${(shot.planned_duration_ms / 1000).toFixed(1)}s`
                    : ' · untimed'}
                </span>
                {shot.purpose && <span>{shot.purpose}</span>}
                {shot.direction?.has_plan && <span>Plan: {shot.direction.plan_status}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {gaps.length > 0 && (
        <section className="pcp-section pcp-gaps">
          <h5>BEFORE YOU SHOOT</h5>
          <ul>
            {gaps.slice(0, 6).map((gap, index) => (
              <li key={index}>Still needed: {gap}</li>
            ))}
          </ul>
        </section>
      )}
      <footer className="pcp-next">
        <span className="pcp-k">NEXT ACTION</span>
        <p>
          <strong>{action.label}</strong> — {action.detail}
        </p>
      </footer>
    </article>
  );
}

export function DownloadFlow({
  workspaceId,
  productionId,
  model,
  focusSceneId,
  focusShotId,
  initial,
  onClose,
}: {
  workspaceId: string;
  productionId: string;
  model: StudioReadModel;
  focusSceneId: string | null;
  focusShotId: string | null;
  initial: DownloadFlowInitial;
  onClose: () => void;
}) {
  const cards = useMemo(() => orderedCards(model), [model]);
  const [acts, setActs] = useState<DownloadAct[]>([]);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(initial.shotId ? 2 : 1);
  const [choice, setChoice] = useState<FlowChoice>(
    initial.shotId ? 'shot' : (initial.choice ?? 'current'),
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    if (initial.sceneId) return [initial.sceneId];
    if (initial.choice === 'selected' || !initial.choice) return [];
    return [];
  });
  const [actId, setActId] = useState<string | null>(null);
  const [style, setStyle] = useState<'standard' | 'print'>('standard');
  const [include, setInclude] = useState<Record<string, boolean>>({});
  const [withResults, setWithResults] = useState(true);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [fileMeta, setFileMeta] = useState('');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const attempt = useRef(0);

  const focusScene = cards.find(scene => scene.id === (initial.sceneId ?? focusSceneId)) ?? cards[0] ?? null;
  const focusShot = useMemo(() => {
    const wanted = initial.shotId ?? focusShotId;
    if (!wanted) return null;
    for (const scene of cards) {
      const shot = scene.shots.find(item => item.id === wanted);
      if (shot) return { scene, shot };
    }
    return null;
  }, [cards, initial.shotId, focusShotId]);

  // Groups resolve from long-form structure; when unreadable the group option is omitted rather
  // than offered with invented membership.
  useEffect(() => {
    let active = true;
    longFormService
      .structure(workspaceId, productionId, { level: 'production', limit: 100 })
      .then(page => {
        if (!active) return;
        const groups = page.items
          .filter(item => item.level === 'act')
          .map(item => ({ id: item.id, title: item.title }));
        setActs(groups);
        setActId(current => current ?? groups[0]?.id ?? null);
      })
      .catch(() => {
        if (active) setActs([]);
      });
    return () => {
      active = false;
    };
  }, [workspaceId, productionId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const choices = useMemo(
    () => availableChoices(model, focusScene?.id ?? null, acts),
    [model, focusScene, acts],
  );

  const effectiveChoice: FlowChoice =
    choice === 'shot'
      ? 'shot'
      : choices.some(option => option.choice === (choice as DownloadChoice))
        ? choice
        : 'full';

  const scopedSceneIds = useMemo(() => {
    if (effectiveChoice === 'shot') return focusShot ? [focusShot.scene.id] : [];
    if (effectiveChoice === 'current') return focusScene ? [focusScene.id] : [];
    if (effectiveChoice === 'selected') return selectedIds;
    if (effectiveChoice === 'shoot') {
      return cards
        .filter(scene => cardExecution(scene) === 'REAL' || cardExecution(scene) === 'HYBRID')
        .map(scene => scene.id);
    }
    return cards.map(scene => scene.id);
  }, [effectiveChoice, focusShot, focusScene, selectedIds, cards]);

  const includes = useMemo(() => availableIncludes(model, scopedSceneIds), [model, scopedSceneIds]);

  useEffect(() => {
    setInclude(current => {
      const next: Record<string, boolean> = {};
      for (const option of includes) next[option.key] = current[option.key] ?? true;
      return next;
    });
  }, [includes]);

  const previewScene =
    cards.find(scene => scene.id === scopedSceneIds[0]) ?? focusScene ?? cards[0] ?? null;

  const choiceLabel =
    effectiveChoice === 'shot' && focusShot
      ? `Shot ${pad(focusShot.scene.order)}${String.fromCharCode(65 + Math.max(focusShot.scene.shots.findIndex(item => item.id === focusShot.shot.id), 0))}`
      : (choices.find(option => option.choice === effectiveChoice)?.title ?? 'Full Production');

  function scopeForRequest(): { scope_type: 'full_production' | 'current_card' | 'selected_cards' | 'episode' | 'shot_prompt'; scope_refs: DownloadScopeRefs } {
    const setup = { style, include, withResults };
    if (effectiveChoice === 'shot' && focusShot) {
      return {
        scope_type: 'shot_prompt',
        scope_refs: { ...setup, shot_ids: [focusShot.shot.id] },
      };
    }
    const built = buildScope(
      effectiveChoice as DownloadChoice,
      model,
      { sceneIds: scopedSceneIds, shotId: null, actId },
      setup,
    );
    return built;
  }

  async function createPdf() {
    const run = ++attempt.current;
    setBusy(true);
    setError(null);
    setStatus(creatingMessage(effectiveChoice === 'shot' ? 'current' : effectiveChoice, choiceLabel));
    setStep(3);
    try {
      const scope = scopeForRequest();
      const requested = await exportService.request(workspaceId, {
        production_id: productionId,
        kind: 'full_document',
        format: 'pdf',
        scope_type: scope.scope_type,
        scope_refs: scope.scope_refs,
      });
      if (run !== attempt.current) return;
      setStatus(`Rendering ${choiceLabel} from Production revision ${requested.production_revision}…`);
      let state = requested.state;
      const exportId = requested.export_id;
      if (state === 'requested' || state === 'building') {
        // The build route returns the export_complete record, which names the export as
        // `export_id` (not `id`): the id from the request is stable, so it is kept as-is.
        const built = await exportService.build(workspaceId, exportId);
        if (run !== attempt.current) return;
        state = built.state;
      }
      // A build that stays asynchronous reports real state until it resolves; nothing is faked.
      for (let poll = 0; poll < 60 && (state === 'requested' || state === 'building'); poll += 1) {
        await new Promise(resolve => window.setTimeout(resolve, 2000));
        if (run !== attempt.current) return;
        const detail = await exportService.detail(workspaceId, exportId);
        state = detail.state;
        if (state === 'ready' || state === 'failed') {
          const manifest = (detail.manifest ?? {}) as {
            files?: Array<{ path: string }>;
            scope?: { pages?: number; cards?: number; style?: string };
          };
          if (state === 'ready') {
            const pages = manifest.scope?.pages;
            const cardCount = manifest.scope?.cards;
            setFileName(manifest.files?.[0]?.path ?? 'TONDE_Production.pdf');
            setFileMeta(
              `PDF · Landscape · ${pages != null ? `${pages} page${pages === 1 ? '' : 's'}` : 'multiple pages'}` +
                (cardCount != null ? ` · ${cardCount} card${cardCount === 1 ? '' : 's'}` : ''),
            );
            const authorized = await exportService.download(workspaceId, exportId);
            if (run !== attempt.current) return;
            if (!authorized.download_url) {
              throw new Error(
                authorized.note ??
                  'Download authorized, but no signed link could be produced in this environment.',
              );
            }
            setDownloadUrl(authorized.download_url);
            setStep(4);
            return;
          }
          throw new Error(
            detail.failure_message ?? `The PDF build reported ${detail.state}. Nothing was downloaded.`,
          );
        }
        setStatus(`Rendering ${choiceLabel}… (${detail.state})`);
      }
      if (state === 'ready') {
        const detail = await exportService.detail(workspaceId, exportId);
        if (run !== attempt.current) return;
        const manifest = (detail.manifest ?? {}) as {
          files?: Array<{ path: string }>;
          scope?: { pages?: number; cards?: number };
        };
        const pages = manifest.scope?.pages;
        const cardCount = manifest.scope?.cards;
        setFileName(manifest.files?.[0]?.path ?? 'TONDE_Production.pdf');
        setFileMeta(
          `PDF · Landscape · ${pages != null ? `${pages} page${pages === 1 ? '' : 's'}` : 'multiple pages'}` +
            (cardCount != null ? ` · ${cardCount} card${cardCount === 1 ? '' : 's'}` : ''),
        );
        const authorized = await exportService.download(workspaceId, exportId);
        if (run !== attempt.current) return;
        if (!authorized.download_url) {
          throw new Error(
            authorized.note ??
              'Download authorized, but no signed link could be produced in this environment.',
          );
        }
        setDownloadUrl(authorized.download_url);
        setStep(4);
        return;
      }
      throw new Error(`The PDF build reported ${state}. Nothing was downloaded.`);
    } catch (failure) {
      if (run !== attempt.current) return;
      setError(safeError(failure).message);
      setStep(2);
    } finally {
      if (run === attempt.current) setBusy(false);
    }
  }

  const canContinue =
    effectiveChoice === 'selected' ? selectedIds.length > 0 : scopedSceneIds.length > 0;
  const hasResults = cards.some(scene => scene.shots.some(shot => shot.result_count > 0));

  return (
    <div className="dl-scrim" onClick={onClose}>
      <section
        className="dl-flow"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dl-title"
        onClick={event => event.stopPropagation()}
      >
        <header className="dl-top">
          <div>
            <strong id="dl-title">DOWNLOAD</strong>
            <small>
              {step === 1 && 'Choose what you want outside TONDE.'}
              {step === 2 && 'Set up the PDF.'}
              {step === 3 && 'Creating your PDF.'}
              {step === 4 && 'Your PDF is ready.'}
            </small>
          </div>
          <ol className="dl-steps" aria-label="Download progress">
            {['Choose', 'Set up', 'Create', 'Download'].map((label, index) => (
              <li key={label} className={step === index + 1 ? 'active' : step > index + 1 ? 'done' : ''}>
                <i aria-hidden="true">{step > index + 1 ? '✓' : index + 1}</i> {label}
              </li>
            ))}
          </ol>
          <button type="button" className="cs-btn" onClick={onClose} autoFocus>
            Close
          </button>
        </header>

        {step === 1 && (
          <div className="dl-body">
            <h2>What do you want to download?</h2>
            <p className="subtle">
              Everything stays editable in TONDE. Downloads are landscape PDF Cards made from the
              Production you already built.
            </p>
            <div className="dl-keep">
              <div>
                <strong>Keep everything in TONDE</strong>
                <small>You do not need to download anything to keep directing or reviewing.</small>
              </div>
              <button type="button" className="cs-btn" onClick={onClose}>
                BACK TO STUDIO
              </button>
            </div>
            <div className="dl-choices" role="radiogroup" aria-label="Download scope">
              {choices.map(option => (
                <button
                  key={option.choice}
                  type="button"
                  role="radio"
                  aria-checked={effectiveChoice === option.choice}
                  className={`dl-choice${effectiveChoice === option.choice ? ' selected' : ''}`}
                  onClick={() => setChoice(option.choice)}
                >
                  <span className="dl-tag">{option.tag}</span>
                  <strong>{option.title}</strong>
                  <p>{option.description}</p>
                  <span className="dl-foot">{option.foot}</span>
                </button>
              ))}
            </div>
            <div className="dl-nav">
              <button type="button" className="cs-primary" onClick={() => setStep(2)}>
                CONTINUE →
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="dl-body">
            <h2>{effectiveChoice === 'shot' ? 'Shot prompt Card PDF' : choiceLabel} PDF</h2>
            <p className="subtle">
              TONDE lays the selected material out as landscape Cards. If a Card needs more space, it
              continues onto another page instead of shrinking the text.
            </p>
            {error && (
              <p className="error-text" role="alert">
                {error} <button type="button" className="cs-btn" onClick={() => void createPdf()} disabled={busy}>Retry</button>
              </p>
            )}
            <div className="dl-configure">
              <div className="dl-options">
                {effectiveChoice === 'selected' && (
                  <fieldset>
                    <legend>Cards</legend>
                    {cards.map(scene => (
                      <label key={scene.id} className="dl-check">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(scene.id)}
                          onChange={() =>
                            setSelectedIds(current =>
                              current.includes(scene.id)
                                ? current.filter(id => id !== scene.id)
                                : [...current, scene.id],
                            )
                          }
                        />
                        Card {pad(scene.order)} · {scene.title}
                      </label>
                    ))}
                    {selectedIds.length === 0 && (
                      <p className="subtle" role="status">Choose at least one card to download.</p>
                    )}
                  </fieldset>
                )}
                {effectiveChoice === 'episode' && acts.length > 0 && (
                  <label className="dl-field">
                    <span>Group</span>
                    <select aria-label="Group" value={actId ?? ''} onChange={event => setActId(event.target.value)}>
                      {acts.map(act => (
                        <option key={act.id} value={act.id}>
                          {act.title}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="dl-field">
                  <span id="dl-style-label">PDF style</span>
                  <div role="group" aria-labelledby="dl-style-label" className="dl-toggles">
                    <button
                      type="button"
                      aria-pressed={style === 'standard'}
                      className={style === 'standard' ? 'active' : ''}
                      onClick={() => setStyle('standard')}
                    >
                      TONDE Standard
                    </button>
                    <button
                      type="button"
                      aria-pressed={style === 'print'}
                      className={style === 'print' ? 'active' : ''}
                      onClick={() => setStyle('print')}
                    >
                      Print-friendly
                    </button>
                  </div>
                </div>
                <fieldset>
                  <legend>Include</legend>
                  {includes.map(option => (
                    <div key={option.key} className="dl-check">
                      <div>
                        <strong>{option.label}</strong>
                        <small>{option.description}</small>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={include[option.key] ?? true}
                        aria-label={option.label}
                        className={`dl-switch${(include[option.key] ?? true) ? ' on' : ''}`}
                        onClick={() =>
                          setInclude(current => ({ ...current, [option.key]: !(current[option.key] ?? true) }))
                        }
                      />
                    </div>
                  ))}
                  {hasResults && (
                    <label className="dl-check">
                      <span>
                        <strong>Approved Results</strong>
                        <small>Render Result frames inside their Cards</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={withResults}
                        onChange={() => setWithResults(value => !value)}
                      />
                    </label>
                  )}
                </fieldset>
                <p className="subtle">PDF layout: US Letter landscape. Longer Cards continue as Page 2, Page 3, etc.</p>
              </div>
              <aside className="dl-preview" aria-label="PDF preview">
                <p className="eyebrow">PDF PREVIEW · LANDSCAPE CARD</p>
                <div className="dl-paper">
                  {previewScene ? (
                    <CardPrintView scene={previewScene} style={style} />
                  ) : (
                    <p className="subtle">Nothing selected yet.</p>
                  )}
                </div>
                <p className="subtle">
                  Preview of the actual Card rendering at reduced scale. Longer Cards continue onto
                  additional pages rather than shrinking text.
                </p>
              </aside>
            </div>
            <div className="dl-nav">
              {!initial.shotId && (
                <button type="button" className="cs-btn" onClick={() => setStep(1)}>
                  ← Back
                </button>
              )}
              <button
                type="button"
                className="cs-primary"
                disabled={busy || !canContinue}
                onClick={() => void createPdf()}
              >
                {busy ? 'CREATING…' : 'CREATE PDF →'}
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="dl-body dl-center">
            <div className="dl-spinner" aria-hidden="true" />
            <h2>Creating your PDF.</h2>
            <p role="status">{status || 'Talking to the export builder…'}</p>
          </div>
        )}

        {step === 4 && (
          <div className="dl-body dl-center">
            <div className="dl-checkmark" aria-hidden="true">✓</div>
            <h2>Your PDF is ready.</h2>
            <p className="subtle">
              {choiceLabel} · {style === 'standard' ? 'TONDE Standard' : 'Print-friendly'} · landscape.
              The live Production remains unchanged and editable inside TONDE.
            </p>
            <div className="dl-file">
              <div>
                <strong>{fileName}</strong>
                <small>{fileMeta}</small>
              </div>
              <span className="dl-file-tag">PDF</span>
            </div>
            <div className="dl-nav">
              <button type="button" className="cs-btn" onClick={onClose}>
                Back to Studio
              </button>
              {downloadUrl && (
                <a className="cs-primary dl-download" href={downloadUrl} download={fileName}>
                  DOWNLOAD PDF ↓
                </a>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

