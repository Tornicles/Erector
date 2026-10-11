import { describe, expect, it } from 'vitest';
import {
  cardExecution,
  cardReadiness,
  drawerSectionForTool,
  focusLabel,
  nextActionForScene,
  orderedCards,
  orderedShots,
  resolveFocus,
  scopeText,
  shotDisplayId,
} from '../studio/cards';
import type { StudioReadModel, StudioScene } from '../services/productions';

const shot = (id: string, sceneId: string, overrides = {}) => ({
  id, scene_id: sceneId, order: 1, sort_order: 1024, title: `Shot ${id}`, description: '',
  action: '', purpose: 'establish', subject: '', framing: 'wide', angle: '', movement: '',
  composition: '', transition: '', story_relationship: '', story_beat: '', creative_notes: '',
  execution_method: 'real' as const, planned_duration_ms: 4000, approval: 'draft' as const,
  locked_at: null, revision: 1, updated_at: '2026-10-05T00:00:00Z', result_count: 0, bindings: [], ...overrides,
});

const scene = (id: string, order: number, overrides: Partial<StudioScene> = {}): StudioScene => ({
  id, order, sort_order: order * 1024, title: `Card ${order}`, purpose: 'Earn attention',
  story_beat: 'Hook', description: '', action_lines: [], opening_state: '', ending_state: '',
  visual_intent: '', dialogue_notes: '', environment_asset_id: null, planned_duration_ms: 8000,
  duration_ms: 8000, timing: 'derived', approval: 'draft', locked_at: null, revision: 1,
  updated_at: '2026-10-05T00:00:00Z', character_asset_ids: [], dialogue_lines: 0,
  shot_count: 0, bindings: [], shots: [], ...overrides,
});

const model = (scenes: StudioScene[] = []): StudioReadModel => ({
  production: {
    id: 'prod-1', workspace_id: 'ws-1', title: 'Ridgeway coffee', production_type: 'commercial',
    custom_type: null, execution_method: 'real', planned_duration_ms: 30000, calculated_duration_ms: 30000,
    approval: 'draft', locked_at: null, revision: 7, lifecycle: 'active', updated_at: '2026-10-05T00:00:00Z',
  },
  scenes, orphan_shots: [], assets: [], documents: {},
  timing: { total_ms: 0, target_ms: null, delta_ms: null, status: 'unresolved', scene_states: [] },
  runtime_conflict: false, timeline: [],
  status_summary: { production_approval: 'draft', production_locked: false, scenes: scenes.length, shots: 0, scenes_locked: 0, shots_locked: 0, approval_counts: {}, needs_attention: 0 },
  truncated: false,
  provider: { provider: 'openai_compatible', configured: false, model_profile: 'default', capabilities: [], notes: [], ffmpeg_available: false, ffmpeg_note: '' },
  capabilities: { frame_extraction: false, frame_extraction_note: '', timeline_editing: true, shot_execution: false, ai_prompt_compilation: false, note: '' },
});

describe('card derivation', () => {
  it('numbers Shots like 03B from the Card order and Shot index', () => {
    expect(shotDisplayId(3, 1)).toBe('03B');
    expect(shotDisplayId(1, 0)).toBe('01A');
  });

  it('derives readiness from approval, Results and coverage', () => {
    expect(cardReadiness(scene('a', 1))).toBe('DRAFT');
    expect(cardReadiness(scene('a', 1, { shots: [shot('s', 'a')] }))).toBe('READY');
    expect(cardReadiness(scene('a', 1, { shots: [shot('s', 'a', { result_count: 2 })] }))).toBe('RESULT READY');
    expect(cardReadiness(scene('a', 1, { approval: 'needs_review' }))).toBe('NEEDS YOU');
    expect(cardReadiness(scene('a', 1, { approval: 'approved' }))).toBe('COMPLETE');
  });

  it('reports PLANNING execution before anything is planned and the dominant method after', () => {
    expect(cardExecution(scene('a', 1))).toBe('PLANNING');
    expect(cardExecution(scene('a', 1, { shots: [shot('s', 'a')] }))).toBe('REAL');
    expect(cardExecution(scene('a', 1, {
      shots: [shot('s1', 'a', { execution_method: 'ai' }), shot('s2', 'a', { execution_method: 'ai' }), shot('s3', 'a')],
    }))).toBe('AI');
  });

  it('ranks the next action lock first, then decision, coverage, Result and execution', () => {
    expect(nextActionForScene(scene('a', 1, { locked_at: '2026-10-05T00:00:00Z' })).kind).toBe('locked');
    expect(nextActionForScene(scene('a', 1, { approval: 'needs_review' })).kind).toBe('review_decision');
    expect(nextActionForScene(scene('a', 1)).kind).toBe('plan_coverage');
    expect(nextActionForScene(scene('a', 1, { shots: [shot('s', 'a', { result_count: 1 })] })).kind).toBe('review_result');
    expect(nextActionForScene(scene('a', 1, { shots: [shot('s', 'a')] })).kind).toBe('start_execution');
    expect(nextActionForScene(scene('a', 1, {
      shots: [shot('s', 'a', { execution_method: 'ai' })],
    })).kind).toBe('run_playbook');
  });

  it('orders cards and Shots canonically', () => {
    const first = scene('a', 2);
    const second = scene('b', 1);
    expect(orderedCards(model([first, second])).map(item => item.id)).toEqual(['b', 'a']);
    const withShots = scene('c', 3, {
      shots: [shot('s2', 'c', { sort_order: 2048 }), shot('s1', 'c', { sort_order: 1024 })],
    });
    expect(orderedShots(withShots).map(item => item.shot.id)).toEqual(['s1', 's2']);
    expect(orderedShots(withShots)[1].displayId).toBe('03B');
  });

  it('resolves Shot focus over Card focus over Production focus', () => {
    const withShots = scene('a', 1, { shots: [shot('s', 'a')] });
    const withOther = scene('b', 2);
    const current = model([withShots, withOther]);
    expect(resolveFocus(current, null, 's')).toMatchObject({ kind: 'shot' });
    expect(resolveFocus(current, 'b', 's')).toMatchObject({ kind: 'shot', scene: withShots });
    expect(resolveFocus(current, 'b', null)).toMatchObject({ kind: 'card', scene: withOther });
    expect(resolveFocus(current, 'missing', null)).toMatchObject({ kind: 'card', scene: withShots });
    expect(resolveFocus(model([]), null, null)).toMatchObject({ kind: 'production' });
  });

  it('labels focus and scope explicitly for the Director', () => {
    const withShots = scene('a', 3, { shots: [shot('s', 'a'), shot('s2', 'a')] });
    const current = model([withShots]);
    const shotFocus = resolveFocus(current, 'a', 's2');
    expect(focusLabel(shotFocus, current)).toBe('FOCUS · SHOT 03B');
    expect(scopeText(shotFocus)).toContain('Shot 03B');
    const cardFocus = resolveFocus(current, 'a', null);
    expect(focusLabel(cardFocus, current)).toBe('FOCUS · CARD 03');
    expect(scopeText(cardFocus)).toContain('Card 03');
  });

  it('maps legacy tool links into drawer sections instead of blank canvases', () => {
    expect(drawerSectionForTool('Results')).toBe('results');
    expect(drawerSectionForTool('Exports')).toBe('exports');
    expect(drawerSectionForTool('Story')).toBe('story');
    expect(drawerSectionForTool('Movie Mode')).toBe('preview');
    expect(drawerSectionForTool('Continuity')).toBe('continuity');
    expect(drawerSectionForTool('Memory')).toBe('memory');
    expect(drawerSectionForTool('Series')).toBe('series');
    expect(drawerSectionForTool('Scenes')).toBeNull();
    expect(drawerSectionForTool('Nope')).toBeNull();
  });
});
