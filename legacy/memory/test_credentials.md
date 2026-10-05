# Erector — Test Credentials

## Mock Auth (A1 Scaffold)

Auth is fully **MOCK** — no real Supabase keys required.

### How to test the auth flow:
1. POST `/api/v1/auth/magic-link` with `{"email": "any@email.com"}`
2. Response contains `mock_token` (only in debug mode)
3. GET `/api/v1/auth/verify?token=<mock_token>` → returns `access_token` + `refresh_token`
4. Use `Authorization: Bearer <access_token>` on protected routes

### Test Email Used in CI/Tests:
- Email: `scaffold_test@erector.dev`
- Password: N/A (magic link auth, no password)

### Supabase
- **Status**: Not configured (deferred to Prompt I1)
- **mock_auth_enabled**: true (because `SUPABASE_URL` not set)
