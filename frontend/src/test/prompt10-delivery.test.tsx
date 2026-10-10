import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationsCanvas } from '../prompt10/Integrations';
import { PublishingCanvas } from '../prompt10/Publishing';
import { ExportsCanvas } from '../prompt10/Exports';
import { BillingCanvas } from '../prompt10/Billing';
import { integrationService, type IntegrationVocabulary } from '../services/integrations';
import { publishingService, type Publication, type PublicationPreview, type PublicationStatus,
  type PublishingVocabulary } from '../services/publishing';
import { exportService, type ExportVocabulary, type ProductionExport } from '../services/exports';
import { billingService, type BillingStatus } from '../services/billing';
import { AppError } from '../services/errors';

vi.mock('../services/integrations', () => ({
  integrationService: {
    vocabulary: vi.fn(), providers: vi.fn(), capabilities: vi.fn(), connections: vi.fn(),
    attemptInitiation: vi.fn(), completeCallback: vi.fn(), connect: vi.fn(), verify: vi.fn(),
    reauthorize: vi.fn(), disconnect: vi.fn(),
  },
}));
vi.mock('../services/publishing', () => ({
  publishingService: {
    vocabulary: vi.fn(), list: vi.fn(), create: vi.fn(), status: vi.fn(), preview: vi.fn(),
    update: vi.fn(), setState: vi.fn(), authorize: vi.fn(), submit: vi.fn(), refresh: vi.fn(), reconcile: vi.fn(),
  },
}));
vi.mock('../services/exports', () => ({
  EXPORT_PACKAGE_TYPES: ['complete', 'script', 'shot_list'],
  exportService: { vocabulary: vi.fn(), list: vi.fn(), request: vi.fn(), detail: vi.fn(), build: vi.fn(),
    download: vi.fn(), expire: vi.fn() },
}));
vi.mock('../services/billing', () => ({
  billingService: { vocabulary: vi.fn(), status: vi.fn(), account: vi.fn(), entitlement: vi.fn(),
    usage: vi.fn(), usageSummary: vi.fn(), costs: vi.fn(), checkout: vi.fn(), portal: vi.fn() },
}));

const workspaceId = '00000000-0000-4000-8000-000000000010';
const productionId = '00000000-0000-4000-8000-000000000020';
const publicationId = '00000000-0000-4000-8000-000000000050';
const exportId = '00000000-0000-4000-8000-0000000000e1';
const connectionId = '00000000-0000-4000-8000-000000000070';

const CREDENTIAL_LAW = 'TONDE stores no provider credential. A connection names the vault reference that holds it; a literal secret is refused.';
const TOKEN_BOUNDARY = 'TONDE does not refresh provider tokens. The deployment vault owns refresh; when a provider stops accepting a credential the connection moves to reauth_required.';
const AUTHORITY_LAW = 'Publishing requires an explicit recorded creator authorization naming the exact Production revision, Result revision, media checksum and destination. A creative approval is not publishing authority, and no service or AI may record one.';
const UNKNOWN_LAW = 'An ambiguous destination answer becomes unknown_remote_state and is never reported as published or as failed; only a recorded reconciliation leaves it.';
const COST_SEPARATION = 'Provider cost (actual), estimated cost and the creator charge are separate numbers; credit consumption is separate again.';

const adapter = { provider: 'test_publisher', adapter_present: true, configured: true, unconfigured_dependencies: [], network_calls: true };
const blockedAdapter = { ...adapter, configured: false, unconfigured_dependencies: ['provider_credentials'], network_calls: false };

const integrationVocabulary: IntegrationVocabulary = {
  connection_states: {
    connected: 'The provider confirmed this account; this is the only state that authorizes publishing.',
    pending: 'An authorization was recorded but the provider has not confirmed it yet.',
    reauth_required: 'The provider stopped accepting the authorization; a creator must reauthorize.',
    revoked: 'A creator disconnected this account.',
  },
  adapter_states: { absent: 'No adapter exists for this provider.', implemented: 'An adapter exists but has never been exercised against the real provider.', verified: 'A real call to the provider succeeded and was recorded.' },
  capability_states: ['AVAILABLE', 'MISSING_SCOPE'], credential_law: CREDENTIAL_LAW,
  token_refresh_boundary: TOKEN_BOUNDARY, retry: { oauth_exchange: 'MUST_NOT_RETRY', provider_verify: 'SAFE_TO_RETRY' },
  oauth_state_law: 'The raw authorization state and verifier are never stored; only their hashes are.',
};

const publishingVocabulary: PublishingVocabulary = {
  states: { draft: 'Draft', ready: 'Ready to publish', awaiting_authorization: 'Waiting for your authorization',
    published: 'Published', failed: 'Failed', unknown_remote_state: 'Destination state unknown' },
  failure_categories: { policy_violation: "Blocked by the destination's policy", unknown: 'Cause not established' },
  permitted_settings_keys: ['category', 'tags'], authority_law: AUTHORITY_LAW,
  retry: { publication_submit: 'REQUIRES_IDEMPOTENCY_KEY' }, unknown_state_law: UNKNOWN_LAW,
  provider_boundary: 'The provider call is made by the trusted server through a bounded adapter.',
};

const exportVocabulary: ExportVocabulary = {
  products: {
    full_document: { label: 'Download Full Document', formats: ['pdf', 'docx'], note: 'Rendered from the exact Production version this export pins.' },
    production_package: { label: 'Export Production Package', formats: ['zip', 'json'], note: 'A ZIP described file by file by its manifest.' },
  },
  states: { requested: 'Requested', ready: 'Ready to download', failed: 'Failed', expired: 'Expired' },
  package_types: ['complete', 'script', 'shot_list'], retry: { export_build: 'REQUIRES_IDEMPOTENCY_KEY' },
  boundary: 'An export is built from the Production version it pins. If that version cannot be reconstructed the export fails truthfully instead of exporting current state.',
};

beforeEach(() => {
  vi.mocked(integrationService.vocabulary).mockResolvedValue(integrationVocabulary);
  vi.mocked(integrationService.providers).mockResolvedValue({
    items: [
      { key: 'test_publisher', name: 'Test Publisher', category: 'social_publishing', auth_type: 'oauth',
        adapter_state: 'verified', enabled: true, media_types: ['video'], scopes: ['publish.video'],
        restrictions: {}, note: '', docs_url: '', adapter, connection_available: true,
        capabilities: [{ provider_key: 'test_publisher', capability_key: 'publish', connection_required: true,
          required_scopes: ['publish.video'], enabled: true, note: '' }] },
      { key: 'youtube', name: 'YouTube', category: 'social_publishing', auth_type: 'oauth',
        adapter_state: 'implemented', enabled: true, media_types: ['video'], scopes: ['youtube.upload'],
        restrictions: {}, note: '', docs_url: '', adapter: blockedAdapter, connection_available: true,
        capabilities: [{ provider_key: 'youtube', capability_key: 'publish', connection_required: true,
          required_scopes: ['youtube.upload'], enabled: true, note: '' }] },
    ],
    count: 2, vocabulary: integrationVocabulary,
  });
  vi.mocked(integrationService.connections).mockResolvedValue({
    items: [
      { id: connectionId, provider: 'test_publisher', provider_account_id: 'acct-1', status: 'connected',
        scopes: ['publish.video'], auth_type: 'oauth', external_account_label: 'Studio channel',
        requested_scopes: ['publish.video', 'publish.image'], verified_at: '2026-10-08T10:00:00Z',
        last_success_at: '2026-10-08T10:00:00Z', last_error_at: null, last_error_code: null, revoked_at: null,
        metadata: { credential_reference: 'vault/studio' }, adapter,
        granted_scopes: ['publish.video'], missing_requested_scopes: ['publish.image'], verified: true,
        credential_reference_recorded: true, note: '' },
      { id: '00000000-0000-4000-8000-000000000071', provider: 'youtube', provider_account_id: null,
        status: 'reauth_required', scopes: [], auth_type: 'oauth', external_account_label: 'Second channel',
        requested_scopes: ['youtube.upload'], verified_at: null, last_success_at: '2026-10-01T10:00:00Z',
        last_error_at: '2026-10-08T09:00:00Z', last_error_code: 'authentication_failed', revoked_at: null,
        metadata: {}, adapter: blockedAdapter, granted_scopes: [], missing_requested_scopes: ['youtube.upload'],
        verified: false, credential_reference_recorded: false, note: '' },
    ],
    count: 2, vocabulary: integrationVocabulary,
  });
  vi.mocked(integrationService.verify).mockResolvedValue({ provider: 'test_publisher', connection_id: connectionId,
    connected: true, verified: true, status: 'connected', note: 'The provider confirmed this connection.' });
  vi.mocked(integrationService.disconnect).mockResolvedValue({ connection_id: connectionId, provider: 'test_publisher',
    status: 'revoked', revoked_at: '2026-10-08T11:00:00Z', remote_revoked: true,
    note: 'The connection is revoked in TONDE and no longer authorizes publishing.' });
  vi.mocked(integrationService.attemptInitiation).mockResolvedValue({ provider: 'test_publisher', initiated: false,
    authorize_url: null, state: null, unconfigured: ['provider_credentials'],
    note: 'The authorization URL cannot be produced: provider_credentials.' });

  vi.mocked(publishingService.vocabulary).mockResolvedValue(publishingVocabulary);
  vi.mocked(publishingService.list).mockResolvedValue({ items: [publication()], count: 1,
    vocabulary: publishingVocabulary });
  vi.mocked(publishingService.status).mockResolvedValue(status());
  vi.mocked(publishingService.authorize).mockResolvedValue({ publication_id: publicationId,
    decision: 'authorize', state: 'ready', authorization_id: 'auth-1',
    creative_approval_used_as_authority: false,
    note: 'A creator authorized publishing this exact version to this exact destination.' });
  vi.mocked(publishingService.submit).mockResolvedValue({ publication_id: publicationId, state: 'published',
    outcome: 'succeeded', remote_resource_id: 'remote-1', remote_url: 'https://destination.invalid/p/remote-1',
    retry: 'MUST_NOT_RETRY', meaning: 'The destination confirmed this exact publication.' });
  vi.mocked(publishingService.refresh).mockResolvedValue({ publication_id: publicationId, refreshed: false,
    state: 'ready', note: 'This publication was never submitted, so there is no destination state to read.' });
  vi.mocked(publishingService.reconcile).mockResolvedValue({ publication_id: publicationId, state: 'published',
    source: 'manual_operator', note: 'The destination really holds this publication.' });

  vi.mocked(exportService.vocabulary).mockResolvedValue(exportVocabulary);
  vi.mocked(exportService.list).mockResolvedValue({ items: [readyExport()], count: 1, vocabulary: exportVocabulary });
  vi.mocked(exportService.request).mockResolvedValue({ export_id: exportId, state: 'requested',
    kind: 'full_document', format: 'pdf', package_type: 'complete', production_revision: 3,
    production_version_id: 'version-1', retry: 'REQUIRES_IDEMPOTENCY_KEY', built_by: 'tonde-api process' });
  vi.mocked(exportService.download).mockResolvedValue({ authorized: true, export_id: exportId, state: 'ready',
    bucket: 'tonde-exports', object_key: 'workspace/object.pdf', window_seconds: 300,
    kind: 'full_document', format: 'pdf', download_url: null,
    note: 'Download authorized for this request, but no signed URL could be produced in this environment.' });
  vi.mocked(exportService.expire).mockResolvedValue({ ...readyExport(), state: 'expired', downloadable: false,
    note: 'This export expired and no longer authorizes downloads.' });

  vi.mocked(billingService.vocabulary).mockResolvedValue({
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
  });
  vi.mocked(billingService.status).mockResolvedValue(billingStatus());
  vi.mocked(billingService.usageSummary).mockResolvedValue({
    workspace_id: workspaceId, events: 2,
    metrics: [{ metric: 'generation.credit', unit: 'credit', quantity: 27.5, events: 2, credits: 27.5,
      actual_provider_cost: 0, estimated_provider_cost: 0.25, charges: 0.4, basis_counts: { actual: 0, estimated: 2, unknown: 0 } }],
    window: { since: null, limit: 200 }, cost_separation: COST_SEPARATION,
    note: 'Cost figures come only from recorded usage events.',
  });
  vi.mocked(billingService.costs).mockResolvedValue({
    workspace_id: workspaceId, actual_provider_cost: 1.25, estimated_provider_cost: 0.25,
    charged_to_creator: 0.4, credits_consumed: 27.5, currency: 'USD',
    rows: { actual: 1, estimated: 1, unknown: 1 },
    meaning: { actual_provider_cost: 'What the provider reported it cost.', estimated_provider_cost: 'A cost TONDE estimated.',
      charged_to_creator: 'What this workspace was charged, as recorded.', credits_consumed: 'Credits consumed.' },
    note: 'The totals above are not a revenue figure and are not a provider invoice.',
  });
  vi.mocked(billingService.checkout).mockResolvedValue({ intent_id: 'intent-1', plan_key: 'studio', state: 'started',
    provider: 'test_billing', provider_price_id: 'price-1', checkout_url: null, provider_configured: false,
    unconfigured: ['payment_provider_credentials'], retry: 'REQUIRES_IDEMPOTENCY_KEY',
    note: 'The checkout intent is recorded. No provider session was created because this deployment has not configured the payment provider credentials, so nothing was subscribed.',
    authority: 'Only a verified provider event can move a subscription; this call cannot.' });
  vi.mocked(billingService.portal).mockResolvedValue({ workspace_id: workspaceId, portal_url: null,
    provider: 'test_billing', provider_configured: false, unconfigured: ['payment_provider_credentials'],
    has_account: true, retry: 'REQUIRES_IDEMPOTENCY_KEY',
    note: 'No billing portal session was created: this deployment has no payment provider credentials, and TONDE will not invent a portal URL.' });
});

afterEach(() => { vi.clearAllMocks(); });

function publication(overrides: Partial<Publication> = {}): Publication {
  return {
    id: publicationId, workspace_id: workspaceId, production_id: productionId, production_revision: 3,
    result_id: '00000000-0000-4000-8000-000000000030', result_revision: 4,
    media_id: '00000000-0000-4000-8000-000000000040', media_checksum: 'sha256:media-one',
    destination_provider: 'test_publisher', destination_account_id: connectionId, destination: 'channel-1',
    destination_config: {}, media_type: 'video', visibility: 'public', scheduled_for: null,
    title: 'Marquee Film', caption: 'A keeper loses the light.', state: 'ready', state_label: 'Ready to publish',
    authorization_id: 'auth-1', operation_id: 'op-1', idempotency_key: 'idem-1', submission_attempts: 0,
    last_attempt_at: null, submitted_at: null, remote_resource_type: '', remote_resource_id: null,
    remote_url: null, remote_state: '', last_checked_at: null, published_at: null, failed_at: null,
    failure_category: null, failure_code: null, failure_message: null, cancelled_at: null, removed_at: null,
    created_at: '2026-10-08T10:00:00Z', updated_at: '2026-10-08T10:00:00Z', ...overrides,
  };
}

function preview(overrides: Partial<PublicationPreview> = {}): PublicationPreview {
  return {
    publication_id: publicationId, state: 'ready',
      production: { id: productionId, title: 'Marquee Film', pinned_revision: 3, current_revision: 3 },
      result: { id: 'result-1', state: 'final', approval: 'approved', pinned_revision: 4, current_revision: 4 },
      media: { id: 'media-1', media_type: 'video', mime_type: 'video/mp4', bytes: 2048,
        pinned_checksum: 'sha256:media-one', current_checksum: 'sha256:media-one', upload_state: 'uploaded',
        thumbnail_media_id: null },
      destination: { provider: 'test_publisher', provider_name: 'Test Publisher', account_id: connectionId,
        account_label: 'Studio channel', target: 'channel-1', visibility: 'public', scheduled_for: null },
      content: { title: 'Marquee Film', caption: 'A keeper loses the light.', settings: {}, fingerprint: 'fp-1' },
      provider_constraints: { max_caption: 5000 }, capability: 'AVAILABLE', missing_scopes: [],
      authorization: { authorization_id: 'auth-1', decision: 'authorize', actor_user_id: 'user-1',
        authorized_at: '2026-10-08T10:00:00Z' },
    retry_safety: 'requires_idempotency_key', can_submit: true, blocked_by: [],
    note: 'Everything this publication needs is present; a creator action may submit it.',
    ...overrides,
  };
}

function status(overrides: Partial<PublicationStatus> = {}): PublicationStatus {
  return {
    publication: overrides.publication ?? publication(),
    preview: overrides.preview ?? preview(),
    authorizations: [{ id: 'auth-1', decision: 'authorize', actor_user_id: 'user-1',
      authorized_at: '2026-10-08T10:00:00Z', production_revision: 3, result_revision: 4, media_id: 'media-1',
      media_checksum: 'sha256:media-one', destination_provider: 'test_publisher', destination: 'channel-1',
      note: 'Approved for the public channel.' }],
    attempts: [], reconciliations: [], retry_safety: 'requires_idempotency_key', adapter,
    ...overrides,
  };
}

function readyExport(overrides: Partial<ProductionExport> = {}): ProductionExport {
  return {
    id: exportId, workspace_id: workspaceId, production_id: productionId, job_id: null, kind: 'full_document',
    requested_format: 'pdf', package_type: 'complete', state: 'ready', production_revision: 3,
    production_version_id: 'version-1', generated_media_id: 'media-9', file_count: 1, total_bytes: 9000,
    content_checksum: 'sha256:artifact', requested_by: 'user-1', created_at: '2026-10-08T10:00:00Z',
    ready_at: '2026-10-08T10:05:00Z', failed_at: null, expired_at: null, failure_code: null,
    failure_message: null, completed_at: '2026-10-08T10:05:00Z', manifest: { files: [] },
    downloadable: true, retry: null, note: 'The artifact exists in the private exports bucket; downloads are authorized per request.',
    schema_version: '1', ...overrides,
  };
}

function billingStatus(overrides: Partial<BillingStatus> = {}): BillingStatus {
  return {
    workspace_id: workspaceId,
    subscription: { state: 'active', plan_key: 'studio', plan_name: 'Studio', cancel_at_period_end: false,
      current_period_end: '2026-11-08T10:00:00Z', provider_state_at: '2026-10-08T10:00:00Z', grants_entitlements: true },
    provider: { name: 'test_billing', configured: true },
    entitlements: [{ key: 'exports.packages', name: 'Packages', kind: 'feature', unit: '', source: 'plan',
      limit_amount: 10, consumed_amount: 2, reserved_amount: 0, remaining: 8, valid_until: null },
      { key: 'generation.credits', name: 'Generation credits', kind: 'quota', unit: 'credit', source: 'plan',
        limit_amount: 100, consumed_amount: 25, reserved_amount: 2.5, remaining: 72.5, valid_until: null }],
    open_checkouts: [], note: 'Commercial facts come from verified provider events.',
    ...overrides,
  };
}

describe('integrations', () => {
  it('shows a CONNECTED account with the verification that supports the word, and a failing one without it', async () => {
    render(<IntegrationsCanvas workspaceId={workspaceId} />);
    await waitFor(() => expect(integrationService.connections).toHaveBeenCalled());
    const connected = within(await screen.findByLabelText('Connected destination accounts'));
    const [confirmedRow, failingRow] = connected.getAllByRole('listitem').map(row => within(row));
    expect(confirmedRow.getByText('Studio channel')).toBeInTheDocument();
    expect(confirmedRow.getByText(
      'The provider confirmed this account; this is the only state that authorizes publishing.'))
      .toBeInTheDocument();
    expect(confirmedRow.getByText(/^Verification: confirmed/)).toBeInTheDocument();
    // The connection that the provider stopped accepting is described as such, never as connected.
    expect(failingRow.getByText('The provider stopped accepting the authorization; a creator must reauthorize.'))
      .toBeInTheDocument();
    expect(failingRow.queryByText(/The provider confirmed this account/)).not.toBeInTheDocument();
    expect(failingRow.getByText(/not confirmed by the provider/)).toBeInTheDocument();
    expect(failingRow.getByText(/Last error: authentication_failed/)).toBeInTheDocument();
    expect(connected.getByText(/Missing scopes TONDE asked for: publish.image/)).toBeInTheDocument();
    expect(screen.getByText(CREDENTIAL_LAW + ' ' + TOKEN_BOUNDARY)).toBeInTheDocument();
    expect(screen.getByText(/vault reference is recorded; TONDE stores no credential/)).toBeInTheDocument();
  });

  it('describes a provider this deployment cannot reach instead of looking available', async () => {
    render(<IntegrationsCanvas workspaceId={workspaceId} />);
    const providers = within(await screen.findByLabelText('Providers available to this deployment'));
    expect(providers.getByText(/No provider call can be made: this deployment is missing provider_credentials/)).toBeInTheDocument();
    expect(providers.getByText('An adapter exists but has never been exercised against the real provider.')).toBeInTheDocument();
  });

  it('verifies, reauthorizes and disconnects through the API, and reports an unavailable flow truthfully', async () => {
    render(<IntegrationsCanvas workspaceId={workspaceId} />);
    await waitFor(() => expect(integrationService.connections).toHaveBeenCalled());
    fireEvent.click(screen.getAllByRole('button', { name: /Verify again/ })[0]);
    await waitFor(() => expect(integrationService.verify).toHaveBeenCalledWith(workspaceId, connectionId));
    expect(await screen.findByText('The provider confirmed this connection.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Disconnect reason'), { target: { value: 'Retiring the channel.' } });
    fireEvent.click(screen.getAllByRole('button', { name: /Disconnect/ })[0]);
    await waitFor(() => expect(integrationService.disconnect).toHaveBeenCalledWith(workspaceId, connectionId,
      { reason: 'Retiring the channel.' }));

    fireEvent.click(screen.getByRole('button', { name: /Start authorization/ }));
    await waitFor(() => expect(integrationService.attemptInitiation).toHaveBeenCalled());
    expect(await screen.findByText('The authorization URL cannot be produced: provider_credentials.')).toBeInTheDocument();
    expect(screen.getByText(/Unavailable here: provider_credentials/)).toBeInTheDocument();
  });

  it('surfaces a refusal as an alert and shows a loading state first', async () => {
    vi.mocked(integrationService.connections).mockRejectedValueOnce(
      new AppError('authorization', 'You do not have permission to direct this Production.'));
    render(<IntegrationsCanvas workspaceId={workspaceId} />);
    expect(screen.getByText(/Reading destination accounts/)).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission to direct this Production.');
  });

  it('asks for a workspace instead of inventing one in local preview', () => {
    render(<IntegrationsCanvas workspaceId={null} />);
    expect(screen.getByText(/Local preview only/)).toBeInTheDocument();
    expect(integrationService.connections).not.toHaveBeenCalled();
  });
});

describe('publishing', () => {
  it('shows the pinned version, the blockers and that authorization is its own act', async () => {
    render(<PublishingCanvas workspaceId={workspaceId} productionId={productionId} />);
    await waitFor(() => expect(publishingService.status).toHaveBeenCalledWith(workspaceId, publicationId));
    const pinned = within(await screen.findByLabelText('Pinned content and destination'));
    expect(pinned.getByText('Production revision (pinned)')).toBeInTheDocument();
    expect(pinned.getByText('sha256:media-one')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Publishing authorization'))
      .getByText(/A creative approval of the Result is a different decision/)).toBeInTheDocument();
    expect(screen.getByText(AUTHORITY_LAW)).toBeInTheDocument();
    expect(within(screen.getByLabelText('What would go out')).getByText('Nothing blocks a submission right now.')).toBeInTheDocument();
  });

  it('records an authorization and a withdrawal as creator decisions, never as approval', async () => {
    render(<PublishingCanvas workspaceId={workspaceId} productionId={productionId} />);
    await waitFor(() => expect(publishingService.status).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Decision note'), { target: { value: 'Approved for the public channel.' } });
    fireEvent.click(screen.getByRole('button', { name: /Authorize publishing this exact version/ }));
    await waitFor(() => expect(publishingService.authorize).toHaveBeenCalledWith(workspaceId, publicationId,
      { decision: 'authorize', note: 'Approved for the public channel.' }));
    expect(await screen.findByText(/no service or AI may record one/)).toBeInTheDocument();
    expect(publishingService.update).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Withdraw authorization/ }));
    await waitFor(() => expect(publishingService.authorize).toHaveBeenCalledWith(workspaceId, publicationId,
      { decision: 'withdraw', note: 'Approved for the public channel.' }));
  });

  it('lists the blockers that stop a submission', async () => {
    vi.mocked(publishingService.status).mockResolvedValue(status({ preview: preview({
      can_submit: false, blocked_by: ['MISSING_SCOPE', 'AUTHORIZATION_STALE'],
      missing_scopes: ['publish.video'],
      note: 'This publication cannot be submitted yet; blocked_by lists every reason.' }) }));
    render(<PublishingCanvas workspaceId={workspaceId} productionId={productionId} />);
    const blockers = within(await screen.findByLabelText('Reasons this cannot be submitted'));
    expect(blockers.getByText('MISSING_SCOPE')).toBeInTheDocument();
    expect(blockers.getByText('AUTHORIZATION_STALE')).toBeInTheDocument();
    expect(screen.getByText(/missing scopes: publish.video/)).toBeInTheDocument();
  });

  it('submits through the API and reports the destination result, not a local claim', async () => {
    render(<PublishingCanvas workspaceId={workspaceId} productionId={productionId} />);
    await waitFor(() => expect(publishingService.status).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Submit to the destination/ }));
    await waitFor(() => expect(publishingService.submit).toHaveBeenCalledWith(workspaceId, publicationId));
    expect(await screen.findByText(/The destination confirmed this exact publication./)).toBeInTheDocument();
  });

  it('shows a published publication with its remote resource and an unknown one as unknown', async () => {
    vi.mocked(publishingService.status).mockResolvedValue(status({ publication: publication({ state: 'published',
      published_at: '2026-10-08T10:06:00Z', remote_resource_id: 'remote-1',
      remote_url: 'https://destination.invalid/p/remote-1' }) }));
    const { unmount } = render(<PublishingCanvas workspaceId={workspaceId} productionId={productionId} />);
    expect(await screen.findByText(/Published: the destination confirmed this publication/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open at the destination/ })).toHaveAttribute(
      'href', 'https://destination.invalid/p/remote-1');
    unmount();

    vi.mocked(publishingService.status).mockResolvedValue(status({ publication: publication({
      state: 'unknown_remote_state', last_checked_at: '2026-10-08T10:07:00Z' }) }));
    render(<PublishingCanvas workspaceId={workspaceId} productionId={productionId} />);
    // The law appears twice on purpose: as the standing rule of the reconciliation region and as the alert
    // that replaces the published claim for this exact publication. Both must be the same law.
    const law = await screen.findAllByText(UNKNOWN_LAW);
    expect(law.length).toBeGreaterThan(1);
    expect(within(screen.getByRole('alert')).getByText(UNKNOWN_LAW)).toBeInTheDocument();
    expect(within(screen.getByLabelText('Reconciliation')).getByText(UNKNOWN_LAW)).toBeInTheDocument();
    expect(screen.queryByText(/Published: the destination confirmed/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Record what the destination shows/ })).toBeInTheDocument();
  });

  it('shows a normalized failure cause and refuses to submit a publication that is not ready', async () => {
    vi.mocked(publishingService.status).mockResolvedValue(status({ publication: publication({ state: 'failed',
      failed_at: '2026-10-08T10:06:00Z', failure_category: 'policy_violation', failure_code: 'community_guidelines',
      failure_message: 'The destination refused the content.' }) }));
    render(<PublishingCanvas workspaceId={workspaceId} productionId={productionId} />);
    const failure = within(await screen.findByRole('alert', { name: '' }, { timeout: 2000 }));
    expect(failure.getByText(/Blocked by the destination's policy/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Submit to the destination/ })).toBeDisabled();
  });

  it('records a reconciliation as what the creator observed', async () => {
    render(<PublishingCanvas workspaceId={workspaceId} productionId={productionId} />);
    await waitFor(() => expect(publishingService.status).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Observed destination state'), { target: { value: 'published' } });
    fireEvent.change(screen.getByLabelText('Observed remote resource'), { target: { value: 'remote-9' } });
    fireEvent.click(screen.getByRole('button', { name: /Record what the destination shows/ }));
    await waitFor(() => expect(publishingService.reconcile).toHaveBeenCalledWith(workspaceId, publicationId,
      { observed: 'published', note: '', remote_resource_id: 'remote-9' }));
    expect(await screen.findByText('The destination really holds this publication.')).toBeInTheDocument();
  });

  it('hides the creator actions from a reader who cannot manage the Production', async () => {
    render(<PublishingCanvas workspaceId={workspaceId} productionId={productionId} canManage={false} />);
    await waitFor(() => expect(publishingService.status).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Authorize publishing/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Submit to the destination/ })).not.toBeInTheDocument();
  });
});

describe('exports', () => {
  it('presents the two products as two distinct actions', async () => {
    render(<ExportsCanvas workspaceId={workspaceId} productionId={productionId} />);
    await waitFor(() => expect(exportService.list).toHaveBeenCalled());
    const document = within(await screen.findByLabelText('Download Full Document'));
    expect(document.getByText('Rendered from the exact Production version this export pins.')).toBeInTheDocument();
    const packageProduct = within(screen.getByLabelText('Export Production Package'));
    expect(packageProduct.getByText('A ZIP described file by file by its manifest.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download Full Document/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export Production Package/ })).toBeInTheDocument();
  });

  it('requests exactly the product the creator chose', async () => {
    render(<ExportsCanvas workspaceId={workspaceId} productionId={productionId} />);
    await waitFor(() => expect(exportService.list).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Full document format'), { target: { value: 'docx' } });
    fireEvent.click(screen.getByRole('button', { name: /Download Full Document/ }));
    await waitFor(() => expect(exportService.request).toHaveBeenCalledWith(workspaceId,
      { production_id: productionId, kind: 'full_document', format: 'docx', package_type: 'complete' }));

    fireEvent.change(screen.getByLabelText('Package type'), { target: { value: 'shot_list' } });
    fireEvent.change(screen.getByLabelText('Package format'), { target: { value: 'json' } });
    fireEvent.click(screen.getByRole('button', { name: /Export Production Package/ }));
    await waitFor(() => expect(exportService.request).toHaveBeenCalledWith(workspaceId,
      { production_id: productionId, kind: 'production_package', format: 'json', package_type: 'shot_list' }));
  });

  it('shows the pinned version, format, state, times and checksum of each export', async () => {
    render(<ExportsCanvas workspaceId={workspaceId} productionId={productionId} />);
    const list = within(await screen.findByLabelText('Exports of this Production'));
    expect(list.getByText(/revision 3/)).toBeInTheDocument();
    expect(list.getByText('Ready to download')).toBeInTheDocument();
    expect(list.getByText(/1 file\(s\), 9000 bytes/)).toBeInTheDocument();
    expect(list.getByText('sha256:artifact')).toBeInTheDocument();
  });

  it('never shows a download link it did not receive', async () => {
    render(<ExportsCanvas workspaceId={workspaceId} productionId={productionId} />);
    await waitFor(() => expect(exportService.list).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: /^Download$/ }));
    await waitFor(() => expect(exportService.download).toHaveBeenCalledWith(workspaceId, exportId));
    expect(await screen.findByText(/no signed URL could be produced in this environment/)).toBeInTheDocument();
    expect(screen.queryByText(/A short-lived download link was issued/)).not.toBeInTheDocument();
  });

  it('reports a failure with its cause and stops offering a download for an expired export', async () => {
    vi.mocked(exportService.list).mockResolvedValue({ items: [
      readyExport({ state: 'failed', failed_at: '2026-10-08T10:05:00Z', downloadable: false,
        failure_code: 'version_unavailable',
        failure_message: 'The Production version this export pins is no longer available, so the export was not built.',
        note: 'The build recorded a failure and its cause.' }),
      readyExport({ id: '00000000-0000-4000-8000-0000000000e2', state: 'expired', downloadable: false,
        expired_at: '2026-10-08T17:00:00Z', note: 'This export expired and no longer authorizes downloads.' }),
    ], count: 2, vocabulary: exportVocabulary });
    render(<ExportsCanvas workspaceId={workspaceId} productionId={productionId} />);
    const failure = within(await screen.findByRole('alert'));
    expect(failure.getByText(/version_unavailable/)).toBeInTheDocument();
    expect(failure.getByText(/no longer available, so the export was not built/)).toBeInTheDocument();
    const downloads = screen.getAllByRole('button', { name: /^Download$/ });
    expect(downloads[0]).toBeDisabled();
    expect(downloads[1]).toBeDisabled();
  });

  it('surfaces a refused request as an alert', async () => {
    vi.mocked(exportService.request).mockRejectedValueOnce(new AppError('authorization',
      'Exporting a production package is not included in the current plan.'));
    render(<ExportsCanvas workspaceId={workspaceId} productionId={productionId} />);
    await waitFor(() => expect(exportService.list).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Export Production Package/ }));
    expect(await screen.findByRole('alert'))
      .toHaveTextContent('Exporting a production package is not included in the current plan.');
  });
});

describe('billing, entitlements, usage and cost', () => {
  it('reports the subscription state and every entitlement with its remaining balance', async () => {
    render(<BillingCanvas workspaceId={workspaceId} />);
    await waitFor(() => expect(billingService.status).toHaveBeenCalled());
    const subscription = within(await screen.findByLabelText('Subscription'));
    expect(subscription.getByText('Active')).toBeInTheDocument();
    expect(subscription.getByText('Studio')).toBeInTheDocument();
    const entitlements = within(screen.getByLabelText('Entitlements'));
    const credits = within(entitlements.getByText('Generation credits').closest('li') as HTMLElement);
    expect(credits.getByText(/granted by the plan/)).toBeInTheDocument();
    expect(credits.getByText(/72.5 of 100 credit remaining/)).toBeInTheDocument();
    const packages = within(entitlements.getByText('Packages').closest('li') as HTMLElement);
    expect(packages.getByText(/8 of 10 remaining/)).toBeInTheDocument();
  });

  it('keeps actual, estimated, charged and credits apart instead of summing them', async () => {
    render(<BillingCanvas workspaceId={workspaceId} />);
    const cost = within(await screen.findByLabelText('Cost'));
    expect(cost.getByText('actual provider cost')).toBeInTheDocument();
    expect(cost.getByText('1.25')).toBeInTheDocument();
    expect(cost.getByText('0.25')).toBeInTheDocument();
    expect(cost.getByText('0.4')).toBeInTheDocument();
    expect(cost.getByText('27.5')).toBeInTheDocument();
    expect(cost.getByText('What the provider reported it cost. Never presented as a charge.')).toBeInTheDocument();
    expect(cost.getByText(/Rows by cost basis: 1 actual, 1 estimated, 1 with no cost reported/)).toBeInTheDocument();
    expect(cost.getByText(/not a revenue figure/)).toBeInTheDocument();
  });

  it('explains that an undeclared capability is not gated rather than showing an empty limit', async () => {
    vi.mocked(billingService.status).mockResolvedValue(billingStatus({ entitlements: [] }));
    render(<BillingCanvas workspaceId={workspaceId} />);
    expect(await screen.findByText(/it is not gated/)).toBeInTheDocument();
  });

  it('reports a checkout honestly when the deployment has no payment provider', async () => {
    // A deployment with no provider configured says so in its own status, not only in the refusal.
    vi.mocked(billingService.status).mockResolvedValue(
      billingStatus({ provider: { name: 'test_billing', configured: false } }));
    render(<BillingCanvas workspaceId={workspaceId} />);
    await waitFor(() => expect(billingService.status).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Plan key'), { target: { value: 'studio' } });
    fireEvent.click(screen.getByRole('button', { name: /Start checkout/ }));
    await waitFor(() => expect(billingService.checkout).toHaveBeenCalledWith(workspaceId, { plan_key: 'studio' }));
    expect(await screen.findByText(/No provider session was created because this deployment has not configured/)).toBeInTheDocument();
    expect(screen.queryByText(/A provider session was opened/)).not.toBeInTheDocument();
    expect(screen.getByText(/No payment provider is configured in this deployment/)).toBeInTheDocument();
  });

  it('tells a non-administrator that billing is an administrator view rather than showing an empty plan', async () => {
    vi.mocked(billingService.status).mockRejectedValueOnce(
      new AppError('authorization', 'Only a workspace owner or administrator can manage billing.'));
    render(<BillingCanvas workspaceId={workspaceId} />);
    expect(await screen.findByText(/Billing is an administrator view/)).toBeInTheDocument();
    expect(screen.queryByText('No plan recorded')).not.toBeInTheDocument();
  });

  it('surfaces an unavailable billing service as an alert while still loading', async () => {
    vi.mocked(billingService.costs).mockRejectedValueOnce(
      new AppError('unavailable', 'The TONDE service is unavailable.'));
    render(<BillingCanvas workspaceId={workspaceId} />);
    expect(screen.getByText(/Reading subscription, entitlements and usage/)).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('The TONDE service is unavailable.');
  });

  it('asks for a workspace instead of inventing one in local preview', () => {
    render(<BillingCanvas workspaceId={null} />);
    expect(screen.getByText(/Local preview only/)).toBeInTheDocument();
    expect(billingService.status).not.toHaveBeenCalled();
  });
});
