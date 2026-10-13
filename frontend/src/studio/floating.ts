import type {
  CardDirection, CardFocusArea, CardStatus, StudioScene, StudioShot,
} from '../services/productions';
import { orderedShots, shotDisplayId } from './cards';

/**
 * The two presentations of ONE Card.
 *
 * The floating Card and the expanded Card are not different records: both read the canonical
 * Card-level direction the server wrote onto the Scene. The floating Card shows *summarized* values
 * of the same fields, so the two views can never contradict each other, and the whole floating Card
 * stays inside a visible word budget so it still reads as a Card rather than a report.
 *
 * Everything here is pure. Readiness, status and mode come from the server; this module only
 * decides what to show and how much of it.
 */

/** The areas a creator can select inside a Card, in the order the Card presents them. */
export const CARD_FOCUS_AREAS: Array<{ area: CardFocusArea; label: string; field: keyof CardDirection }> = [
  { area: 'subject', label: 'SUBJECT', field: 'subject_direction' },
  { area: 'camera', label: 'CAMERA', field: 'camera_direction' },
  { area: 'look', label: 'LOOK', field: 'look_direction' },
  { area: 'audio', label: 'AUDIO', field: 'audio_direction' },
  { area: 'location', label: 'LOCATION', field: 'location_direction' },
];

export const FLOATING_WORD_BUDGET = 180;

/** The expanded Card, in the order the product rules present it. */
export const EXPANDED_SECTIONS: Array<{ key: keyof CardDirection; label: string; job: string }> = [
  { key: 'title', label: 'TITLE', job: 'The Card in two to six words.' },
  { key: 'summary', label: 'SUMMARY', job: 'The Card at a glance.' },
  { key: 'what_happens', label: 'WHAT HAPPENS', job: 'Sequence and event progression.' },
  { key: 'director_direction', label: "DIRECTOR'S DIRECTION", job: 'Intention, pacing and emphasis.' },
  { key: 'audience_feeling', label: 'AUDIENCE SHOULD FEEL', job: 'The emotional effect on the audience.' },
  { key: 'subject_direction', label: 'SUBJECT / PERFORMANCE', job: 'What the subject does, and how.' },
  { key: 'camera_direction', label: 'CAMERA', job: 'How this Card is photographed.' },
  { key: 'look_direction', label: 'LOOK / LIGHTING', job: 'The visual world this Card lives in.' },
  { key: 'audio_direction', label: 'AUDIO / SOUND', job: 'What to capture, and what not to add.' },
  { key: 'location_direction', label: 'LOCATION', job: 'Place requirements and constraints.' },
  { key: 'continuity', label: 'CONTINUITY', job: 'Only what must stay consistent.' },
  { key: 'resources', label: 'NEEDED', job: 'People, props, wardrobe and gear.' },
  { key: 'next_action', label: 'NEXT ACTION', job: 'The single next step for this Card.' },
];

export function words(text: string | undefined | null): number {
  return (text ?? '').trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Shorten a canonical field for the floating Card without inventing new content: it keeps whole
 * sentences (or clauses) from the same text until the word budget for that area is reached.
 */
export function summarize(text: string | undefined, maxWords: number): string {
  const clean = (text ?? '').trim();
  if (!clean) return '';
  if (words(clean) <= maxWords) return clean;
  const pieces = clean.split(/(?<=[.!?])\s+/);
  const kept: string[] = [];
  for (const piece of pieces) {
    if (words([...kept, piece].join(' ')) > maxWords) break;
    kept.push(piece);
  }
  if (kept.length > 0) return kept.join(' ');
  // A single long sentence: cut on a clause boundary rather than mid-word.
  const tokens = clean.split(/\s+/);
  const head = tokens.slice(0, maxWords).join(' ');
  const clause = head.replace(/[,;]\s*[^,;]*$/, '');
  return `${clause || head}\u2026`;
}

export function cardDirection(scene: StudioScene): CardDirection {
  return scene.card_direction ?? {};
}

export function cardMode(scene: StudioScene): string {
  return (scene.card_mode ?? 'real').toUpperCase();
}

/** The server-derived status. A Card with no status from the server is honestly unknown, not READY. */
export function cardStatusOf(scene: StudioScene): CardStatus | 'UNKNOWN' {
  return scene.card_status ?? 'UNKNOWN';
}

export function directionField(scene: StudioScene, field: keyof CardDirection): string {
  return (cardDirection(scene)[field] ?? '').trim();
}

export interface FloatingArea {
  area: CardFocusArea;
  label: string;
  summary: string;
  /** True when the Card carries direction for this area at all. */
  written: boolean;
}

export interface FloatingCardView {
  sceneId: string;
  order: number;
  cardNumber: string;
  title: string;
  mode: string;
  status: CardStatus | 'UNKNOWN';
  statusDetail: string;
  durationSeconds: number;
  summary: string;
  whatLine: string;
  directorLine: string;
  audience: string;
  areas: FloatingArea[];
  shots: Array<{ shot: StudioShot; displayId: string; method: string; summary: string }>;
  continuityLine: string;
  neededLine: string;
  nextAction: string;
  /** Visible word total of the floating Card, checked against the budget. */
  visibleWords: number;
  withinBudget: boolean;
}

/**
 * The floating Card: fast to scan, never a report. Each area shows a short summary of the SAME
 * canonical field the expanded Card shows in full.
 */
export function floatingCardView(scene: StudioScene): FloatingCardView {
  const direction = cardDirection(scene);
  const areas = CARD_FOCUS_AREAS.map(item => {
    const value = (direction[item.field] ?? '').trim();
    return { area: item.area, label: item.label, summary: summarize(value, 9), written: Boolean(value) };
  });
  const shots = orderedShots(scene).map(({ shot, displayId }) => ({
    shot,
    displayId,
    method: (shot.execution_method ?? 'real').toUpperCase(),
    summary: summarize(shot.purpose || shot.action || shot.description, 14),
  }));
  const summary = summarize(direction.summary || scene.description || scene.purpose, 34);
  const whatLine = summarize(direction.what_happens || scene.purpose, 24);
  const directorLine = summarize(direction.director_direction || scene.visual_intent, 22);
  const audience = summarize(direction.audience_feeling, 12);
  const continuityLine = summarize(direction.continuity || scene.ending_state, 14);
  const neededLine = summarize(direction.resources, 12);
  const nextAction = (direction.next_action ?? '').trim();
  const visibleWords = [
    summary, whatLine, directorLine, audience, continuityLine, neededLine, nextAction,
    ...areas.map(item => item.summary),
    ...shots.slice(0, 4).map(item => item.summary),
  ].reduce((total, value) => total + words(value), 0);
  return {
    sceneId: scene.id,
    order: scene.order,
    cardNumber: String(scene.order).padStart(2, '0'),
    title: (direction.title || scene.title || '').trim(),
    mode: cardMode(scene),
    status: cardStatusOf(scene),
    statusDetail: scene.card_status_detail ?? '',
    durationSeconds: Math.round((scene.duration_ms || scene.planned_duration_ms || 0) / 1000),
    summary,
    whatLine,
    directorLine,
    audience,
    areas,
    shots,
    continuityLine,
    neededLine,
    nextAction,
    visibleWords,
    withinBudget: visibleWords <= FLOATING_WORD_BUDGET,
  };
}

/** The expanded Card: the same fields, complete, in the product's order. */
export function expandedCardSections(scene: StudioScene): Array<{ key: string; label: string; job: string; body: string }> {
  return EXPANDED_SECTIONS.map(item => ({
    key: item.key as string,
    label: item.label,
    job: item.job,
    body: directionField(scene, item.key),
  }));
}

/** The Director's focus line for the selected Card, area or Shot. */
export function focusLabelFor(scene: StudioScene, area: CardFocusArea, options: {
  shotDisplayId?: string | null; subjectLabel?: string | null;
} = {}): string {
  const card = `CARD ${String(scene.order).padStart(2, '0')}`;
  if (options.shotDisplayId) return `FOCUS · SHOT ${options.shotDisplayId}`;
  if (area === 'card') return `FOCUS · ${card}`;
  if (area === 'subject') {
    return `FOCUS · SUBJECT${options.subjectLabel ? ` · ${options.subjectLabel.toUpperCase()}` : ''}`;
  }
  return `FOCUS · ${area.toUpperCase()}`;
}

/**
 * Only one Shot's full execution detail may be expanded at a time; a 7-Shot Card must not become a
 * 3000-word page. Selecting the open Shot closes it.
 */
export function toggleExpandedShot(expandedShotId: string | null, requested: string | null): string | null {
  if (requested === null) return null;
  return expandedShotId === requested ? null : requested;
}

/** Card widths on the production timeline follow planned duration, so the sequence reads as time. */
export function timelineShares(scenes: StudioScene[]): Array<{ id: string; share: number; seconds: number }> {
  const durations = scenes.map(scene => Math.max(1, scene.duration_ms || scene.planned_duration_ms || 1));
  const total = durations.reduce((sum, value) => sum + value, 0) || 1;
  return scenes.map((scene, index) => ({
    id: scene.id,
    share: durations[index] / total,
    seconds: Math.round(durations[index] / 1000),
  }));
}

/** The visual a Card shows, in the product's priority: approved Result → latest Result → reference. */
export function cardVisualState(scene: StudioScene): { kind: 'APPROVED RESULT' | 'LATEST RESULT' | 'TARGET / REFERENCE'; detail: string } {
  const results = scene.shots.reduce((total, shot) => total + (shot.result_count ?? 0), 0);
  if (results > 0 && scene.approval === 'approved') {
    return { kind: 'APPROVED RESULT', detail: 'This Card shows the approved Result as production truth.' };
  }
  if (results > 0) {
    return { kind: 'LATEST RESULT', detail: 'Execution evidence exists and is waiting for inspection.' };
  }
  return {
    kind: 'TARGET / REFERENCE',
    detail: scene.visual_intent || 'No Result yet, so this Card shows its planned target.',
  };
}

/** The Shot display id for a Shot inside a Card, e.g. 03B. */
export function shotLabel(scene: StudioScene, shotId: string): string {
  const index = orderedShots(scene).findIndex(item => item.shot.id === shotId);
  return shotDisplayId(scene.order, Math.max(index, 0));
}
