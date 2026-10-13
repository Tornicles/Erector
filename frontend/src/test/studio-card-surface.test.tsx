import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { StudioScene, StudioShot } from '../services/productions';
import { HeroCard } from '../studio/StudioCards';
import { CardExpanded } from '../studio/CardExpanded';
import { floatingCardView } from '../studio/floating';

function shot(id: string, title: string, overrides: Partial<StudioShot> = {}): StudioShot {
  return {
    id, scene_id: 'scene-1', order: 1, sort_order: 1024, title, description: '',
    action: 'Cross the street without looking behind.', purpose: 'Build exposure',
    subject: 'Maya', framing: 'rear three-quarter', angle: 'eye level', movement: 'stable follow',
    composition: 'subject small, street deep', transition: 'cut', story_relationship: 'raises stakes',
    story_beat: 'Turn', creative_notes: 'Stay off the live traffic lane.', execution_method: 'real',
    planned_duration_ms: 9000, approval: 'draft', locked_at: null, revision: 1,
    updated_at: '2026-10-05T00:00:00Z', result_count: 0, bindings: [], ...overrides,
  };
}

function card(overrides: Partial<StudioScene> = {}): StudioScene {
  return {
    id: 'scene-1', order: 3, sort_order: 3072, title: 'The Empty Street', purpose: 'Reveal the absence',
    story_beat: 'Turn', description: 'Maya steps into an empty street.', action_lines: [],
    opening_state: 'Corridor', ending_state: 'Facing the shop', visual_intent: 'Muted morning realism.',
    dialogue_notes: '', environment_asset_id: null, planned_duration_ms: 32000, duration_ms: 32000,
    timing: 'derived', approval: 'draft', locked_at: null, revision: 1,
    updated_at: '2026-10-05T00:00:00Z', character_asset_ids: [], dialogue_lines: 0, shot_count: 0,
    bindings: [], card_mode: 'real', card_status: 'READY',
    card_direction: {
      title: 'The Empty Street',
      summary: 'Maya finds the city gone quiet.',
      what_happens: 'Exit → walk → the absence registers → stop → listen → metallic cue → turn.',
      director_direction: 'Confusion first. Fear second.',
      audience_feeling: 'Exposed, uneasy',
      subject_direction: 'Walk four normal steps. Do not scan suspiciously.',
      camera_direction: 'Phone main 1×, vertical, locked wide, Maya small in frame.',
      look_direction: 'Muted early-morning realism. Wet pavement. No stylised horror light.',
      audio_direction: 'Footsteps, street tone, one clean metallic cue late in the Card.',
      location_direction: 'Long street with depth and a clear building exit behind Maya.',
      continuity: 'Jacket closed · backpack right shoulder · hair tied back.',
      resources: 'Maya · phone · backpack · jacket · clean street plate.',
      next_action: 'Open Shot 03A and shoot the street master.',
    },
    shots: [shot('shot-1', 'Street Master'), shot('shot-2', 'Turn + Extension', {
      execution_method: 'ai', action: 'Turn camera-left while the practical plate extends.',
      purpose: 'Extend the world without changing Maya.', framing: 'preserve practical geometry',
      angle: '', movement: 'no new camera angle', subject: 'practical Maya performance only',
    })],
    ...overrides,
  };
}

describe('floating Card surface', () => {
  it('opens the same Card from the centered card and centres a neighbour instead', () => {
    const onOpenCard = vi.fn();
    const onFocus = vi.fn();
    const scene = card();
    const { rerender } = render(<HeroCard scene={scene} index={0} active selectedShotId={null}
      onFocus={onFocus} onSelectShot={vi.fn()} onPrimary={vi.fn()} menu={null}
      floating={floatingCardView(scene)} onOpenCard={onOpenCard} onFocusArea={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Card 3: The Empty Street'));
    expect(onOpenCard).toHaveBeenCalledTimes(1);
    expect(onFocus).not.toHaveBeenCalled();

    rerender(<HeroCard scene={scene} index={1} active={false} selectedShotId={null}
      onFocus={onFocus} onSelectShot={vi.fn()} onPrimary={vi.fn()} menu={null}
      floating={floatingCardView(scene)} onOpenCard={onOpenCard} onFocusArea={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Card 3: The Empty Street'));
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onOpenCard).toHaveBeenCalledTimes(1);
  });

  it('routes each area to its own focus without leaving the Card', () => {
    const onFocusArea = vi.fn();
    const scene = card();
    render(<HeroCard scene={scene} index={0} active selectedShotId={null}
      onFocus={vi.fn()} onSelectShot={vi.fn()} onPrimary={vi.fn()} menu={null}
      floating={floatingCardView(scene)} onOpenCard={vi.fn()} onFocusArea={onFocusArea} />);
    for (const label of ['subject', 'camera', 'look', 'audio', 'location']) {
      fireEvent.click(screen.getByLabelText(`Open ${label} direction`));
    }
    expect(onFocusArea.mock.calls.map(call => call[0]))
      .toEqual(['subject', 'camera', 'look', 'audio', 'location']);
  });

  it('shows summarized canonical areas and the exact next action', () => {
    const scene = card();
    render(<HeroCard scene={scene} index={0} active selectedShotId={null}
      onFocus={vi.fn()} onSelectShot={vi.fn()} onPrimary={vi.fn()} menu={null}
      floating={floatingCardView(scene)} onOpenCard={vi.fn()} onFocusArea={vi.fn()} />);
    expect(screen.getByText('Open Shot 03A and shoot the street master.')).toBeInTheDocument();
    expect(screen.getByText('Exposed, uneasy')).toBeInTheDocument();
    expect(screen.getByLabelText('Open Shot 03A Street Master')).toBeInTheDocument();
    expect(screen.getByLabelText('Open Shot 03B Turn + Extension')).toBeInTheDocument();
  });
});

describe('expanded Card surface', () => {
  it('keeps one Card and opens at most one Shot of it at a time', () => {
    const onExpandShot = vi.fn();
    const props = { scene: card(), focus: 'card' as const, onFocusChange: vi.fn(),
      onExpandShot, onOpenShot: vi.fn(), onBack: vi.fn(),
      nextAction: 'Open Shot 03A and shoot the street master.', nextActionLabel: 'START THIS CARD' };
    const { rerender } = render(<CardExpanded {...props} expandedShotId={null} />);
    expect(screen.getByRole('status')).toHaveTextContent('FOCUS · CARD 03');
    expect(screen.queryByText('ANGLE / HEIGHT')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /03A · REAL/ }));
    expect(onExpandShot).toHaveBeenCalledWith('shot-1');
    rerender(<CardExpanded {...props} expandedShotId="shot-1" />);
    expect(screen.getByText(/Cross the street without looking behind/)).toBeInTheDocument();
    expect(screen.getByText('eye level')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('FOCUS · SHOT 03A');

    // Opening the other Shot replaces the first: the Card never shows two full Shot manuals.
    rerender(<CardExpanded {...props} expandedShotId="shot-2" />);
    expect(screen.getByText(/AI GENERATION UNIT/)).toBeInTheDocument();
    expect(screen.queryByText(/Cross the street without looking behind/)).not.toBeInTheDocument();
    expect(screen.getByText(/Turn camera-left while the practical plate extends/)).toBeInTheDocument();
  });

  it('switches focus tabs inside the same Card and exposes the Director label', () => {
    const onFocusChange = vi.fn();
    render(<CardExpanded scene={card()} focus="camera" expandedShotId={null}
      onFocusChange={onFocusChange} onExpandShot={vi.fn()} onOpenShot={vi.fn()} onBack={vi.fn()}
      nextAction="Shoot the master." nextActionLabel="START THIS CARD" />);
    expect(screen.getByRole('status')).toHaveTextContent('FOCUS · CAMERA');
    expect(screen.getByText('Phone main 1×, vertical, locked wide, Maya small in frame.')).toBeInTheDocument();
    const tabs = screen.getByRole('tablist', { name: 'Card focus' });
    expect(within(tabs).getByRole('tab', { name: 'CAMERA' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(within(tabs).getByRole('tab', { name: 'AUDIO' }));
    expect(onFocusChange).toHaveBeenCalledWith('audio');
  });

  it('returns to Production without losing the Card', () => {
    const onBack = vi.fn();
    render(<CardExpanded scene={card()} focus="card" expandedShotId={null}
      onFocusChange={vi.fn()} onExpandShot={vi.fn()} onOpenShot={vi.fn()} onBack={onBack}
      nextAction="Shoot the master." nextActionLabel="START THIS CARD" />);
    fireEvent.click(screen.getByRole('button', { name: '← BACK TO PRODUCTION' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'The Empty Street' })).toBeInTheDocument();
  });
});
