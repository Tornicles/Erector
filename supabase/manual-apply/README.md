# Manual hosted migrations 011 to 014 (Prompt 4 Director Intelligence)

Migrations 001 to 010 are already applied to the hosted project. These four are still
local only. Apply them **in this order, once**:

1. `01_202610050011_director_intake.sql`
2. `02_202610050012_director_intelligence.sql`
3. `03_202610050013_director_reference_and_apply.sql`
4. `04_202610050014_director_apply_operation.sql`
5. `05_verify.sql` - every row must read `OK`

`202610050011_to_014_director_intelligence.sql` is the same SQL as 1-4 concatenated,
concatenation-verified byte for byte, for a single paste or a single `psql -f`.

## Never

* Never re-run `202610050009_revoke_public_rls_admin.sql` or
  `202610050010_hide_policy_helpers.sql`. Both were applied by hand already.
* Never run these twice. They are not idempotent: a second run fails with
  `already exists`, which means it was already applied.

## Why every file starts with \`begin;\` and contains only ASCII

A clipboard or editor path can drop the first character on paste. When a file started
with a `--` comment, that produced `- ...` and failed with
`syntax error at or near "-"`. Starting with executable SQL removes that failure mode,
and pure ASCII removes any encoding risk.

## Recording history

The CLI records what it applies. The Dashboard SQL Editor does not: if you paste via the
editor and later use the CLI, uncomment the `insert into
supabase_migrations.schema_migrations ...` block at the bottom of the combined file first.

## Copying safely (PowerShell / cmd)

Selecting text in a viewer can drop the first character of line 1. Read the file into the
clipboard instead of selecting it by hand:

```powershell
# PowerShell
Get-Content -Raw supabase/manual-apply/202610050011_to_014_director_intelligence.sql | Set-Clipboard
```

```bat
:: cmd.exe
clip < supabase\manual-apply\202610050011_to_014_director_intelligence.sql
```

Every file already starts with `begin;`/`select`, so a dropped first character now shows up
as `syntax error at or near "egin"` at line 1 - an obvious truncation. If you see that,
re-copy with one of the commands above, or use `supabase db push` / `psql -f`, which never
touch the clipboard.
