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

## Known limitations

- Embeds render the full stacked legacy document (height clamp mirrors the
  source bridge); full native migration of the four interactive originals is
  future work — originals are preserved for it.
- `tonde.io` domain routing / SPA fallback for the production host is not
  configured in this repo (no vercel/netlify config exists); `vite preview`
  fallback verified locally, deep links need host-side fallback.
- `gh` is unauthenticated in this environment; the PR may need opening manually.
