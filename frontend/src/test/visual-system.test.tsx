import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ErrorState, PartialState } from '../components/StateComponents';

// vitest runs with the frontend package as the working directory.
const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

// WCAG relative luminance / contrast ratio.
const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string) => {
  const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.replace('#', '').slice(i, i + 2), 16) / 255).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const token = (name: string) => {
  const match = css.match(new RegExp(`--${name}:(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`token --${name} not defined`);
  return match[1];
};

describe('TONDE visual system tokens', () => {
  it('defines one semantic token layer for colour, space, type, radius, motion and elevation', () => {
    for (const name of ['background', 'surface', 'elevated', 'sidebar', 'border', 'border-strong', 'text', 'muted', 'accent', 'danger', 'success', 'warning', 'information', 'approval', 'draft', 'review', 'changed-after-approval', 'focus', 'radius', 'radius-md', 'space', 'space-6', 'text-base', 'leading-body', 'duration-base', 'ease-standard', 'shadow-dialog', 'shadow-drawer', 'z-nav', 'z-dialog', 'scrim']) {
      expect(css, `missing --${name}`).toContain(`--${name}:`);
    }
  });

  it('keeps interactive control boundaries perceivable (WCAG 1.4.11 non-text contrast)', () => {
    const strong = token('border-strong');
    for (const surface of ['background', 'surface', 'elevated']) {
      expect(contrast(strong, token(surface)), `${strong} on --${surface}`).toBeGreaterThanOrEqual(3);
    }
    // Text tokens clear the 4.5:1 body-text threshold on every surface.
    for (const surface of ['background', 'surface', 'elevated']) {
      expect(contrast(token('text'), token(surface))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token('muted'), token(surface))).toBeGreaterThanOrEqual(4.5);
    }
    expect(css).toMatch(/button,\.button\{[^}]*border:1px solid var\(--border-strong\)/);
    expect(css).toMatch(/input,textarea\{[^}]*border:1px solid var\(--border-strong\)/);
  });

  it('routes control affordances through tokens rather than duplicated literals', () => {
    expect(css).toContain('background:var(--sidebar)');
    expect(css).toContain('outline:var(--focus-ring-width) solid var(--focus)');
    expect(css).toContain('data-appearance=light');
    expect(css).toContain('data-appearance=system');
    expect(css).toContain('@media(prefers-color-scheme:light)');
  });

  it('honours motion, contrast and forced-colour user preferences', () => {
    expect(css).toContain('@media(prefers-reduced-motion:reduce)');
    expect(css).toContain('@media(prefers-contrast:more)');
    expect(css).toContain('@media(forced-colors:active)');
    expect(css).toContain('--muted-strong:');
  });

  it('declares the responsive boundaries the shell relies on', () => {
    expect(css).toContain('@media(min-width:1500px)');
    expect(css).toContain('@media(max-width:1150px)');
    expect(css).toContain('@media(max-width:760px)');
  });
});

describe('truthful UI states', () => {
  it('announces partial success without presenting it as complete', () => {
    render(<PartialState>The reference loaded; audio is inaccessible.</PartialState>);
    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('Partially available');
    expect(region).toHaveTextContent('audio is inaccessible');
  });

  it('exposes an understandable failure cause to assistive technology', () => {
    render(<ErrorState message="The upload failed." cause="Storage rejected the file type." />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Storage rejected the file type.');
  });
});
