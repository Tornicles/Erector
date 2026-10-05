# Prompt 3 engineering handoff — visual system

## Status

**Existing Prompt 3 visual-system work is preserved.** Its local regression is rerun during correction. The assets detail drawer focus-trap/focus-restore gap noted below was repaired with a shared focus hook; see the [correction handoff](prompt-2-correction-handoff.md). Hosted foundation gates remain BLOCKED and are independent of this interface work.

## Scope source

There is no Prompt 3 master-prompt file in the repository, so scope was derived from
the authoritative product rules and recorded here rather than invented:

- [schema-evolution.md](schema-evolution.md): *"Prompt 3: visual system; preserve
  accessibility, responsive boundaries and truthfulness."*
- [constitution.md](product/constitution.md) §12 (accessibility readiness, no vanity
  metrics) and the area responsibility matrix.
- [invariants.md](product/invariants.md): INV-15/16/17 (evidence truth), INV-28
  (partial completion stays truthful), INV-30 (no fake readiness percentage), INV-24
  (canonical information lives once).

## What changed

### One semantic token source

`frontend/src/index.css` now has a grouped token layer — colour roles, a 4px spacing
scale, radius scale, type scale, elevation, motion and stacking order — and existing
component rules consume it instead of duplicated literals (`--sidebar`, `--scrim`,
`--shadow-dialog`, `--shadow-drawer`, focus tokens). `frontend/tailwind.config.js`
exposes the same names. Tailwind utility classes are not used anywhere in the app, so
these mappings are inert metadata for future use.

### Accessibility

- **Control-boundary contrast fixed.** Interactive controls previously used
  `--border` (1.46:1 against the surfaces — below the 3:1 WCAG 1.4.11 requirement).
  They now use `--border-strong` `#6b6d78` = **3.67:1** on `--background`, **3.45:1**
  on `--surface`, **3.12:1** on `--elevated`. Body text tokens measure 7.77–16.41:1.
- `@media(prefers-contrast:more)` strengthens borders and muted text;
  `@media(forced-colors:active)` maps controls/outline to system colours.
  `prefers-reduced-motion` was already global and is preserved.
- Command, notification, production archive, asset detail and asset archive dialogs now share a reusable focus trap/focus restore hook. The assets detail drawer gap identified in the original handoff was closed during Prompt 2/3 reconciliation.

### Truthfulness

- Added `PartialState` to `StateComponents` — a first-class partial-success primitive
  that never presents incomplete work as complete (INV-16, INV-28). `ErrorState` now
  accepts an optional `cause` so failures expose an understandable reason.
- Studio's Director panel uses `PartialState` ("foundation ready, reasoning not
  enabled, no direction generated") instead of an empty state that implied otherwise.

## Historical Prompt 3 verification snapshot

The counts below describe the original Prompt 3 delivery and are not current certification. The final reconciliation reran frontend `npm run typecheck`, Vitest 47/47, production build, and Playwright 7/7; see the [correction handoff](prompt-2-correction-handoff.md). The final run covers drawer/nested-dialog focus behavior and visual-system tests. The current bundle warning is 554.66 kB before gzip. Hosted foundation gates remain BLOCKED independently of these local checks.

## Known gaps (not claimed complete)

- Accessibility completeness is a continued review criterion, not a one-time pass. Contrast checks cover defined tokens/surfaces, not every composed element or icon. Keep retesting composed dialogs and assistive-technology behavior as screens evolve.
- Contrast is verified for the defined tokens and their surface pairings, not for
  every composed element or third-party icon colour.
- The product is dark-first; no light theme was added (none is specified).
- Tailwind's `max-*`/`min-*` breakpoints still live as raw media queries; a named
  breakpoint abstraction is deferred until utilities are actually consumed.
