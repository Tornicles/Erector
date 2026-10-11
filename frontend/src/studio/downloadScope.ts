import type { StudioReadModel } from '../services/productions';
import { cardExecution, orderedCards } from './cards';
import type { DownloadScopeRefs, DownloadScopeType } from '../services/exports';

/**
 * Card-native DOWNLOAD scope derivation (pure, deterministic).
 *
 * Every creator-facing download is a PDF of the Studio Cards themselves. These helpers decide
 * *which* options make sense for the real Production state — never inventing content — and map a
 * chosen option onto the `scope_type` / `scope_refs` the export API pins to a Production version.
 * No demo fixtures: labels name real Card numbers, real counts and the real Production title.
 */

export type DownloadChoice =
  | 'current'
  | 'prompts'
  | 'shoot'
  | 'selected'
  | 'episode'
  | 'full';

export interface DownloadAct {
  id: string;
  title: string;
}

export interface ChoiceDescriptor {
  choice: DownloadChoice;
  tag: string;
  title: string;
  description: string;
  foot: string;
}

function pad(order: number): string {
  return String(order).padStart(2, '0');
}

/** Contextual Step-1 options. Impossible options are omitted, never shown disabled with fake data. */
export function availableChoices(
  model: StudioReadModel,
  focusSceneId: string | null,
  acts: DownloadAct[],
): ChoiceDescriptor[] {
  const cards = orderedCards(model);
  const focus = cards.find(scene => scene.id === focusSceneId) ?? cards[0] ?? null;
  const aiShots = cards.flatMap(scene =>
    scene.shots.filter(shot => shot.execution_method === 'ai' || shot.execution_method === 'hybrid'),
  );
  const realScenes = cards.filter(scene => {
    const execution = cardExecution(scene);
    return execution === 'REAL' || execution === 'HYBRID';
  });
  const options: ChoiceDescriptor[] = [];
  if (focus) {
    options.push({
      choice: 'current',
      tag: 'CURRENT WORK',
      title: `Current Card · ${pad(focus.order)}`,
      description: `Card ${pad(focus.order)} ${focus.title} as a landscape PDF with everything needed to execute this part of the Production.`,
      foot: '1 Card · PDF',
    });
  }
  if (aiShots.length > 0) {
    options.push({
      choice: 'prompts',
      tag: 'AI',
      title: 'AI Prompt Cards',
      description: `One landscape PDF with ready-to-use prompt Cards for the ${aiShots.length} AI generation unit${aiShots.length === 1 ? '' : 's'} in this Production.`,
      foot: 'Prompt deck · PDF',
    });
  }
  if (realScenes.length > 0) {
    options.push({
      choice: 'shoot',
      tag: 'REAL',
      title: 'Shoot Cards',
      description: `Landscape PDF Cards for the ${realScenes.length} REAL/HYBRID card${realScenes.length === 1 ? '' : 's'}: actor direction, blocking, camera, lighting, audio, resources and continuity.`,
      foot: 'On-set deck · PDF',
    });
  }
  if (cards.length > 1) {
    options.push({
      choice: 'selected',
      tag: 'CUSTOM RANGE',
      title: 'Selected Cards',
      description: 'Pick any Cards and combine them into one PDF in Production order.',
      foot: 'Custom deck · PDF',
    });
  }
  for (const act of acts) {
    const count = cards.length; // Act membership resolves server-side against the pinned version.
    options.push({
      choice: 'episode',
      tag: 'GROUP',
      title: act.title,
      description: `Every Production Card for this group assembled in order into one landscape PDF (${count} card${count === 1 ? '' : 's'} in this Production).`,
      foot: `${count} Cards · PDF`,
    });
    break; // One group option per flow instance; the group picker in Step 2 selects which.
  }
  options.push({
    choice: 'full',
    tag: 'COMPLETE PRODUCTION',
    title: 'Full Production',
    description: `All groups and all ${cards.length} Card${cards.length === 1 ? '' : 's'} — REAL directions, AI prompt Cards and approved Result summaries — in one Production PDF.`,
    foot: 'Production book · PDF',
  });
  return options;
}

export interface IncludeOption {
  key: string;
  label: string;
  description: string;
}

/** Step-2 toggles. A toggle is offered only when the selected Cards actually carry that section. */
export function availableIncludes(
  model: StudioReadModel,
  sceneIds: string[],
): IncludeOption[] {
  const cards = orderedCards(model).filter(scene => sceneIds.includes(scene.id));
  const has = (test: (sceneId: string) => boolean) => cards.some(scene => test(scene.id));
  const scenes = new Map(cards.map(scene => [scene.id, scene]));
  const shotCount = cards.reduce((total, scene) => total + scene.shots.length, 0);
  const aiCount = cards.reduce(
    (total, scene) =>
      total + scene.shots.filter(shot => shot.execution_method === 'ai' || shot.execution_method === 'hybrid').length,
    0,
  );
  const resultCount = cards.reduce(
    (total, scene) => total + scene.shots.reduce((sum, shot) => sum + shot.result_count, 0),
    0,
  );
  void has;
  const options: IncludeOption[] = [];
  if (cards.some(scene => scene.description)) {
    options.push({ key: 'what', label: 'What happens', description: 'The beat each Card covers' });
  }
  if (cards.some(scene => scene.purpose)) {
    options.push({ key: 'purpose', label: 'Story purpose', description: 'Why each Card exists' });
  }
  if (cards.some(scene => scene.visual_intent || scene.story_beat || scene.dialogue_notes)) {
    options.push({ key: 'direction', label: 'Director direction', description: 'Intent, story beat and dialogue notes' });
  }
  if (cards.some(scene => scene.action_lines.length > 0)) {
    options.push({ key: 'actor', label: 'Actor / subject direction', description: 'Action lines, performance and blocking' });
  }
  if (shotCount > 0) {
    options.push({ key: 'camera', label: 'Camera', description: 'Framing, movement and setup per Shot' });
    options.push({ key: 'shots', label: 'Shots / generation units', description: `${shotCount} execution unit${shotCount === 1 ? '' : 's'} inside these Cards` });
  }
  if (cards.some(scene => scene.opening_state || scene.ending_state)) {
    options.push({ key: 'continuity', label: 'Continuity', description: 'What must stay consistent' });
  }
  if (aiCount > 0) {
    options.push({ key: 'prompts', label: 'AI prompts', description: `Prompt Cards for ${aiCount} AI unit${aiCount === 1 ? '' : 's'}` });
  }
  if (resultCount > 0) {
    options.push({ key: 'result', label: 'Results', description: `${resultCount} approved Result${resultCount === 1 ? '' : 's'} rendered inside their Cards` });
  }
  options.push({ key: 'next_action', label: 'Next action', description: 'Exactly what to do next per Card' });
  void scenes;
  return options;
}

export interface BuiltScope {
  scope_type: DownloadScopeType;
  scope_refs: DownloadScopeRefs;
}

/** Map a UI choice onto the export request. `acts` resolves the group picker to a real act id. */
export function buildScope(
  choice: DownloadChoice,
  model: StudioReadModel,
  selection: { sceneIds: string[]; shotId: string | null; actId: string | null },
  setup: { style: 'standard' | 'print'; include: Record<string, boolean>; withResults: boolean },
): BuiltScope {
  const cards = orderedCards(model);
  const base: DownloadScopeRefs = {
    style: setup.style,
    include: setup.include,
    with_results: setup.withResults,
  };
  switch (choice) {
    case 'current': {
      const first = selection.sceneIds[0] ?? cards[0]?.id ?? '';
      return { scope_type: 'current_card', scope_refs: { ...base, scene_ids: first ? [first] : [] } };
    }
    case 'prompts': {
      const aiShotIds = cards.flatMap(scene =>
        scene.shots
          .filter(shot => shot.execution_method === 'ai' || shot.execution_method === 'hybrid')
          .map(shot => shot.id),
      );
      return { scope_type: 'shot_prompt', scope_refs: { ...base, shot_ids: aiShotIds } };
    }
    case 'shoot': {
      const realIds = cards
        .filter(scene => cardExecution(scene) === 'REAL' || cardExecution(scene) === 'HYBRID')
        .map(scene => scene.id);
      return { scope_type: 'selected_cards', scope_refs: { ...base, scene_ids: realIds } };
    }
    case 'selected':
      return { scope_type: 'selected_cards', scope_refs: { ...base, scene_ids: selection.sceneIds } };
    case 'episode':
      return {
        scope_type: 'episode',
        scope_refs: { ...base, act_id: selection.actId, scene_ids: selection.sceneIds },
      };
    case 'full':
      return { scope_type: 'full_production', scope_refs: base };
  }
}

/** Truthful Step-3 status lines. No percentages: the build reports what it is doing, not a fake share. */
export function creatingMessage(choice: DownloadChoice, detail: string): string {
  switch (choice) {
    case 'current':
      return `Preparing ${detail}…`;
    case 'prompts':
      return `Preparing ${detail}…`;
    case 'shoot':
      return `Rendering ${detail}…`;
    case 'selected':
      return `Rendering ${detail}…`;
    case 'episode':
      return `Creating ${detail}…`;
    case 'full':
      return `Preparing ${detail}…`;
  }
}

/** Card reference label, e.g. scene order 3 → CARD 03. */
export function cardRef(order: number): string {
  return `CARD ${pad(order)}`;
}
