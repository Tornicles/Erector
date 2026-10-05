# Historical donor quarantine — NOT an application

This directory preserves the tracked donor code from commit `26db26c` until hosted data retention and the new Supabase rollout have been verified. It is excluded from application imports, active dependency installation, tests, container builds and deployments.

Do not run these services, restore their auth, copy their secrets, or treat the old PRD/test reports as TONDE requirements. They are not a supported fallback. The active application is the repository's frontend, backend and Supabase migrations.

Legacy business data is not imported into TONDE. No existing external database was read, dropped, exported or migrated. If real old data must be retained, first arrange a separate authorized backup/export and review an explicit identity mapping.

Remove this quarantine after hosted Auth/database/Storage checks and the retention decision. Git already retains the original history. Portable React/Tailwind, request IDs, security utility, typed API-envelope and logging patterns were adapted into TONDE rather than running this legacy implementation.
