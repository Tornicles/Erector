import { useMemo } from 'react';
import type { CardFocusArea, StudioScene, StudioShot } from '../services/productions';
import { orderedShots, shotDisplayId } from './cards';
import {
  CARD_FOCUS_AREAS, cardMode, cardStatusOf, expandedCardSections, focusLabelFor,
} from './floating';

const FOCUS_TABS: Array<{ key: CardFocusArea; label: string }> = [
  { key: 'card', label: 'OVERVIEW' },
  ...CARD_FOCUS_AREAS.map(item => ({ key: item.area, label: item.label })),
];

/** Which canonical section a focus area shows. Overview shows all of them. */
const FOCUS_SECTION: Record<Exclude<CardFocusArea, 'card'>, string> = {
  subject: 'subject_direction',
  camera: 'camera_direction',
  look: 'look_direction',
  audio: 'audio_direction',
  location: 'location_direction',
};

const HEAD_SECTIONS = ['what_happens', 'director_direction'];

/**
 * The expanded Card is the SAME Card as the floating one: full canonical content, never a second
 * record, and never a separate tool. Only one Shot's full execution detail is open at a time.
 */
export function CardExpanded({ scene, focus, expandedShotId, onFocusChange, onExpandShot,
  onOpenShot, onBack, nextAction, nextActionLabel }: {
  scene: StudioScene; focus: CardFocusArea; expandedShotId: string | null;
  onFocusChange: (focus: CardFocusArea) => void; onExpandShot: (shotId: string | null) => void;
  onOpenShot: (shotId: string) => void; onBack: () => void;
  nextAction: string; nextActionLabel: string;
}) {
  const sections = useMemo(() => expandedCardSections(scene), [scene]);
  const shots = useMemo(() => orderedShots(scene), [scene]);
  // Which Shot is open is owned by the shell (it is deep-linkable Card state), never duplicated here:
  // one Card must not be able to disagree with itself about its own open Shot.
  const openShot = expandedShotId;

  const section = (key: string) => sections.find(item => item.key === key);
  const visibleKeys = focus === 'card'
    ? sections.map(item => item.key)
    : [FOCUS_SECTION[focus]];
  const seconds = Math.round((scene.duration_ms || scene.planned_duration_ms || 0) / 1000);
  const areaLabel = focus === 'card' ? null : CARD_FOCUS_AREAS.find(item => item.area === focus)?.label ?? null;

  return <section className="cs-cx" aria-label={`Card ${scene.order} expanded`}>
    <div className="cs-cx-head">
      <button type="button" className="cs-btn" onClick={onBack}>← BACK TO PRODUCTION</button>
      <p className="eyebrow" role="status">{focusLabelFor(scene, focus, {
        shotDisplayId: openShot ? shotDisplayId(scene.order, shots.findIndex(item => item.shot.id === openShot)) : null,
      })}</p>
      <span className="cs-cx-meta">Card {scene.order} of {scene.order} · {seconds} sec</span>
    </div>

    <article className="cs-cx-card">
      <div className={`cs-visual cs-v${(scene.order % 6) + 1}`} aria-hidden="true">
        <span className="cs-scene-number">CARD {String(scene.order).padStart(2, '0')}</span>
        <span className="cs-exec">{cardMode(scene)}</span>
        <span className="cs-visual-tag"><span className="cs-tiny-dot" aria-hidden="true" />{visualCaption(scene)}</span>
      </div>

      <div className="cs-cx-body">
        <div className="cs-cx-title">
          <div>
            <p className="eyebrow">CARD {String(scene.order).padStart(2, '0')} · {cardMode(scene)}</p>
            <h2>{section('title')?.body || scene.title}</h2>
          </div>
          <div className="cs-cx-facts">
            <strong>{shots.length} SHOT{shots.length === 1 ? '' : 'S'}</strong>
            <span>{seconds} sec · {status}</span>
          </div>
        </div>

        <p className="cs-cx-summary">{section('summary')?.body || scene.description || scene.purpose}</p>
        {scene.card_status_detail && <p className="cs-cx-status" role="status">{scene.card_status_detail}</p>}

        <div className="cs-cx-core">
          {HEAD_SECTIONS.map(key => {
            const item = section(key);
            if (!item) return null;
            return <div className="cs-cx-panel" key={key}>
              <p className="cs-label">{item.label}</p>
              <p className="cs-copy">{item.body || `TONDE is still writing ${item.label.toLowerCase()} for this Card. ${item.job}`}</p>
            </div>;
          })}
        </div>

        <div className="cs-cx-tabs" role="tablist" aria-label="Card focus">
          {FOCUS_TABS.map(tab => <button key={tab.key} type="button" role="tab" className="cs-cx-tab"
            aria-selected={focus === tab.key} aria-pressed={focus === tab.key}
            onClick={() => { onFocusChange(tab.key); onExpandShot(null); }}>{tab.label}</button>)}
        </div>

        <div className="cs-cx-focus">
          {visibleKeys.map(key => {
            const item = section(key);
            if (!item) return null;
            return <section key={key} className="cs-cx-section" aria-label={item.label}>
              <p className="eyebrow">FOCUS · {item.label}</p>
              <p className="cs-cx-copy">{item.body || `No direction written for ${item.label.toLowerCase()} yet. ${item.job}`}</p>
              <p className="cs-cx-detail">{item.job}</p>
            </section>;
          })}
          {focus !== 'card' && <p className="cs-cx-detail">
            {areaLabel} stays inside Card {String(scene.order).padStart(2, '0')}. Ask TONDE in the Director panel to
            change it — the change keeps this Card's objective unless continuity forces a downstream update.
          </p>}
        </div>

        <div className="cs-cx-shots">
          <div className="cs-cx-shots-head">
            <h3>Shots / Generation Units</h3>
            <span>Camera cuts live inside the Card — one Shot opens at a time.</span>
          </div>
          <div className="cs-cx-shot-grid">
            {shots.map(({ shot, displayId }) => <button key={shot.id} type="button" data-shot={shot.id}
              className={`cs-cx-shot${openShot === shot.id ? ' active' : ''}`}
              aria-pressed={openShot === shot.id}
              onClick={() => onExpandShot(openShot === shot.id ? null : shot.id)}>
              <span className="cs-cx-shot-id">{displayId} · {shot.execution_method === 'real' ? 'REAL' : shot.execution_method === 'ai' ? 'AI' : 'HYBRID'}</span>
              <strong>{shot.title}</strong>
              <small>{shot.planned_duration_ms ? `${Math.round(shot.planned_duration_ms / 1000)} sec · ` : ''}
                {shot.purpose || shot.action || 'Direction still building.'}</small>
            </button>)}
            {shots.length === 0 && <p className="cs-copy">Coverage for this Card is still building. Ask TONDE to plan the Shots for this Card.</p>}
          </div>

          {shots.filter(item => item.shot.id === openShot).map(({ shot, displayId }) => <div key={shot.id} className="cs-cx-shot-detail">
            <div className="cs-cx-shot-head">
              <div>
                <p className="eyebrow">SHOT {displayId} · {shot.execution_method === 'real' ? 'REAL' : shot.execution_method === 'ai' ? 'AI GENERATION UNIT' : 'HYBRID'}</p>
                <h3>{shot.title}</h3>
              </div>
              <span className="cs-cx-meta">{shot.planned_duration_ms ? `${Math.round(shot.planned_duration_ms / 1000)} sec` : 'duration open'} · {shot.approval.replace('_', ' ')}</span>
            </div>
            <dl className="cs-cx-exec">
              <ExecRow label="PURPOSE" value={shot.purpose} />
              <ExecRow label="ACTION / TIMING" value={shot.action} detail={shot.transition} />
              <ExecRow label="FRAMING" value={shot.framing} />
              <ExecRow label="ANGLE / HEIGHT" value={shot.angle} />
              <ExecRow label="MOVEMENT" value={shot.movement} />
              <ExecRow label="COMPOSITION" value={shot.composition} />
              <ExecRow label="SUBJECT / PERFORMANCE" value={shot.subject} />
              <ExecRow label="CREATIVE NOTES" value={shot.creative_notes} />
              <ExecRow label="STORY RELATIONSHIP" value={shot.story_relationship} />
            </dl>
            <p className="cs-cx-detail">{shot.execution_method === 'real'
              ? 'Sufficient when every required line above is present. Success and retake criteria come from this Card\u2019s readiness check.'
              : 'AI Generation Unit: open the compiled prompt, generate externally, then attach the Result back to this Shot.'}
              {shot.result_count > 0 ? ` ${shot.result_count} Result${shot.result_count === 1 ? '' : 's'} attached for inspection.` : ''}</p>
            <div className="cs-cx-shot-actions">
              <button type="button" className="cs-btn" onClick={() => onOpenShot(shot.id)}>
                {shot.execution_method === 'real' ? 'OPEN SHOOT PLAN →' : 'OPEN AI PROMPT →'}</button>
              <button type="button" className="cs-btn" onClick={() => onExpandShot(null)}>CLOSE SHOT</button>
            </div>
          </div>)}
        </div>

        <div className="cs-cx-bottom">
          {['continuity', 'resources'].map(key => {
            const item = section(key);
            if (!item) return null;
            return <div className="cs-cx-panel" key={key}>
              <p className="cs-label">{item.label}</p>
              <p className="cs-copy">{item.body || item.job}</p>
            </div>;
          })}
        </div>

        <div className="cs-cx-next">
          <div>
            <p className="eyebrow">NEXT ACTION</p>
            <p className="cs-cx-next-title">{nextAction}</p>
          </div>
          <button type="button" className="cs-primary" onClick={() => { const first = shots[0]; if (first) onExpandShot(first.shot.id); }}>
            {nextActionLabel} {shots.length > 0 ? '→' : ''}</button>
        </div>
      </div>
    </article>
  </section>;
}

function ExecRow({ label, value, detail }: { label: string; value: string; detail?: string }) {
  if (!value) return null;
  return <div>
    <dt className="cs-label">{label}</dt>
    <dd className="cs-copy">{value}{detail ? ` · ${detail}` : ''}</dd>
  </div>;
}

function visualCaption(scene: StudioScene) {
  const results = scene.shots.reduce((total, shot) => total + (shot.result_count ?? 0), 0);
  if (results === 0) return 'TARGET VISUAL · NO RESULT YET';
  return scene.approval === 'approved'
    ? 'APPROVED RESULT'
    : `${results} RESULT${results === 1 ? '' : 'S'} · WAITING FOR INSPECTION`;
}
