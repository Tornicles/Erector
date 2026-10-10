import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MARKETING_ROUTES, resolveLegacyNav, type AreaKey } from './content/site';
import { mountLegacy, rewriteHandlers } from './native/legacyRuntime';
import * as area1 from './native/runners/area1';
import * as area2 from './native/runners/area2';
import * as area3 from './native/runners/area3';
import * as area4 from './native/runners/area4';

const RUNNERS: Record<AreaKey, { STATIC_HTML: string; SCRIPT: string }> = {
  area1,
  area2,
  area3,
  area4,
};

function mount(area: AreaKey, anchor: string) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const navigations: Array<{ file: string; hash: string } | { href: string }> = [];
  const notices: string[] = [];
  const handle = mountLegacy({
    root,
    staticHtml: RUNNERS[area].STATIC_HTML,
    script: RUNNERS[area].SCRIPT,
    anchor,
    fileKey: area,
    api: {
      onNavigate: (intent) => navigations.push(intent),
      onNotice: (message) => notices.push(message),
    },
  });
  return { root, navigations, notices, dispose: () => { handle.dispose(); root.remove(); } };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

describe('rewriteHandlers', () => {
  it('converts every inline handler into a dispatchable data attribute', () => {
    for (const area of Object.keys(RUNNERS) as AreaKey[]) {
      const rewritten = rewriteHandlers(RUNNERS[area].STATIC_HTML);
      expect(rewritten).not.toMatch(/\son(click|input|change|keyup|keydown|submit|focus|blur)\s*=/);
    }
  });
});

describe.each(
  MARKETING_ROUTES.filter((r) => r.kind === 'embed').map((r) => [r.path, (r as { area: AreaKey }).area, (r as { anchor: string }).anchor] as const),
)('native route %s', (path, area, anchor) => {
  it(`renders ${area}#${anchor} with content and no iframes`, async () => {
    const { root, dispose } = mount(area, anchor);
    await tick();
    const app = root.querySelector('#app');
    expect(app, `${path}: #app content root`).not.toBeNull();
    expect(app!.innerHTML.length, `${path}: rendered size`).toBeGreaterThan(1000);
    expect(root.querySelectorAll('h1,h2').length, `${path}: headings`).toBeGreaterThan(0);
    expect(root.querySelector('iframe'), `${path}: no iframes`).toBeNull();
    expect(root.innerHTML).not.toMatch(/\son(click|input|change)\s*=/);
    dispose();
  });
});

describe('sandbox document contract', () => {
  it('forwards document.title through the proxy (native setters reject proxies)', async () => {
    // Regression: the area scripts assign document.title during render.
    // Without a set-trap forwarding with the genuine document as receiver,
    // Chromium throws "Illegal invocation", the mount aborts after painting,
    // and every interaction silently stops working.
    document.title = 'probe';
    const { dispose } = mount('area1', 'home');
    await tick();
    expect(document.title).toBe('TONDE | Your AI Production Director');
    dispose();
    document.title = 'restored';
  });
});

describe('legacy navigation resolution', () => {
  it('maps area+anchor, filenames, auth and remaps to SPA paths', () => {
    expect(resolveLegacyNav('area3', { file: 'area4', hash: 'pricing' })).toBe('/pricing');
    expect(resolveLegacyNav('area3', { file: 'tonde_brand_product_area1.html', hash: 'product' })).toBe('/product');
    expect(resolveLegacyNav('area1', { file: 'area1', hash: 'login' })).toBe('/login');
    expect(resolveLegacyNav('area4', { file: 'area4', hash: 'signup' })).toBe('/signup');
    expect(resolveLegacyNav('area4', { file: 'area4', hash: 'forgot' })).toBe('/forgot-password');
    expect(resolveLegacyNav('area4', { file: 'area4', hash: '__auth__' })).toBe('/login');
    expect(resolveLegacyNav('area3', { file: 'area1', hash: 'home' })).toBe('/');
    expect(resolveLegacyNav('area3', { file: 'nope', hash: 'nope' })).toBeNull();
    expect(resolveLegacyNav('area3', { href: '/discover/' })).toBe('/explore');
    expect(resolveLegacyNav('area3', { href: '/studio/' })).toBe('/product/studio');
  });
});

describe('area interactions', () => {
  it('never shows the unfinished-area alert; routes to the real page instead', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const { root, navigations, dispose } = mount('area3', 'solutions');
    await tick();
    // The legacy area4() helper only ever showed a placeholder alert; the
    // runtime must navigate to the real route without any dialog.
    const probe = document.createElement('button');
    probe.setAttribute('data-legacy-on-click', "area4('pricing')");
    root.appendChild(probe);
    probe.click();
    expect(alert).not.toHaveBeenCalled();
    expect(navigations.length).toBeGreaterThan(0);
    const last = navigations[navigations.length - 1] as { file: string; hash: string };
    expect(resolveLegacyNav('area3', last)).toBe('/pricing');
    // A genuine in-content cross-area CTA reaches real signup, not an alert.
    const signup = [...root.querySelectorAll('button')].find(
      (b) => b.getAttribute('data-legacy-on-click') === "area4('signup')",
    );
    expect(signup, 'signup CTA exists').toBeDefined();
    signup!.click();
    expect(alert).not.toHaveBeenCalled();
    const lastSignup = navigations[navigations.length - 1] as { file: string; hash: string };
    expect(resolveLegacyNav('area3', lastSignup)).toBe('/signup');
    alert.mockRestore();
    dispose();
  });

  it('neutralises prototype auth into real authentication', async () => {
    const { root, navigations, dispose } = mount('area4', 'guides');
    await tick();
    const probe = document.createElement('button');
    probe.setAttribute('data-legacy-on-click', "submitAuth('signup')");
    root.appendChild(probe);
    probe.click();
    expect(navigations).toEqual([{ file: 'area4', hash: '__auth__' }]);
    expect(resolveLegacyNav('area4', navigations[0] as { file: string; hash: string })).toBe('/login');
    dispose();
  });

  it('runs the home Director preview from typed input and samples', async () => {
    const { root, dispose } = mount('area1', 'home');
    await tick();
    const input = root.querySelector('#directorInput') as HTMLInputElement | null;
    expect(input, 'director input exists').not.toBeNull();
    input!.value = 'Here is my song for a music video';
    const run = [...root.querySelectorAll('button')].find((b) =>
      (b.getAttribute('data-legacy-on-click') ?? '').startsWith('runDirector('),
    );
    run?.click();
    const reveal = root.querySelector('#planReveal');
    expect(reveal?.classList.contains('on')).toBe(true);
    expect(reveal?.textContent ?? '').toMatch(/Hybrid/i);
    dispose();
  });

  it('switches production-kit tabs on the real-production page', async () => {
    const { root, dispose } = mount('area2', 'real');
    await tick();
    const tabs = [...root.querySelectorAll('.kitTabs button')];
    expect(tabs.length).toBeGreaterThan(1);
    const panel = root.querySelector('#kitPanel')!;
    const before = panel.innerHTML;
    expect(before.length).toBeGreaterThan(0);
    (tabs[1] as HTMLElement).click();
    expect(panel.innerHTML).not.toBe(before);
    expect(tabs[1].classList.contains('on')).toBe(true);
    dispose();
  });

  it('selects a technique tile and lands on the technique page', async () => {
    const { root, navigations, dispose } = mount('area3', 'discover');
    await tick();
    const tech = root.querySelector('[data-legacy-on-click*="selectedTechnique"]');
    expect(tech, 'technique selector exists').not.toBeNull();
    (tech as HTMLElement).click();
    expect(navigations.length).toBeGreaterThan(0);
    expect(resolveLegacyNav('area3', navigations[navigations.length - 1] as { file: string; hash: string })).toBe(
      '/explore/techniques',
    );
    dispose();
  });

  it('searches help topics and toggles FAQs', async () => {
    const { root, dispose } = mount('area4', 'help');
    await tick();
    const search = root.querySelector('[data-legacy-on-input*="helpSearch"]') as HTMLInputElement | null;
    expect(search, 'help search exists').not.toBeNull();
    search!.value = 'interview';
    fireEvent.input(search!);
    const results = root.querySelector('#helpResults')!;
    expect(results.innerHTML.length).toBeGreaterThan(0);
    const faq = root.querySelector('[data-legacy-on-click*="toggleFaq"]');
    if (faq) {
      const id = (faq.getAttribute('data-legacy-on-click') ?? '').match(/toggleFaq\((\d+)\)/)?.[1];
      (faq as HTMLElement).click();
      expect(root.querySelector(`#faq${id}`)?.classList.contains('open')).toBe(true);
    }
    dispose();
  });

  it('steps through the case study without leaving the page', async () => {
    const { root, navigations, dispose } = mount('area4', 'case');
    await tick();
    const steps = [...root.querySelectorAll('[data-legacy-on-click*="setCaseStep"]')];
    expect(steps.length).toBeGreaterThan(1);
    (steps[1] as HTMLElement).click();
    expect(navigations).toHaveLength(0);
    // The step switch re-renders: yield for the rewrite pass, re-query, confirm.
    await tick();
    const after = [...root.querySelectorAll('[data-legacy-on-click*="setCaseStep"]')];
    expect(after[1].classList.contains('on')).toBe(true);
    dispose();
  });
});

describe('ported CSS isolation', () => {
  it('scopes every legacy-areas rule under .tmk', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'marketing', 'styles', 'legacy-areas.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    const check = (selector: string, context: string) => {
      for (const part of selector.split(',').map((s) => s.trim())) {
        if (!part || part.startsWith('@')) continue;
        if (/^(from|to|\d+%)$/.test(part)) continue;
        expect(part.startsWith('.tmk'), `${context}${part}`).toBe(true);
      }
    };
    let depth = 0;
    let selStart = 0;
    let bodyStart = -1;
    for (let k = 0; k < css.length; k++) {
      const ch = css[k];
      if (ch === '{') {
        if (depth === 0) bodyStart = k;
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0 && bodyStart !== -1) {
          const sel = css.slice(selStart, bodyStart).trim();
          if (sel.startsWith('@media')) {
            const inner = css.slice(bodyStart + 1, k);
            for (const m of inner.matchAll(/([^{}]+)\{/g)) check(m[1].trim(), '@media ');
          } else if (!sel.startsWith('@keyframes')) {
            check(sel, '');
          }
          selStart = k + 1;
          bodyStart = -1;
        }
      }
    }
  });
});
