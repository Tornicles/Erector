import { describe, expect, it } from 'vitest';
import type { StudioScene, StudioShot } from '../services/productions';
import {
  CARD_FOCUS_AREAS, FLOATING_WORD_BUDGET, cardVisualState, expandedCardSections,
  focusLabelFor, floatingCardView, summarize, timelineShares, toggleExpandedShot, words,
} from '../studio/floating';

const SUBJECT = 'Maya enters normally and walks four steps before slowing. She holds for roughly two seconds. '
  + 'Her eyes react to the metallic sound before her head turns. She does not scream and she does not run. '
  + 'Keep her phone in her right hand until the final beat of the Card.';

function shot(id: string, overrides: Partial<StudioShot> = {}): StudioShot {
  return {
    id, scene_id: 'scene-1', order: 1, sort_order: 1024, title: 'Street master', description: '',
    action: '', purpose: 'Establish the empty street', subject: '', framing: 'wide', angle: '',
    movement: '', composition: '', transition: '', story_relationship: '', story_beat: '',
    creative_notes: '', execution_method: 'real', planned_duration_ms: 7000, approval: 'draft',
    locked_at: null, revision: 1, updated_at: '2026-10-05T00:00:00Z', result_count: 0, bindings: [],
    ...overrides,
  };
}

function scene(overrides: Partial<StudioScene> = {}): StudioScene {
  return {
    id: 'scene-1', order: 3, sort_order: 3072, title: 'The Empty Street', purpose: 'Reveal the absence',
    story_beat: 'Turn', description: 'Maya steps into an empty street.', action_lines: [],
    opening_state: 'Corridor', ending_state: 'Facing the shop', visual_intent: 'Muted morning realism.',
    dialogue_notes: '', environment_asset_id: null, planned_duration_ms: 32000, duration_ms: 32000,
    timing: 'derived', approval: 'draft', locked_at: null, revision: 1,
    updated_at: '2026-10-05T00:00:00Z', character_asset_ids: [], dialogue_lines: 0, shot_count: 0,
    bindings: [], shots: [], ...overrides,
  };
}

describe('canonical Card direction', () => {
  it('summarizes without inventing: the floating value is drawn from the expanded field', () => {
    const summary = summarize(SUBJECT, 9);
    expect(words(summary)).toBeLessThanOrEqual(9);
    for (const piece of summary.replace(/…$/, '').split(/\s+/)) {
      expect(SUBJECT).toContain(piece);
    }
    expect(summarize(SUBJECT, 80)).toBe(SUBJECT);
    expect(summarize('', 9)).toBe('');
  });

  it('shows the same canonical fields floating and expanded, with different length only', () => {
    const card = scene({
      card_mode: 'hybrid', card_status: 'READY',
      card_direction: {
        title: 'The Empty Street', summary: 'Maya finds the city gone quiet.',
        what_happens: 'Exit → walk → the absence registers → stop → listen → metallic cue → turn.',
        director_direction: 'Confusion first. Fear second.', audience_feeling: 'Exposed, uneasy',
        subject_direction: SUBJECT, camera_direction: 'Phone main 1×, vertical, locked wide coverage.',
        look_direction: 'Muted early-morning realism, wet pavement, large negative space.',
        audio_direction: 'Footsteps, street tone, one clean metallic cue late in the Card.',
        location_direction: 'Long street with depth and a clear building exit behind Maya.',
        continuity: 'Jacket closed · backpack right shoulder · hair tied back.',
        resources: 'Maya · phone · backpack · jacket · clean street plate.',
        next_action: 'Open Shot 03A and shoot the street master.',
      },
      shots: [shot('shot-1'), shot('shot-2', { id: 'shot-2', execution_method: 'ai', sort_order: 2048 })],
    });

    const floating = floatingCardView(card);
    expect(floating.mode).toBe('HYBRID');
    expect(floating.status).toBe('READY');
    expect(floating.durationSeconds).toBe(32);
    expect(floating.title).toBe('The Empty Street');
    const subject = floating.areas.find(area => area.area === 'subject');
    expect(subject?.summary && SUBJECT.startsWith(subject.summary.replace(/…$/, ''))).toBe(true);
    expect(subject?.written).toBe(true);
    expect(floating.shots).toHaveLength(2);
    expect(floating.nextAction).toBe('Open Shot 03A and shoot the street master.');

    const expanded = expandedCardSections(card);
    const expandedSubject = expanded.find(item => item.key === 'subject_direction');
    expect(expandedSubject?.body).toBe(SUBJECT);
    expect(words(floating.areas.find(area => area.area === 'subject')!.summary))
      .toBeLessThan(words(expandedSubject!.body));
  });

  it('keeps the floating Card inside its visible word budget', () => {
    const card = scene({
      card_direction: {
        summary: 'Short summary of the Card.',
        what_happens: 'Exit → walk → stop → turn.',
        director_direction: 'Confusion first, fear second.',
        audience_feeling: 'Uneasy',
        subject_direction: SUBJECT,
        camera_direction: 'Phone only, locked wide, no handheld drift.',
        look_direction: 'Muted morning, wet pavement.',
        audio_direction: 'Street tone and one metallic cue.',
        location_direction: 'Long street with depth.',
        continuity: 'Backpack right shoulder.',
        resources: 'Maya · phone.',
        next_action: 'Open Shot 03A.',
      },
    });
    const floating = floatingCardView(card);
    expect(floating.visibleWords).toBeLessThanOrEqual(FLOATING_WORD_BUDGET);
    expect(floating.withinBudget).toBe(true);
  });

  it('reports an unknown status honestly and never defaults a Card to READY', () => {
    const floating = floatingCardView(scene());
    expect(floating.status).toBe('UNKNOWN');
    expect(floating.areas.every(area => area.written === false)).toBe(true);
    expect(floating.areas.every(area => area.summary === '')).toBe(true);
  });

  it('labels focus for Card, area and Shot without leaving the Card', () => {
    const card = scene();
    expect(focusLabelFor(card, 'card')).toBe('FOCUS · CARD 03');
    expect(focusLabelFor(card, 'camera')).toBe('FOCUS · CAMERA');
    expect(focusLabelFor(card, 'subject', { subjectLabel: 'Maya' })).toBe('FOCUS · SUBJECT · MAYA');
    expect(focusLabelFor(card, 'subject')).toBe('FOCUS · SUBJECT');
    expect(focusLabelFor(card, 'card', { shotDisplayId: '03B' })).toBe('FOCUS · SHOT 03B');
    expect(CARD_FOCUS_AREAS.map(item => item.area)).toEqual(['subject', 'camera', 'look', 'audio', 'location']);
  });

  it('opens at most one Shot at a time', () => {
    expect(toggleExpandedShot(null, 'shot-1')).toBe('shot-1');
    expect(toggleExpandedShot('shot-1', 'shot-2')).toBe('shot-2');
    expect(toggleExpandedShot('shot-1', 'shot-1')).toBeNull();
    expect(toggleExpandedShot('shot-1', null)).toBeNull();
  });

  it('sizes timeline cards by planned duration', () => {
    const shares = timelineShares([scene({ id: 'a', duration_ms: 20000 }), scene({ id: 'b', duration_ms: 60000 })]);
    expect(shares[0].share).toBeCloseTo(0.25, 5);
    expect(shares[1].share).toBeCloseTo(0.75, 5);
    expect(shares.map(item => item.seconds)).toEqual([20, 60]);
  });

  it('evolves the Card visual from target to latest to approved Result', () => {
    expect(cardVisualState(scene()).kind).toBe('TARGET / REFERENCE');
    expect(cardVisualState(scene({ shots: [shot('s', { result_count: 1 })] })).kind).toBe('LATEST RESULT');
    expect(cardVisualState(scene({ approval: 'approved', shots: [shot('s', { result_count: 1 })] })).kind)
      .toBe('APPROVED RESULT');
  });
});
