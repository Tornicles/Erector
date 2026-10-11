import type { StudioReadModel, StudioScene, StudioShot } from '../services/productions';

/**
 * Card-first Studio derivation (canonical card model = Scene, Shot = Shot).
 *
 * A visible Production Card maps 1:1 onto an existing canonical Scene — no new
 * table, no duplicated master. All functions here are pure and deterministic:
 * readiness, next actions and focus labels are derived from real read-model
 * state, never invented. Genuine creative reasoning stays server-side in the
 * Director APIs; this module only decides what truthful thing to show.
 */

export type CardReadiness = 'DRAFT' | 'NEEDS YOU' | 'READY' | 'RESULT READY' | 'COMPLETE';

export type CardExecution = 'REAL' | 'AI' | 'HYBRID' | 'PLANNING';

export interface CardNextAction {
  /** Button label, e.g. START THIS CARD / REVIEW RESULT. */
  label: string;
  /** One-line director-style instruction naming the real next step. */
  detail: string;
  /** Machine-readable kind so the shell can route to the real destination. */
  kind:
    | 'locked'
    | 'review_decision'
    | 'plan_coverage'
    | 'start_execution'
    | 'review_result'
    | 'run_playbook'
    | 'continue_next';
}

/** Display position of a Shot inside its Card, e.g. scene 3 second shot → 03B. */
export function shotDisplayId(sceneOrder: number, shotIndex: number): string {
  const letter = String.fromCharCode(65 + Math.min(Math.max(shotIndex, 0), 25));
  return `${String(sceneOrder).padStart(2, '0')}${letter}`;
}

export function cardReadiness(scene: StudioScene): CardReadiness {
  if (scene.approval === 'approved') return 'COMPLETE';
  if (scene.approval === 'needs_review' || scene.approval === 'changed_after_approval') return 'NEEDS YOU';
  const results = scene.shots.reduce((total, shot) => total + shot.result_count, 0);
  if (results > 0) return 'RESULT READY';
  if (scene.shots.length > 0) return 'READY';
  return 'DRAFT';
}

/** Dominant execution of a Card from its Shots; PLANNING when nothing is planned yet. */
export function cardExecution(scene: StudioScene): CardExecution {
  if (scene.shots.length === 0) return 'PLANNING';
  let real = 0;
  let ai = 0;
  let hybrid = 0;
  for (const shot of scene.shots) {
    if (shot.execution_method === 'ai') ai += 1;
    else if (shot.execution_method === 'hybrid') hybrid += 1;
    else real += 1;
  }
  if (hybrid > 0 && hybrid >= real && hybrid >= ai) return 'HYBRID';
  if (ai > real) return 'AI';
  if (real === 0 && ai === 0) return 'HYBRID';
  return 'REAL';
}

/**
 * The one clear next action for a Card, derived from real state.
 * Priority: lock respect → human decision → coverage → results → execution → continue.
 */
export function nextActionForScene(scene: StudioScene): CardNextAction {
  if (scene.locked_at) {
    return {
      label: 'LOCKED',
      detail: 'This card is locked. Unlock it from the card menu before TONDE or anyone changes it.',
      kind: 'locked',
    };
  }
  if (scene.approval === 'needs_review' || scene.approval === 'changed_after_approval') {
    return {
      label: 'REVIEW DECISION',
      detail: 'This card is waiting on you. Review the current state with TONDE, then approve or revise it.',
      kind: 'review_decision',
    };
  }
  if (scene.shots.length === 0) {
    return {
      label: 'PLAN COVERAGE',
      detail: `Card ${scene.order} has no Shots yet. Ask TONDE to plan its coverage.`,
      kind: 'plan_coverage',
    };
  }
  const results = scene.shots.reduce((total, shot) => total + shot.result_count, 0);
  if (results > 0) {
    const first = scene.shots.find(shot => shot.result_count > 0);
    return {
      label: 'REVIEW RESULT',
      detail: first
        ? `Shot ${first.title} has execution evidence. Review it against the plan before approving.`
        : 'Execution evidence is attached. Review it against the plan before approving.',
      kind: 'review_result',
    };
  }
  const execution = cardExecution(scene);
  if (execution === 'AI') {
    return {
      label: 'RUN THE PLAYBOOK',
      detail: 'TONDE prepared the AI playbook for this card. Run it in your external tool, then upload the Result.',
      kind: 'run_playbook',
    };
  }
  return {
    label: 'START THIS CARD',
    detail: execution === 'HYBRID'
      ? 'Shoot the real coverage first, then run the AI playbook for the generated beats.'
      : 'Shoot the first Shot. Real execution starts with the camera you actually have.',
    kind: 'start_execution',
  };
}

/** Shots of a Card in canonical order with their display ids. */
export function orderedShots(scene: StudioScene): Array<{ shot: StudioShot; index: number; displayId: string }> {
  return [...scene.shots]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((shot, index) => ({ shot, index, displayId: shotDisplayId(scene.order, index) }));
}

/** Scenes in canonical card order. */
export function orderedCards(model: StudioReadModel): StudioScene[] {
  return [...model.scenes].sort((a, b) => a.sort_order - b.sort_order || a.order - b.order);
}

export type StudioFocus =
  | { kind: 'shot'; scene: StudioScene; shot: StudioShot }
  | { kind: 'card'; scene: StudioScene }
  | { kind: 'production' };

/** Resolve URL selection to an explicit focus. Shot wins over Card, Card over Production. */
export function resolveFocus(model: StudioReadModel, sceneId: string | null, shotId: string | null): StudioFocus {
  const cards = orderedCards(model);
  if (shotId) {
    for (const scene of cards) {
      const shot = scene.shots.find(item => item.id === shotId);
      if (shot) return { kind: 'shot', scene, shot };
    }
    const orphan = model.orphan_shots.find(item => item.id === shotId);
    if (orphan && cards.length > 0) return { kind: 'shot', scene: cards[0], shot: orphan };
  }
  if (sceneId) {
    const scene = cards.find(item => item.id === sceneId);
    if (scene) return { kind: 'card', scene };
  }
  if (cards.length > 0) return { kind: 'card', scene: cards[0] };
  return { kind: 'production' };
}

export function focusLabel(focus: StudioFocus, model: StudioReadModel): string {
  if (focus.kind === 'shot') {
    const index = focus.scene.shots.findIndex(item => item.id === focus.shot.id);
    return `FOCUS · SHOT ${shotDisplayId(focus.scene.order, Math.max(index, 0))}`;
  }
  if (focus.kind === 'card') return `FOCUS · CARD ${String(focus.scene.order).padStart(2, '0')}`;
  return `FOCUS · ${model.production.title.toUpperCase().slice(0, 28) || 'PRODUCTION'}`;
}

/** Human scope sentence beside the Director command box. */
export function scopeText(focus: StudioFocus): string {
  if (focus.kind === 'shot') {
    const index = focus.scene.shots.findIndex(item => item.id === focus.shot.id);
    return `This will affect Shot ${shotDisplayId(focus.scene.order, Math.max(index, 0))} unless you say otherwise.`;
  }
  if (focus.kind === 'card') return `This will affect Card ${String(focus.scene.order).padStart(2, '0')} unless you say otherwise.`;
  return 'This will affect the whole Production unless you name a Card or Shot.';
}

export type DrawerSection =
  | 'details'
  | 'brief'
  | 'reality'
  | 'references'
  | 'story'
  | 'script'
  | 'assets'
  | 'audio'
  | 'results'
  | 'readiness'
  | 'versions'
  | 'impact'
  | 'continuity'
  | 'memory'
  | 'series'
  | 'exports'
  | 'publishing'
  | 'preview'
  | 'playbook'
  | 'realplan';

/**
 * Legacy `tool` query values map into the card/Shot focus model or a drawer
 * section. Anything else is dropped rather than rendered as a blank canvas,
 * so old deep links land on a real context instead of breaking.
 */
export function drawerSectionForTool(tool: string | null): DrawerSection | null {
  switch (tool) {
    case 'Story': return 'story';
    case 'Script': return 'script';
    case 'Brief': return 'brief';
    case 'Reality Check': return 'reality';
    case 'References': return 'references';
    case 'Characters': case 'World': case 'Products': case 'Wardrobe': case 'Style': return 'assets';
    case 'Audio': case 'Edit': case 'Prompts': return 'audio';
    case 'Results': return 'results';
    case 'Readiness': return 'readiness';
    case 'Versions': return 'versions';
    case 'Impact': return 'impact';
    case 'Exports': return 'exports';
    case 'Publishing': return 'publishing';
    case 'Movie Mode': return 'preview';
    case 'AI Creation': return 'playbook';
    case 'Real Production': return 'realplan';
    case 'Continuity': return 'continuity';
    case 'Memory': return 'memory';
    case 'Series': return 'series';
    case 'Idea': case 'Hybrid': return 'details';
    default: return null;
  }
}
