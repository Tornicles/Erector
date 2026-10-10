# TONDE.IO marketing integration

Source: `tonde_unified_site.zip` from branch `Tornicles-patch-1` (commit `949d9cb`).
Working branch: `feat/tonde-marketing-integration` (from `main` at `c1f2df8`).
Implementation: `frontend/src/marketing/` (see `content/site.ts` for the full route table).

## Preserved references (immutable, byte-verified with `cmp`)

| Archive path | Repo path |
|---|---|
| `originals/*.html` (4 designs) | `frontend/public/marketing/originals/` |
| `legacy/*.html` (working copies) | `frontend/public/marketing/legacy/` |
| `assets/favicon.svg` | `frontend/public/marketing/favicon.svg` |

## Original section → React route mapping

Area 1 (`tonde_brand_product_area1.html`, embed): `/` (#home), `/product`,
`/how-it-works`, `/product/studio` (#studio), `/production-memory`,
`/about`.
Area 2 (`tonde_creation_modes_area2.html`, embed): `/create/real-production`,
`/create/ai-creation`, `/create/hybrid-production`, `/shot-match`.
Area 3 (`tonde_solutions_discover_area3.html`, embed): `/solutions`,
`/solutions/film-video|photography|commercial-product|music-video|documentary-interviews|youtube-social|series-recurring|weddings`,
`/explore` (#discover), `/explore/techniques` (#technique).
Area 4 (`tonde_resources_company_area4.html`, embed): `/resources/guides|examples|case-study|help|updates`,
`/pricing`, `/security`, `/privacy`, `/terms`, `/content-rights`.
Native pages (no iframe): `/contact`, `/for/creators|production-teams|brands-agencies|event-creators`,
`/product/moment-intelligence`,
`/solutions/live-events|conferences|sports-live-action|parties-celebrations|concerts-performances`.
Auth (real `AuthPage`, never the prototype embeds): `/login`, `/signup`,
`/forgot-password`, `/auth/callback`, `/auth/reset`.

## Deliberate route remaps (app routes always win)

- `/studio` stays the authenticated app; marketing Studio intro → `/product/studio`.
- `/discover*` stays the app; marketing discovery → `/explore*`.
- `/help` stays the app; marketing help → `/resources/help`.
- Legacy-embed `navigate` events pass through `legacyPathToSpa()` so in-embed
  links land on the remapped SPA routes.

## Boundaries kept

- No migration, RLS, or Supabase changes; `scripts/verify-boundaries.mjs` passes.
- No fabricated pricing, testimonials, certifications, media analysis, or
  approvals. Embed height/notice bridge mirrors the archive's `site.js`.
- Marketing CSS is namespaced under `.tmk` (test asserts every selector).
- `frontend/public/sitemap.xml` + `robots.txt` (app routes disallowed).

## Prompt 2 — native completion

All 31 embed routes now render natively (no iframes). Each area script runs
inside the scoped runtime (`src/marketing/native/legacyRuntime.ts`) with
styles ported to `styles/legacy-areas.css` (`.tmk`-scoped, keyframes prefixed).
Navigation, toasts, modals, tabs, search, kit/face/studio selectors, case steps
and the Director preview run from the original logic; cross-area links,
prototype-auth calls and "Area N will be built next" placeholder alerts are
bridged to real SPA routes/auth. Entrance animations restored (the embed
`animation:none` override is gone). `public/marketing/legacy/` deleted (~770KB
payload removed); `EmbedPage` and the height-clamp bridge deleted with it.

## Vercel readiness

- Root `vercel.json` (deployment track) owns routing: frontend service
  (`frontend/`, Vite preset with SPA fallback) serves all public and
  authenticated routes — refresh and deep links work; `/api/*` routes to the
  backend service. No nested frontend config is added, to avoid conflicts.
  Static files (sitemap, robots, originals) keep filesystem precedence.
- Client env is publishable-only (`VITE_SUPABASE_URL`,
  `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_URL`, preview flag);
  `verify-boundaries.mjs` rejects service-role/secret browser vars.
- Set `VITE_API_URL` per Vercel environment (preview vs production backend);
  preview/production separation itself is Vercel project configuration.

## Known limitations

- `gh` is unauthenticated in this environment; the PR may need opening manually.
- Provider-backed AI/media generation remains unconfigured and unclaimed;
  the Director preview sketches plan shapes from keywords and never claims
  submission, real-media analysis, or generation (legacy copy already carries
  the no-manufactured-approval language).
