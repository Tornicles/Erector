import { expect, test, type Page, type Route } from '@playwright/test';

// Prompt 10 through the real browser surfaces, with the privileged API stubbed at the network boundary.
// Every fact a surface shows must come from a response; nothing here is decided in the browser:
//
//  § integrations  a provider is connected only because the provider confirmed the account, a failing
//                  connection is described as failing, an unconfigured deployment says which dependency
//                  it is missing instead of looking available, and no credential is ever typed in;
//  § publishing    the publication pins exact revisions and a media checksum, authorization is the
//                  creator's own recorded act (never the Result's creative approval), and a destination
//                  answer that is ambiguous becomes destination state unknown — never "published";
//  § exports       two named products, the exact requested format and package type, and never a
//                  download link the browser did not receive;
//  § billing       server-authoritative subscription facts, four separate cost kinds, and a checkout
//                  that says no provider session was created instead of inventing a URL.
const uid = '00000000-0000-4000-8000-000000000001';
const workspace = '00000000-0000-4000-8000-000000000002';
const projectId = '00000000-0000-4000-8000-000000000011';
const productionId = '00000000-0000-4000-8000-000000000003';
const publicationId = '00000000-0000-4000-8000-000000000050';
const connectionOne = '00000000-0000-4000-8000-000000000070';
const connectionTwo = '00000000-0000-4000-8000-000000000071';
const exportReady = '00000000-0000-4000-8000-0000000000e1';
const exportExpired = '00000000-0000-4000-8000-0000000000e2';

const envelope = (data: unknown) => ({ success: true, data, errors: null, metadata: { request_id: 'e2e-10', timestamp: '2026-10-08T00:00:00Z', version: '1' } });

const production = {
  id: productionId, workspace_id: workspace, project_id: projectId, title: 'Marquee film',
  production_type: 'short_film', custom_type: null, execution_method: 'real', lifecycle: 'active',
  approval: 'draft', locked_at: null, planned_duration_ms: 600000, calculated_duration_ms: 600000,
  start_ms: 0, end_ms: null, created_by: uid, revision: 3,
  created_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:00:00Z',
};

const providerStatus = {
  provider: 'openai_compatible', configured: false, model_profile: 'default', capabilities: [], notes: [],
  ffmpeg_available: false, ffmpeg_note: 'ffmpeg is not installed.',
};

const studioModel = {
  production: {
    id: productionId, workspace_id: workspace, title: production.title, production_type: 'short_film',
    custom_type: null, execution_method: 'real', planned_duration_ms: 600000, calculated_duration_ms: 600000,
    approval: 'draft', locked_at: null, revision: 3, lifecycle: 'active', updated_at: '2026-10-08T00:00:00Z',
  },
  scenes: [], orphan_shots: [], assets: [], documents: {},
  timing: { total_ms: 0, target_ms: 600000, delta_ms: -600000, status: 'under', scene_states: [] },
  runtime_conflict: false, timeline: [],
  status_summary: { production_approval: 'draft', production_locked: false, scenes: 0, shots: 0,
    scenes_locked: 0, shots_locked: 0, approval_counts: {}, needs_attention: 0 },
  truncated: false, provider: providerStatus,
  capabilities: { frame_extraction: false, frame_extraction_note: 'ffmpeg is not installed.',
    timeline_editing: true, shot_execution: true, ai_prompt_compilation: true, note: 'Prompt 10 delivery.' },
};

const credentialLaw = 'TONDE stores no provider credential. A connection names the vault reference that holds it; a literal secret is refused.';
const tokenBoundary = 'TONDE does not refresh provider tokens. The deployment vault owns refresh; when a provider stops accepting a credential the connection moves to reauth_required.';
const authorityLaw = 'Publishing requires an explicit recorded creator authorization naming the exact Production revision, Result revision, media checksum and destination. A creative approval is not publishing authority, and no service or AI may record one.';
const unknownStateLaw = 'An ambiguous destination answer becomes unknown_remote_state and is never reported as published or as failed; only a recorded reconciliation leaves it.';
const costSeparation = 'Provider cost (actual), estimated cost and the creator charge are separate numbers; credit consumption is separate again.';

const integrationVocabulary = {
  connection_states: {
    connected: 'The provider confirmed this account; this is the only state that authorizes publishing.',
    pending: 'An authorization was recorded but the provider has not confirmed it yet.',
    reauth_required: 'The provider stopped accepting the authorization; a creator must reauthorize.',
    revoked: 'A creator disconnected this account.',
  },
  adapter_states: {
    absent: 'No adapter exists for this provider.',
    implemented: 'An adapter exists but has never been exercised against the real provider.',
    verified: 'A real call to the provider succeeded and was recorded.',
  },
  capability_states: ['AVAILABLE', 'MISSING_SCOPE'], credential_law: credentialLaw,
  token_refresh_boundary: tokenBoundary, retry: { oauth_exchange: 'MUST_NOT_RETRY', provider_verify: 'SAFE_TO_RETRY' },
  oauth_state_law: 'The raw authorization state and verifier are never stored; only their hashes are.',
};

const verifiedAdapter = { provider: 'test_publisher', adapter_present: true, configured: true,
  unconfigured_dependencies: [], network_calls: true };
const unconfiguredAdapter = { provider: 'youtube', adapter_present: true, configured: false,
  unconfigured_dependencies: ['provider_credentials'], network_calls: false };

const connections = {
  items: [
    { id: connectionOne, provider: 'test_publisher', provider_account_id: 'acct-1', status: 'connected',
      scopes: ['publish.video'], auth_type: 'oauth', external_account_label: 'Studio channel',
      requested_scopes: ['publish.video', 'publish.image'], verified_at: '2026-10-08T10:00:00Z',
      last_success_at: '2026-10-08T10:00:00Z', last_error_at: null, last_error_code: null, revoked_at: null,
      metadata: { credential_reference: 'vault/studio' }, adapter: verifiedAdapter,
      granted_scopes: ['publish.video'], missing_requested_scopes: ['publish.image'], verified: true,
      credential_reference_recorded: true, note: '' },
    { id: connectionTwo, provider: 'youtube', provider_account_id: null, status: 'reauth_required',
      scopes: [], auth_type: 'oauth', external_account_label: 'Second channel',
      requested_scopes: ['youtube.upload'], verified_at: null, last_success_at: '2026-10-01T10:00:00Z',
      last_error_at: '2026-10-08T09:00:00Z', last_error_code: 'authentication_failed', revoked_at: null,
      metadata: {}, adapter: unconfiguredAdapter, granted_scopes: [], missing_requested_scopes: ['youtube.upload'],
      verified: false, credential_reference_recorded: false, note: '' },
  ],
  count: 2, vocabulary: integrationVocabulary,
};

const publishingVocabulary = {
  states: { draft: 'Draft', ready: 'Ready to publish', awaiting_authorization: 'Waiting for your authorization',
    published: 'Published', failed: 'Failed', unknown_remote_state: 'Destination state unknown' },
  failure_categories: { policy_violation: "Blocked by the destination's policy", unknown: 'Cause not established' },
  permitted_settings_keys: ['category', 'tags'], authority_law: authorityLaw,
  retry: { publication_submit: 'REQUIRES_IDEMPOTENCY_KEY' }, unknown_state_law: unknownStateLaw,
  provider_boundary: 'The provider call is made by the trusted server through a bounded adapter.',
};

const publication = (overrides: Record<string, unknown> = {}) => ({
  id: publicationId, workspace_id: workspace, production_id: productionId, production_revision: 3,
  result_id: '00000000-0000-4000-8000-000000000030', result_revision: 4,
  media_id: '00000000-0000-4000-8000-000000000040', media_checksum: 'sha256:media-one',
  destination_provider: 'test_publisher', destination_account_id: connectionOne, destination: 'channel-1',
  destination_config: {}, media_type: 'video', visibility: 'public', scheduled_for: null,
  title: 'Marquee Film', caption: 'A keeper loses the light.', state: 'ready', state_label: 'Ready to publish',
  authorization_id: 'auth-1', operation_id: 'op-1', idempotency_key: 'idem-1', submission_attempts: 0,
  last_attempt_at: null, submitted_at: null, remote_resource_type: '', remote_resource_id: null,
  remote_url: null, remote_state: '', last_checked_at: null, published_at: null, failed_at: null,
  failure_category: null, failure_code: null, failure_message: null, cancelled_at: null, removed_at: null,
  created_at: '2026-10-08T10:00:00Z', updated_at: '2026-10-08T10:00:00Z', ...overrides,
});

const publicationStatus = (overrides: Record<string, unknown> = {}) => ({
  publication: publication(overrides.publication as Record<string, unknown> | undefined),
  preview: {
    publication_id: publicationId, state: 'ready',
    production: { id: productionId, title: 'Marquee film', pinned_revision: 3, current_revision: 3 },
    result: { id: 'result-1', state: 'final', approval: 'approved', pinned_revision: 4, current_revision: 4 },
    media: { id: 'media-1', media_type: 'video', mime_type: 'video/mp4', bytes: 2048,
      pinned_checksum: 'sha256:media-one', current_checksum: 'sha256:media-one', upload_state: 'uploaded',
      thumbnail_media_id: null },
    destination: { provider: 'test_publisher', provider_name: 'Test Publisher', account_id: connectionOne,
      account_label: 'Studio channel', target: 'channel-1', visibility: 'public', scheduled_for: null },
    content: { title: 'Marquee Film', caption: 'A keeper loses the light.', settings: {}, fingerprint: 'fp-1' },
    provider_constraints: { max_caption: 5000 }, capability: 'AVAILABLE', missing_scopes: [],
    authorization: { authorization_id: 'auth-1', decision: 'authorize', actor_user_id: uid,
      authorized_at: '2026-10-08T10:00:00Z' },
    retry_safety: 'requires_idempotency_key', can_submit: true, blocked_by: [],
    note: 'Everything this publication needs is present; a creator action may submit it.',
  },
  authorizations: [{ id: 'auth-1', decision: 'authorize', actor_user_id: uid,
    authorized_at: '2026-10-08T10:00:00Z', production_revision: 3, result_revision: 4, media_id: 'media-1',
    media_checksum: 'sha256:media-one', destination_provider: 'test_publisher', destination: 'channel-1',
    note: 'Approved for the public channel.' }],
  attempts: [], reconciliations: [], retry_safety: 'requires_idempotency_key', adapter: verifiedAdapter,
  vocabulary: publishingVocabulary, ...overrides,
});

const exportVocabulary = {
  products: {
    full_document: { label: 'Download Full Document', formats: ['pdf', 'docx'],
      note: 'Rendered from the exact Production version this export pins.' },
    production_package: { label: 'Export Production Package', formats: ['zip', 'json'],
      note: 'A ZIP described file by file by its manifest.' },
  },
  states: { requested: 'Requested', ready: 'Ready to download', failed: 'Failed', expired: 'Expired' },
  package_types: ['complete', 'script', 'shot_list'], retry: { export_build: 'REQUIRES_IDEMPOTENCY_KEY' },
  boundary: 'An export is built from the Production version it pins. If that version cannot be reconstructed the export fails truthfully instead of exporting current state.',
};

const exportRow = (overrides: Record<string, unknown> = {}) => ({
  id: exportReady, workspace_id: workspace, production_id: productionId, job_id: null, kind: 'full_document',
  requested_format: 'pdf', package_type: 'complete', state: 'ready', production_revision: 3,
  production_version_id: 'version-1', generated_media_id: 'media-9', file_count: 1, total_bytes: 9000,
  content_checksum: 'sha256:artifact', requested_by: uid, created_at: '2026-10-08T10:00:00Z',
  ready_at: '2026-10-08T10:05:00Z', failed_at: null, expired_at: null, failure_code: null,
  failure_message: null, completed_at: '2026-10-08T10:05:00Z', manifest: { files: [] }, downloadable: true,
  retry: null, note: 'The artifact exists in the private exports bucket; downloads are authorized per request.',
  schema_version: '1', ...overrides,
});

const exportList = {
  items: [
    exportRow(),
    exportRow({ id: exportExpired, state: 'expired', downloadable: false, expired_at: '2026-10-08T17:00:00Z',
      note: 'This export expired and no longer authorizes downloads.' }),
  ],
  count: 2, vocabulary: exportVocabulary,
};

const billingVocabulary = {
  subscription_states: { none: 'No subscription', active: 'Active', past_due: 'Payment past due',
    cancel_at_period_end: 'Cancels at period end', cancelled: 'Cancelled' },
  cost_kinds: {
    actual_provider_cost: 'What the provider reported it cost. Never presented as a charge.',
    estimated_provider_cost: 'A labelled estimate. Never presented as a charge.',
    charged_to_creator: 'What this workspace was charged, as recorded.',
    credits_consumed: 'Entitlement credits consumed, from the quota ledger.',
  },
  authority_law: 'Billing is server-authoritative. A subscription moves only because a verified provider event says so.',
  webhook_law: 'An unverified payload is never commercial evidence.',
  retry: { billing_webhook: 'REQUIRES_RECONCILIATION' },
};

const billingStatus = {
  workspace_id: workspace,
  subscription: { state: 'active', plan_key: 'studio', plan_name: 'Studio', cancel_at_period_end: false,
    current_period_end: '2026-11-08T10:00:00Z', provider_state_at: '2026-10-08T10:00:00Z', grants_entitlements: true },
  provider: { name: 'test_billing', configured: false },
  entitlements: [
    { key: 'generation.credits', name: 'Generation credits', kind: 'quota', unit: 'credit', source: 'plan',
      limit_amount: 100, consumed_amount: 25, reserved_amount: 2.5, remaining: 72.5, valid_until: null },
  ],
  open_checkouts: [], note: 'Commercial facts come from verified provider events.',
};

const usageSummary = {
  workspace_id: workspace, events: 2,
  metrics: [{ metric: 'generation.credit', unit: 'credit', quantity: 27.5, events: 2, credits: 27.5,
    actual_provider_cost: 0, estimated_provider_cost: 0.25, charges: 0.4,
    basis_counts: { actual: 0, estimated: 2, unknown: 0 } }],
  window: { since: null, limit: 200 }, cost_separation: costSeparation,
  note: 'Cost figures come only from recorded usage events.',
};

const costSummary = {
  workspace_id: workspace, actual_provider_cost: 1.25, estimated_provider_cost: 0.25,
  charged_to_creator: 0.4, credits_consumed: 27.5, currency: 'USD', rows: { actual: 1, estimated: 1, unknown: 1 },
  meaning: { actual_provider_cost: 'What the provider reported it cost.', estimated_provider_cost: 'A cost TONDE estimated.',
    charged_to_creator: 'What this workspace was charged, as recorded.', credits_consumed: 'Credits consumed.' },
  note: 'The totals above are not a revenue figure and are not a provider invoice.',
};

const checkout = {
  intent_id: 'intent-1', plan_key: 'studio', state: 'started', provider: 'test_billing',
  provider_price_id: 'price-1', checkout_url: null, provider_configured: false,
  unconfigured: ['payment_provider_credentials'], retry: 'REQUIRES_IDEMPOTENCY_KEY',
  note: 'The checkout intent is recorded. No provider session was created because this deployment has not configured the payment provider credentials, so nothing was subscribed.',
  authority: 'Only a verified provider event can move a subscription; this call cannot.',
};

type Write = { path: string; method: string; body: Record<string, unknown> };

async function platform(page: Page) {
  await page.route('https://tonde-test.supabase.co/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path === '/auth/v1/user') return route.fulfill({ json: { id: uid, email: 'creator@example.com' } });
    if (path === '/rest/v1/rpc/bootstrap_workspace') return route.fulfill({ json: workspace });
    if (path === '/rest/v1/productions') {
      const single = request.headers().accept?.includes('vnd.pgrst.object');
      return route.fulfill({ json: single ? production : [production] });
    }
    return route.fulfill({ json: [] });
  });
  await page.addInitScript(({ uid }) => {
    const payload = btoa(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 }));
    localStorage.setItem('sb-tonde-test-auth-token', JSON.stringify({ access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.test-only`, refresh_token: 'test-only', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: uid, email: 'creator@example.com', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-10-08T00:00:00Z' } }));
  }, { uid });
}

async function prompt10Api(page: Page, writes: Write[]) {
  // The destination state the stub reports, so a later read can disagree with the submission's own answer.
  const state = { publication: publicationStatus() as ReturnType<typeof publicationStatus> };
  const record = (route: Route) => {
    const request = route.request();
    writes.push({ path: new URL(request.url()).pathname, method: request.method(),
      body: (request.postDataJSON?.() ?? {}) as Record<string, unknown> });
  };

  await page.route('http://127.0.0.1:8001/api/v1/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    const method = request.method();

    // Studio shell
    if (path.endsWith('/director/studio')) return route.fulfill({ json: envelope(null) });
    if (path.endsWith('/studio')) return route.fulfill({ json: envelope(studioModel) });

    // § integrations
    if (path.endsWith('/integrations/vocabulary')) return route.fulfill({ json: envelope(integrationVocabulary) });
    if (path.endsWith('/integrations/providers')) return route.fulfill({ json: envelope({
      items: [
        { key: 'test_publisher', name: 'Test Publisher', category: 'social_publishing', auth_type: 'oauth',
          adapter_state: 'verified', enabled: true, media_types: ['video'], scopes: ['publish.video'],
          restrictions: {}, note: '', docs_url: '', adapter: verifiedAdapter, connection_available: true,
          capabilities: [{ provider_key: 'test_publisher', capability_key: 'publish', connection_required: true,
            required_scopes: ['publish.video'], enabled: true, note: '' }] },
        { key: 'youtube', name: 'YouTube', category: 'social_publishing', auth_type: 'oauth',
          adapter_state: 'implemented', enabled: true, media_types: ['video'], scopes: ['youtube.upload'],
          restrictions: {}, note: '', docs_url: '', adapter: unconfiguredAdapter, connection_available: true,
          capabilities: [{ provider_key: 'youtube', capability_key: 'publish', connection_required: true,
            required_scopes: ['youtube.upload'], enabled: true, note: '' }] },
      ], count: 2, vocabulary: integrationVocabulary }) });
    if (path.endsWith('/integrations/connections') && method === 'GET')
      return route.fulfill({ json: envelope(connections) });
    if (path.endsWith('/integrations/oauth/initiate')) {
      record(route);
      return route.fulfill({ json: envelope({ provider: 'youtube', initiated: false, authorize_url: null,
        state: null, unconfigured: ['provider_credentials'],
        note: 'The authorization URL cannot be produced: provider_credentials.' }) });
    }
    if (path.endsWith('/verify')) {
      record(route);
      return route.fulfill({ json: envelope({ provider: 'test_publisher', connection_id: connectionOne,
        connected: true, verified: true, status: 'connected',
        note: 'The provider confirmed this connection.' }) });
    }
    if (path.endsWith('/disconnect')) {
      record(route);
      return route.fulfill({ json: envelope({ connection_id: connectionOne, provider: 'test_publisher',
        status: 'revoked', revoked_at: '2026-10-08T11:00:00Z', remote_revoked: true,
        note: 'The connection is revoked in TONDE and no longer authorizes publishing.' }) });
    }

    // § publishing
    if (path.endsWith('/publishing/vocabulary')) return route.fulfill({ json: envelope(publishingVocabulary) });
    if (path.endsWith('/publications') && method === 'GET') return route.fulfill({ json: envelope({
      items: [state.publication.publication], count: 1, vocabulary: publishingVocabulary }) });
    if (path.endsWith('/publications') && method === 'POST') { record(route); return route.fulfill({ json: envelope(null) }); }
    if (path.endsWith('/authorize')) {
      record(route);
      return route.fulfill({ json: envelope({ publication_id: publicationId, decision: 'authorize', state: 'ready',
        authorization_id: 'auth-2', creative_approval_used_as_authority: false,
        note: 'A creator authorized publishing this exact version to this exact destination.' }) });
    }
    if (path.endsWith('/submit')) {
      record(route);
      // The destination accepted this exact publication and named the resource it created.
      state.publication = publicationStatus({ publication: publication({ state: 'published',
        published_at: '2026-10-08T10:06:00Z', remote_resource_id: 'remote-1',
        remote_url: 'https://destination.invalid/p/remote-1' }) });
      return route.fulfill({ json: envelope({ publication_id: publicationId, state: 'published',
        outcome: 'succeeded', remote_resource_id: 'remote-1', remote_url: 'https://destination.invalid/p/remote-1',
        retry: 'MUST_NOT_RETRY', meaning: 'The destination confirmed this exact publication.' }) });
    }
    if (path.endsWith('/refresh')) {
      record(route);
      // A later read of the destination is ambiguous: TONDE must not keep claiming success.
      state.publication = publicationStatus({ publication: publication({ state: 'unknown_remote_state',
        last_checked_at: '2026-10-08T10:07:00Z', submission_attempts: 1 }) });
      return route.fulfill({ json: envelope({ publication_id: publicationId, refreshed: true,
        state: 'unknown_remote_state',
        note: 'The destination answer was ambiguous, so this publication is in destination state unknown until a reconciliation records what it really holds.' }) });
    }
    if (path.endsWith('/reconcile')) {
      record(route);
      state.publication = publicationStatus({ publication: publication({ state: 'published',
        remote_resource_id: 'remote-9', remote_url: 'https://destination.invalid/p/remote-9',
        published_at: '2026-10-08T10:09:00Z' }),
        reconciliations: [{ id: 'rec-1', observed_state: 'published', remote_state: 'published',
          remote_resource_id: 'remote-9', source: 'manual_operator', note: 'Seen on the channel.',
          observed_at: '2026-10-08T10:09:00Z' }] });
      return route.fulfill({ json: envelope({ publication_id: publicationId, state: 'published',
        source: 'manual_operator', note: 'The destination really holds this publication.' }) });
    }
    if (path.includes('/publications/') && method === 'GET')
      return route.fulfill({ json: envelope(state.publication) });

    // § exports
    if (path.endsWith('/exports/vocabulary')) return route.fulfill({ json: envelope(exportVocabulary) });
    if (path.endsWith('/exports') && method === 'GET') return route.fulfill({ json: envelope(exportList) });
    if (path.endsWith('/exports') && method === 'POST') {
      record(route);
      const body = (request.postDataJSON?.() ?? {}) as Record<string, unknown>;
      return route.fulfill({ json: envelope({ export_id: exportReady, state: 'requested', kind: body.kind,
        format: body.format, package_type: body.package_type, production_revision: 3,
        production_version_id: 'version-1', retry: 'REQUIRES_IDEMPOTENCY_KEY', built_by: 'tonde-api process' }) });
    }
    if (path.endsWith('/download')) {
      record(route);
      return route.fulfill({ json: envelope({ authorized: true, export_id: exportReady, state: 'ready',
        bucket: 'tonde-exports', object_key: 'workspace/object.pdf', window_seconds: 300,
        kind: 'full_document', format: 'pdf', download_url: null,
        note: 'Download authorized for this request, but no signed URL could be produced in this environment.' }) });
    }

    // § billing, entitlements, usage and cost
    if (path.endsWith('/billing/vocabulary')) return route.fulfill({ json: envelope(billingVocabulary) });
    if (path.endsWith('/billing/status')) return route.fulfill({ json: envelope(billingStatus) });
    if (path.endsWith('/usage/summary')) return route.fulfill({ json: envelope(usageSummary) });
    if (path.endsWith('/costs')) return route.fulfill({ json: envelope(costSummary) });
    if (path.endsWith('/billing/checkout')) { record(route); return route.fulfill({ json: envelope(checkout) }); }

    return route.fulfill({ json: envelope(null) });
  });
}

test('a destination account is connected only as the provider confirmed it, and the deployment states what it is missing', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await platform(page);
  const writes: Write[] = [];
  await prompt10Api(page, writes);

  await page.goto('/settings/connections');
  const accounts = page.getByLabel('Connected destination accounts');
  await expect(accounts.getByText('Studio channel')).toBeVisible();

  // The word "connected" is supported by the provider's own confirmation, and the failing account says so.
  await expect(accounts.getByText('The provider confirmed this account; this is the only state that authorizes publishing.')).toBeVisible();
  await expect(accounts.getByText('Second channel')).toBeVisible();
  await expect(accounts.getByText('The provider stopped accepting the authorization; a creator must reauthorize.')).toBeVisible();
  await expect(accounts.getByText(/Last error: authentication_failed/)).toBeVisible();
  await expect(accounts.getByText('Verification: not confirmed by the provider')).toBeVisible();
  await expect(accounts.getByText('Missing scopes TONDE asked for: publish.image')).toBeVisible();

  // No credential is ever typed into this surface: a vault reference is named instead.
  await expect(page.getByText(`${credentialLaw} ${tokenBoundary}`)).toBeVisible();
  await expect(accounts.getByText('Credential: a vault reference is recorded; TONDE stores no credential')).toBeVisible();

  // A provider this deployment cannot call says which dependency is missing.
  const providers = page.getByLabel('Providers available to this deployment');
  await expect(providers.getByText('No provider call can be made: this deployment is missing provider_credentials.')).toBeVisible();
  await expect(providers.getByText('An adapter exists but has never been exercised against the real provider.')).toBeVisible();

  // Verification is a request to the server; the surface reports the server's answer.
  await page.getByRole('button', { name: /Verify again/ }).first().click();
  await expect.poll(() => writes.some(write => write.path.endsWith('/verify'))).toBe(true);
  await expect(page.getByText('The provider confirmed this connection.')).toBeVisible();
  const verify = writes.find(write => write.path.endsWith('/verify'));
  expect(verify?.method).toBe('POST');
  expect(verify?.path).toBe(`/api/v1/workspaces/${workspace}/integrations/connections/${connectionOne}/verify`);

  // Disconnect records the creator's reason, and no revision is invented for it.
  await page.getByLabel('Disconnect reason').fill('Retiring this channel.');
  await page.getByRole('button', { name: /Disconnect/ }).first().click();
  await expect.poll(() => writes.some(write => write.path.endsWith('/disconnect'))).toBe(true);
  const disconnect = writes.find(write => write.path.endsWith('/disconnect'));
  expect(disconnect?.body).toEqual({ reason: 'Retiring this channel.' });
  // The surface reports the server's own answer to the disconnect, not a local claim.
  await expect(page.getByText('The connection is revoked in TONDE and no longer authorizes publishing.')).toBeVisible();

  // An unconfigured authorization flow offers no URL, because none was produced.
  await page.getByRole('button', { name: /Start authorization/ }).click();
  await expect.poll(() => writes.some(write => write.path.endsWith('/oauth/initiate'))).toBe(true);
  await expect(page.getByText('The authorization URL cannot be produced: provider_credentials.')).toBeVisible();
  await expect(page.getByText('Unavailable here: provider_credentials.')).toBeVisible();
  await expect(page.getByRole('link', { name: /Open the provider authorization page/ })).toHaveCount(0);
  await expect(page.getByText('The raw authorization state and verifier are never stored; only their hashes are.')).toBeVisible();

  // The browser never wrote to a subscription or an entitlement: connections are all this surface can touch.
  expect(writes.every(write => write.path.includes('/integrations/'))).toBe(true);
  expect(errors).toEqual([]);
});

test('publishing pins the exact version, needs the creator\'s own authorization, and never claims a state the destination did not confirm', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await platform(page);
  const writes: Write[] = [];
  await prompt10Api(page, writes);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/studio/${productionId}?tool=Publishing`);
  const pinned = page.getByLabel('Pinned content and destination');
  await expect(pinned.getByText('Production revision (pinned)')).toBeVisible();
  await expect(pinned.getByText('Result revision (pinned)')).toBeVisible();
  await expect(pinned.getByText('sha256:media-one')).toBeVisible();
  await expect(pinned.getByText('test_publisher · channel-1')).toBeVisible();
  await expect(page.getByText(authorityLaw)).toBeVisible();

  // The exact version and destination are named; a creative approval is explicitly a different decision.
  const authorization = page.getByLabel('Publishing authorization');
  await expect(authorization.getByText('A creative approval of the Result is a different decision')).toBeVisible();
  await expect(page.getByLabel('What would go out').getByText('Nothing blocks a submission right now.')).toBeVisible();

  await page.getByLabel('Decision note').fill('Approved for the public channel.');
  await page.getByRole('button', { name: /Authorize publishing this exact version/ }).click();
  await expect.poll(() => writes.some(write => write.path.endsWith('/authorize'))).toBe(true);
  const authorize = writes.find(write => write.path.endsWith('/authorize'));
  expect(authorize?.body).toEqual({ decision: 'authorize', note: 'Approved for the public channel.' });
  // Authorizing changes no content and no revision: it is a decision, not an edit.
  expect(writes.filter(write => write.method === 'PATCH')).toEqual([]);
  await expect(page.getByText('A creator authorized publishing this exact version to this exact destination.')).toBeVisible();

  // Submission reports the destination's own answer and the resource it created.
  await page.getByRole('button', { name: /Submit to the destination/ }).click();
  await expect.poll(() => writes.some(write => write.path.endsWith('/submit'))).toBe(true);
  await expect(page.getByText(/Published: the destination confirmed this publication as remote-1/)).toBeVisible();
  await expect(page.getByRole('link', { name: /Open at the destination/ })).toHaveAttribute(
    'href', 'https://destination.invalid/p/remote-1');

  // A later read is ambiguous: the same surface must stop reporting success and offer reconciliation.
  await page.getByRole('button', { name: /Read the destination state/ }).click();
  await expect.poll(() => writes.some(write => write.path.endsWith('/refresh'))).toBe(true);
  const alert = page.getByRole('alert');
  await expect(alert).toContainText(unknownStateLaw);
  await expect(page.getByText(/Published: the destination confirmed/)).toHaveCount(0);
  await expect(page.getByLabel('Reconciliation').getByText(unknownStateLaw)).toBeVisible();

  // Only a recorded reconciliation leaves the unknown state, and it records what the creator observed.
  await page.getByLabel('Observed destination state').selectOption('published');
  await page.getByLabel('Observed remote resource').fill('remote-9');
  await page.getByLabel('Decision note').fill('Seen on the channel myself.');
  await page.getByRole('button', { name: /Record what the destination shows/ }).click();
  await expect.poll(() => writes.some(write => write.path.endsWith('/reconcile'))).toBe(true);
  const reconcile = writes.find(write => write.path.endsWith('/reconcile'));
  expect(reconcile?.body).toEqual({ observed: 'published', note: 'Seen on the channel myself.',
    remote_resource_id: 'remote-9' });
  await expect(page.getByText('The destination really holds this publication.')).toBeVisible();
  await expect(page.getByRole('link', { name: /Open at the destination/ })).toHaveAttribute(
    'href', 'https://destination.invalid/p/remote-9');

  // The browser submitted only what the creator asked for, and never a subscription-like write.
  expect(writes.map(write => write.path.split('/').pop())).toEqual(['authorize', 'submit', 'refresh', 'reconcile']);
  expect(errors).toEqual([]);
});

test('exports are two named products, and the browser shows no download link it did not receive', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await platform(page);
  const writes: Write[] = [];
  await prompt10Api(page, writes);

  await page.goto(`/studio/${productionId}?tool=Exports`);

  // Two products, kept visibly apart, each stating what it produces.
  const document = page.getByLabel('Download Full Document');
  await expect(document.getByText('Rendered from the exact Production version this export pins.')).toBeVisible();
  const packageProduct = page.getByLabel('Export Production Package');
  await expect(packageProduct.getByText('A ZIP described file by file by its manifest.')).toBeVisible();

  // The request carries exactly the product and format the creator chose.
  await document.getByLabel('Full document format').selectOption('docx');
  await document.getByRole('button', { name: /Download Full Document/ }).click();
  await expect.poll(() => writes.some(write => write.path.endsWith('/exports') && write.method === 'POST')).toBe(true);
  const documentRequest = writes.find(write => write.method === 'POST');
  expect(documentRequest?.body).toEqual({ production_id: productionId, kind: 'full_document',
    format: 'docx', package_type: 'complete' });

  await packageProduct.getByLabel('Package format').selectOption('json');
  await packageProduct.getByLabel('Package type').selectOption('shot_list');
  await packageProduct.getByRole('button', { name: /Export Production Package/ }).click();
  await expect.poll(() => writes.filter(write => write.method === 'POST').length).toBe(2);
  const packageRequest = writes.filter(write => write.method === 'POST')[1];
  expect(packageRequest.body).toEqual({ production_id: productionId, kind: 'production_package',
    format: 'json', package_type: 'shot_list' });

  // The list reports the pinned version and the facts the database holds, not a local guess.
  const list = page.getByLabel('Exports of this Production');
  await expect(list.getByText(/revision 3/).first()).toBeVisible();
  await expect(list.getByText('Ready to download')).toBeVisible();
  await expect(list.getByText('1 file(s), 9000 bytes').first()).toBeVisible();
  await expect(list.getByText('sha256:artifact').first()).toBeVisible();

  // An authorization that produced no signed URL is reported as exactly that — and no link appears.
  await list.getByRole('button', { name: /^Download$/ }).first().click();
  await expect.poll(() => writes.some(write => write.path.endsWith('/download'))).toBe(true);
  await expect(page.getByText(/no signed URL could be produced in this environment/)).toBeVisible();
  await expect(page.getByText('A short-lived download link was issued for this export.')).toHaveCount(0);

  // An expired export stops offering a download at all.
  const expiredRow = list.locator('li', { hasText: 'Expired' });
  await expect(expiredRow).toBeVisible();
  await expect(expiredRow.getByRole('button', { name: /^Download$/ })).toBeDisabled();

  // Only the two product requests were writes; nothing here built, expired or re-requested anything else.
  expect(writes.filter(write => write.method === 'POST').map(write => write.path)).toEqual([
    `/api/v1/workspaces/${workspace}/exports`, `/api/v1/workspaces/${workspace}/exports`]);
  expect(errors).toEqual([]);
});

test('billing reads server facts, keeps the four cost kinds apart, and invents no provider session', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await platform(page);
  const writes: Write[] = [];
  await prompt10Api(page, writes);

  await page.goto('/settings/billing');
  const subscription = page.getByLabel('Subscription', { exact: true });
  await expect(subscription.getByText('Active')).toBeVisible();
  await expect(subscription.getByText('Studio')).toBeVisible();
  await expect(subscription.getByText('Yes')).toBeVisible();
  await expect(page.getByText('Billing is server-authoritative. A subscription moves only because a verified provider event says so.')).toBeVisible();

  // An entitlement is shown with the balance the server reported.
  const entitlements = page.getByLabel('Entitlements', { exact: true });
  await expect(entitlements.getByText(/Generation credits/)).toBeVisible();
  await expect(entitlements.getByText(/72.5 of 100 credit remaining/)).toBeVisible();
  await expect(entitlements.getByText(/granted by the plan/)).toBeVisible();

  // Four separate numbers with four separate meanings — never summed into one figure.
  const cost = page.getByLabel('Cost', { exact: true });
  await expect(cost.getByText('actual provider cost')).toBeVisible();
  await expect(cost.getByText('1.25')).toBeVisible();
  await expect(cost.getByText('0.25')).toBeVisible();
  await expect(cost.getByText('0.4')).toBeVisible();
  await expect(cost.getByText('27.5')).toBeVisible();
  await expect(cost.getByText('What the provider reported it cost. Never presented as a charge.')).toBeVisible();
  await expect(cost.getByText(/Rows by cost basis: 1 actual, 1 estimated, 1 with no cost reported/)).toBeVisible();
  await expect(page.getByText(/not a revenue figure/)).toBeVisible();
  const usage = page.getByLabel('Usage', { exact: true });
  await expect(usage.getByText(costSeparation)).toBeVisible();

  // A deployment without a payment provider says so, records the intent, and invents no session or URL.
  await expect(page.getByText('No payment provider is configured in this deployment')).toBeVisible();
  await page.getByLabel('Plan key').fill('studio');
  await page.getByRole('button', { name: /Start checkout/ }).click();
  await expect.poll(() => writes.some(write => write.path.endsWith('/billing/checkout'))).toBe(true);
  const checkoutWrite = writes.find(write => write.path.endsWith('/billing/checkout'));
  expect(checkoutWrite?.body).toEqual({ plan_key: 'studio' });
  await expect(page.getByText(/No provider session was created because this deployment has not configured/)).toBeVisible();
  await expect(page.getByText('A provider session was opened.')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Continue at the provider/ })).toHaveCount(0);

  // The only write this surface made is the checkout intent: nothing subscribed or granted anything here.
  expect(writes.map(write => write.path)).toEqual([`/api/v1/workspaces/${workspace}/billing/checkout`]);
  expect(errors).toEqual([]);
});
