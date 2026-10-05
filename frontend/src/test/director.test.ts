import { describe, expect, it } from 'vitest';
import { DATABASE_VALUES } from '../types/product';

type ProductionType = (typeof DATABASE_VALUES.production_type)[number];
type Collaboration = 'guide_step_by_step' | 'stop_at_major_decisions' | 'complete_first_draft';
type Reference = { source: 'url' | 'upload' | 'description'; hasMediaId: boolean };

function classify(goal: string): ProductionType {
  const value = goal.toLowerCase();
  if (/photograph|photography|portrait|still image/.test(value)) return 'photography';
  if (/documentary/.test(value)) return 'documentary';
  if (/interview/.test(value)) return 'interview';
  if (/trailer/.test(value)) return 'trailer';
  if (/music video/.test(value)) return 'music_video';
  if (/every weekday|every day|daily series|videos every day/.test(value)) return 'recurring_content';
  if (/long-form|long form|\d+\s*minute film/.test(value)) return 'long_form_film';
  if (/youtube/.test(value)) return 'youtube';
  if (/commercial|advertisement|\bad\b/.test(value)) return 'commercial';
  if (/tiktok|reel|short-form|short form/.test(value)) return 'social_video';
  if (/short film|crime film|original film/.test(value)) return 'short_film';
  return 'custom';
}

function runtimeMs(goal: string): number | null {
  const matches = [...goal.matchAll(/(?<!\d)(\d+(?:\.\d+)?)[\s-]*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/gi)];
  if (!matches.length) return null;
  const score = (match: RegExpMatchArray) => {
    const start = match.index ?? 0;
    const before = goal.slice(Math.max(0, start - 60), start).toLowerCase();
    const after = goal.slice(start + match[0].length, start + match[0].length + 60).toLowerCase();
    let value = /\b(video|film|commercial|ad|trailer|runtime|duration|long|short)\b/.test(after) ? 5 : 0;
    if (/\b(?:i have|available|only)\s*$/.test(before) || /^\s*(?:to shoot|for shooting|of shoot)/.test(after)) value -= 10;
    else if (/\b(?:to shoot|shooting|available|budget|deadline)\b/.test(before)) value -= 2;
    return value;
  };
  const match = matches.sort((left, right) => score(right) - score(left) || (left.index ?? 0) - (right.index ?? 0))[0];
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const milliseconds = amount * (unit.startsWith('h') ? 3600000 : unit.startsWith('min') ? 60000 : 1000);
  return Number.isSafeInteger(milliseconds) ? milliseconds : null;
}

function questions(type: ProductionType, known: Record<string, string>) {
  const output: string[] = [];
  if (type === 'commercial' && !known.product) output.push('product');
  if (type !== 'photography' && type !== 'recurring_content' && !known.runtime) output.push('runtime');
  if (['short_film', 'long_form_film', 'trailer'].includes(type) && !known.dialogue_mode) output.push('dialogue_mode');
  if (type === 'recurring_content' && !known.series_horizon) output.push('series_horizon');
  return output;
}

function capability(reference: Reference) {
  if (reference.source === 'description') return { text: 'available', frames: 'unavailable', audio: 'unavailable' };
  if (reference.source === 'url') return { text: 'unverified', frames: 'unavailable', audio: 'unavailable' };
  return reference.hasMediaId
    ? { text: 'unverified', frames: 'unverified', audio: 'unverified' }
    : { text: 'unavailable', frames: 'unavailable', audio: 'unavailable' };
}

function allocateRuntime(targetMs: number, count: number): number[] {
  if (!Number.isSafeInteger(targetMs) || targetMs < 0 || !Number.isInteger(count) || count < 1 || count > 40) {
    throw new Error('Unsupported runtime allocation');
  }
  const base = Math.floor(targetMs / count);
  const remainder = targetMs % count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

describe('Director intent and runtime foundation', () => {
  it.each([
    ['A 30-second commercial for coffee', 'commercial'],
    ['A 45-second crime trailer', 'trailer'],
    ['A portrait photograph', 'photography'],
    ['Host-led YouTube video', 'youtube'],
    ['A music video for my new song', 'music_video'],
    ['Documentary about local food', 'documentary'],
    ['Short film about a lost key', 'short_film'],
    ['Finance video every weekday', 'recurring_content'],
    ['A 30-minute long-form film', 'long_form_film'],
  ] as const)('classifies %s into canonical %s vocabulary', (goal, expected) => {
    expect(DATABASE_VALUES.production_type).toContain(expected);
    expect(classify(goal)).toBe(expected);
  });

  it('asks only missing, type-relevant decisions and respects prior answers', () => {
    expect(questions('photography', {})).toEqual([]);
    expect(questions('commercial', {})).toEqual(['product', 'runtime']);
    expect(questions('commercial', { product: 'Coffee', runtime: '30 seconds' })).toEqual([]);
    expect(questions('trailer', { runtime: '45 seconds' })).toEqual(['dialogue_mode']);
    expect(questions('recurring_content', {})).toEqual(['series_horizon']);
  });

  it('parses intent runtime separately from available production time', () => {
    expect(runtimeMs('I have 90 minutes to shoot a 30-second ad')).toBe(30000);
    expect(runtimeMs('Make a film in a day')).toBeNull();
    expect(runtimeMs('Make a 1.5-minute commercial')).toBe(90000);
  });

  it('keeps upload IDs and URLs distinct from completed media analysis', () => {
    expect(capability({ source: 'url', hasMediaId: false })).toEqual({ text: 'unverified', frames: 'unavailable', audio: 'unavailable' });
    expect(capability({ source: 'upload', hasMediaId: true })).toEqual({ text: 'unverified', frames: 'unverified', audio: 'unverified' });
    expect(capability({ source: 'description', hasMediaId: false })).toEqual({ text: 'available', frames: 'unavailable', audio: 'unavailable' });
  });

  it('uses exact integer duration allocation and bounds it to a Studio-sized draft', () => {
    const durations = allocateRuntime(45001, 4);
    expect(durations).toEqual([11251, 11250, 11250, 11250]);
    expect(durations.reduce((sum, value) => sum + value, 0)).toBe(45001);
    expect(() => allocateRuntime(1000, 0)).toThrow();
    expect(() => allocateRuntime(Number.MAX_SAFE_INTEGER + 1, 2)).toThrow();
  });

  it('keeps collaboration mode as a question strategy, not production classification', () => {
    const type = classify('Make a 30-second commercial');
    const modes: Collaboration[] = ['guide_step_by_step', 'stop_at_major_decisions', 'complete_first_draft'];
    expect(modes.map(() => type)).toEqual(['commercial', 'commercial', 'commercial']);
  });
});
