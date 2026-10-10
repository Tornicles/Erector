import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { appRoutes } from '../App';
import { AuthContext } from '../contexts/AuthContext';
import { MarketingLayout } from './components/MarketingLayout';
import { NativePage } from './components/NativePage';
import {
  MARKETING_ROUTES,
  legacyPathToSpa,
  type NativeSpec,
} from './content/site';

/** Application routes that marketing must never shadow (see App.tsx). */
const APP_PATHS = new Set([
  '/home',
  '/studio',
  '/projects',
  '/discover',
  '/jobs',
  '/knowledge',
  '/devices-scenes',
  '/assets',
  '/setup',
  '/settings',
  '/account',
  '/help',
  '/login',
  '/auth/callback',
  '/auth/reset',
]);

describe('marketing route table', () => {
  it('covers the source archive: 31 embeds + 11 natives, with auth on the real AuthPage', () => {
    // 45 source URLs = 42 marketing specs + /login, /signup, /forgot-password,
    // which reuse the real AuthPage instead of the prototype auth embeds.
    const embeds = MARKETING_ROUTES.filter((r) => r.kind === 'embed');
    const natives = MARKETING_ROUTES.filter((r) => r.kind === 'native');
    expect(MARKETING_ROUTES).toHaveLength(42);
    expect(embeds).toHaveLength(31);
    expect(natives).toHaveLength(11);
    const authPaths = appRoutes
      .filter((r) => typeof r.path === 'string')
      .map((r) => r.path as string);
    for (const path of ['/login', '/signup', '/forgot-password']) {
      expect(authPaths).toContain(path);
    }
  });

  it('has unique paths with titles and descriptions', () => {
    const paths = MARKETING_ROUTES.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const route of MARKETING_ROUTES) {
      expect(route.title.startsWith('TONDE | ')).toBe(true);
      expect(route.description.length).toBeGreaterThan(0);
    }
  });

  it('does not shadow authenticated app routes', () => {
    for (const route of MARKETING_ROUTES) {
      expect(APP_PATHS.has(route.path)).toBe(false);
    }
  });

  it('renders natively from the four ported areas; originals preserved, iframes gone', () => {
    const knownAreas = new Set(['area1', 'area2', 'area3', 'area4']);
    const knownFiles = new Set([
      'tonde_brand_product_area1.html',
      'tonde_creation_modes_area2.html',
      'tonde_solutions_discover_area3.html',
      'tonde_resources_company_area4.html',
    ]);
    for (const route of MARKETING_ROUTES) {
      if (route.kind === 'embed') expect(knownAreas.has(route.area)).toBe(true);
    }
    // No iframe payload remains in the served site.
    expect(existsSync(join(process.cwd(), 'public', 'marketing', 'legacy'))).toBe(false);
    // The four original designs stay preserved as immutable reference.
    const originalsDir = join(process.cwd(), 'public', 'marketing', 'originals');
    for (const file of knownFiles) {
      expect(existsSync(join(originalsDir, file))).toBe(true);
    }
  });
});

describe('legacyPathToSpa', () => {
  it('remaps paths that collide with app routes', () => {
    expect(legacyPathToSpa('/discover/')).toBe('/explore');
    expect(legacyPathToSpa('/discover/techniques/')).toBe('/explore/techniques');
    expect(legacyPathToSpa('/studio/')).toBe('/product/studio');
  });

  it('passes site paths through and keeps auth on real AuthPage routes', () => {
    expect(legacyPathToSpa('/product/')).toBe('/product');
    expect(legacyPathToSpa('/login/')).toBe('/login');
    expect(legacyPathToSpa('/')).toBe('/');
  });
});

const signedOutAuth = {
  session: null,
  workspaceId: null,
  loading: false,
  error: null,
  configured: true,
  localPreview: false,
  retry: () => {},
};

describe('MarketingLayout', () => {
  it('renders one nav, real auth CTAs, and a working mobile menu', () => {
    render(
      <AuthContext.Provider value={signedOutAuth}>
        <MemoryRouter>
          <MarketingLayout>
            <p>child</p>
          </MarketingLayout>
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    expect(screen.getByLabelText('Primary')).toBeInTheDocument();
    // Desktop + mobile navs render the same actions; all copies must be real.
    for (const link of screen.getAllByRole('link', { name: 'Sign in' })) {
      expect(link).toHaveAttribute('href', '/login');
    }
    for (const link of screen.getAllByRole('link', { name: 'Start creating' })) {
      expect(link).toHaveAttribute('href', '/signup');
    }
    const menu = screen.getByRole('button', { name: 'Menu' });
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Mobile')).toHaveClass('open');
  });

  it('routes Start creating to the workspace when authenticated', () => {
    render(
      <AuthContext.Provider value={{ ...signedOutAuth, session: { user: { id: 'u' } } as never }}>
        <MemoryRouter>
          <MarketingLayout>
            <p>child</p>
          </MarketingLayout>
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    for (const link of screen.getAllByRole('link', { name: 'Start creating' })) {
      expect(link).toHaveAttribute('href', '/home');
    }
  });
});

describe('NativePage', () => {
  it('renders honest copy without fabricated capabilities', () => {
    const spec = MARKETING_ROUTES.find(
      (r) => r.path === '/product/moment-intelligence',
    ) as NativeSpec;
    render(
      <MemoryRouter>
        <div className="tmk">
          <NativePage spec={spec} />
        </div>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Find the moments that matter.',
    );
    expect(screen.getByText(/must be verified in the deployed application/)).toBeInTheDocument();
    expect(document.title).toBe('TONDE | Moment Intelligence');
  });
});

describe('marketing CSS isolation', () => {
  it('scopes every rule under .tmk', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'marketing', 'styles', 'marketing.css'), 'utf8');
    const selectors = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('}')
      .map((block) => block.split('{')[0]?.trim() ?? '')
      .filter((selector) => selector.length > 0 && !selector.startsWith('@media'));
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      for (const part of selector.split(',').map((s) => s.trim())) {
        expect(part.startsWith('.tmk')).toBe(true);
      }
    }
  });
});
