import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  availableChoices,
  availableIncludes,
  buildScope,
  cardRef,
  creatingMessage,
} from '../studio/downloadScope';
import { CardPrintView } from '../studio/DownloadFlow';
import type { StudioReadModel, StudioScene } from '../services/productions';

const shot = (id: string, sceneId: string, overrides = {}) => ({
  id,
  scene_id: sceneId,
  order: 1,
  sort_order: 1024,
  title: `Shot ${id}`,
  description: '',
  action: '',
  purpose: 'establish',
  subject: '',
  framing: 'wide',
  angle: '',
  movement: '',
  composition: '',
  transition: '',
  story_relationship: '',
  story_beat: '',
  creative_notes: '',
  execution_method: 'real' as const,
  planned_duration_ms: 4000,
  approval: 'draft' as const,
  locked_at: null,
  revision: 1,
  updated_at: '2026-10-05T00:00:00Z',
  result_count: 0,
  bindings: [],
  ...overrides,
});

const scene = (id: string, order: number, overrides: Partial<StudioScene> = {}): StudioScene => ({
  id,
  order,
  sort_order: order * 1024,
  title: `Card ${order}`,
  purpose: 'Earn attention',
  story_beat: 'Hook',
  description: 'Something happens.',
  action_lines: [],
  opening_state: '',
  ending_state: '',
  visual_intent: '',
  dialogue_notes: '',
  environment_asset_id: null,
  planned_duration_ms: 8000,
  duration_ms: 8000,
  timing: 'derived',
  approval: 'draft',
  locked_at: null,
  revision: 1,
  updated_at: '2026-10-05T00:00:00Z',
  character_asset_ids: [],
  dialogue_lines: 0,
  shot_count: 0,
  bindings: [],
  shots: [],
  ...overrides,
});

const model = (scenes: StudioScene[] = []): StudioReadModel => ({
  production: {
    id: 'prod-1',
    workspace_id: 'ws-1',
    title: 'Ridgeway coffee',
    production_type: 'commercial',
    custom_type: null,
    execution_method: 'real',
    planned_duration_ms: 30000,
    calculated_duration_ms: 30000,
    approval: 'draft',
    locked_at: null,
    revision: 7,
    lifecycle: 'active',
    updated_at: '2026-10-05T00:00:00Z',
  },
  scenes,
  orphan_shots: [],
  assets: [],
  documents: {},
  timing: { total_ms: 0, target_ms: null, delta_ms: null, status: 'unresolved', scene_states: [] },
  runtime_conflict: false,
  timeline: [],
  status_summary: {
    production_approval: 'draft',
    production_locked: false,
    scenes: scenes.length,
    shots: 0,
    scenes_locked: 0,
    shots_locked: 0,
    approval_counts: {},
    needs_attention: 0,
  },
  truncated: false,
  provider: {
    provider: 'openai_compatible',
    configured: false,
    model_profile: 'default',
    capabilities: [],
    notes: [],
    ffmpeg_available: false,
    ffmpeg_note: '',
  },
  capabilities: {
    frame_extraction: false,
    frame_extraction_note: '',
    timeline_editing: true,
    shot_execution: false,
    ai_prompt_compilation: false,
    note: '',
  },
});

describe('download scope derivation', () => {
  it('names the current card with its real number and title, never demo fixtures', () => {
    const current = model([scene('a', 3, { title: 'Ridge Opening' })]);
    const options = availableChoices(current, 'a', []);
    const choice = options.find(option => option.choice === 'current');
    expect(choice?.title).toContain('03');
    expect(choice?.description).toContain('Ridge Opening');
    expect(choice?.description).not.toContain('Zombie');
    expect(choice?.description).not.toContain('Maya');
  });

  it('only offers AI prompt cards when AI units exist', () => {
    const realOnly = model([scene('a', 1, { shots: [shot('s', 'a')] })]);
    expect(availableChoices(realOnly, 'a', []).some(option => option.choice === 'prompts')).toBe(false);
    const withAi = model([
      scene('a', 1, { shots: [shot('s', 'a', { execution_method: 'ai' })] }),
    ]);
    const prompts = availableChoices(withAi, 'a', []).find(option => option.choice === 'prompts');
    expect(prompts?.description).toContain('1 AI generation unit');
  });

  it('only offers shoot cards when real coverage exists', () => {
    const aiOnly = model([
      scene('a', 1, { shots: [shot('s', 'a', { execution_method: 'ai' })] }),
    ]);
    expect(availableChoices(aiOnly, 'a', []).some(option => option.choice === 'shoot')).toBe(false);
  });

  it('omits group download when no groups are known', () => {
    const current = model([scene('a', 1), scene('b', 2)]);
    expect(availableChoices(current, 'a', []).some(option => option.choice === 'episode')).toBe(false);
    const withActs = availableChoices(current, 'a', [{ id: 'act-1', title: 'Episode 01' }]);
    expect(withActs.some(option => option.choice === 'episode')).toBe(true);
  });

  it('maps shoot cards onto the real/hybrid card ids', () => {
    const current = model([
      scene('a', 1, { shots: [shot('s1', 'a')] }),
      scene('b', 2, { shots: [shot('s2', 'b', { execution_method: 'ai' })] }),
    ]);
    const scope = buildScope(
      'shoot',
      current,
      { sceneIds: [], shotId: null, actId: null },
      { style: 'standard', include: {}, withResults: false },
    );
    expect(scope.scope_type).toBe('selected_cards');
    expect(scope.scope_refs.scene_ids).toEqual(['a']);
  });

  it('maps the prompt deck onto every AI shot id', () => {
    const current = model([
      scene('a', 1, { shots: [shot('s1', 'a', { execution_method: 'ai' }), shot('s2', 'a')] }),
    ]);
    const scope = buildScope(
      'prompts',
      current,
      { sceneIds: [], shotId: null, actId: null },
      { style: 'print', include: {}, withResults: false },
    );
    expect(scope.scope_type).toBe('shot_prompt');
    expect(scope.scope_refs.shot_ids).toEqual(['s1']);
    expect(scope.scope_refs.style).toBe('print');
  });

  it('only offers include toggles for sections the cards carry', () => {
    const current = model([scene('a', 1)]);
    const keys = availableIncludes(current, ['a']).map(option => option.key);
    expect(keys).toContain('what');
    expect(keys).toContain('next_action');
    expect(keys).not.toContain('prompts');
    expect(keys).not.toContain('result');
  });

  it('reports truthful creating states without percentages', () => {
    expect(creatingMessage('current', 'Card 03')).toContain('Preparing Card 03');
    expect(creatingMessage('full', 'Full Production')).not.toMatch(/%/);
    expect(cardRef(3)).toBe('CARD 03');
  });
});

describe('print-mode card', () => {
  it('renders the same hierarchy with no interactive chrome', () => {
    const target = scene('a', 3, {
      title: 'The Crossing',
      action_lines: ['Walk four steps, then stop.'],
      shots: [shot('s', 'a', { title: 'Master' })],
    });
    const { container } = render(<CardPrintView scene={target} style="standard" />);
    expect(screen.getByLabelText('Print preview of Card 03')).toBeTruthy();
    expect(screen.getByText('The Crossing')).toBeTruthy();
    expect(screen.getByText('Walk four steps, then stop.')).toBeTruthy();
    expect(container.querySelectorAll('button').length).toBe(0);
    expect(container.querySelectorAll('input').length).toBe(0);
  });
});
