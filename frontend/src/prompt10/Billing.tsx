import { useCallback, useEffect, useState } from 'react';
import { CreditCard, ExternalLink, Gauge } from 'lucide-react';
import { safeError } from '../services/errors';
import {
  billingService,
  type BillingStatus, type BillingVocabulary, type CostSummary, type UsageSummary,
} from '../services/billing';
import { LoadingState } from '../components/StateComponents';

/**
 * Subscription, entitlements, usage and cost.
 *
 * Two things this screen refuses to do:
 *
 * * it never invents a price, a plan or a limit. A plan is shown because the server named one; a limit is
 *   shown because the entitlement carries it; a cost figure is shown because a usage row recorded it;
 * * it never merges the four cost kinds. Actual provider cost, estimated provider cost, what the creator
 *   was charged and credits consumed are four separate numbers with four separate meanings.
 *
 * Entitlement messages come from the server's own reason (including "not a commercial gate"), because the
 * authoritative check runs server-side before any paid operation — this screen is the explanation, not the
 * enforcement.
 */

const COST_KINDS = ['actual_provider_cost', 'estimated_provider_cost', 'charged_to_creator', 'credits_consumed'] as const;

function when(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function money(value: number): string {
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

export function BillingCanvas({ workspaceId }: { workspaceId: string | null }) {
  const [vocabulary, setVocabulary] = useState<BillingVocabulary | null>(null);
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [costs, setCosts] = useState<CostSummary | null>(null);
  const [planKey, setPlanKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adminOnly, setAdminOnly] = useState(false);
  const [sessionUrl, setSessionUrl] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const refresh = useCallback(() => setReloadKey(current => current + 1), []);

  useEffect(() => {
    if (!workspaceId) { setLoading(false); return; }
    let active = true;
    setLoading(true); setError(null); setAdminOnly(false);
    Promise.all([billingService.vocabulary(workspaceId), billingService.status(workspaceId),
      billingService.usageSummary(workspaceId), billingService.costs(workspaceId)])
      .then(([loadedVocabulary, loadedStatus, loadedUsage, loadedCosts]) => {
        if (!active) return;
        setVocabulary(loadedVocabulary); setStatus(loadedStatus); setUsage(loadedUsage); setCosts(loadedCosts);
      })
      .catch(failure => {
        if (!active) return;
        const message = safeError(failure).message;
        // Billing is an administrator view; a member who is not an administrator is told that, rather
        // than being shown an empty screen that looks like "no subscription".
        if (message.toLowerCase().includes('owner or administrator')) { setAdminOnly(true); setStatus(null); }
        else setError(message);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceId, reloadKey]);

  async function run(key: string, work: () => Promise<string>) {
    setBusy(key); setError(null); setNotice(null);
    try { setNotice(await work()); refresh(); } catch (failure) { setError(safeError(failure).message); }
    finally { setBusy(null); }
  }

  if (!workspaceId) {
    return <p className="capability-note" role="status">Local preview only — connect a Supabase workspace to
      read billing, entitlements and usage.</p>;
  }
  if (loading) return <LoadingState label="Reading subscription, entitlements and usage…" />;
  if (adminOnly) {
    return <p className="subtle" role="status">Billing is an administrator view. A workspace owner or
      administrator manages the subscription; the entitlement answer for a feature is still available to you
      wherever that feature is used.</p>;
  }

  return (
    <section className="p10-billing" aria-label="Subscription, entitlements, usage and cost">
      {error && <p className="error-text" role="alert">{error}</p>}
      {notice && <p className="subtle" role="status">{notice}</p>}
      {vocabulary && <p className="subtle">{vocabulary.authority_law}</p>}

      <div className="p10-row" role="region" aria-label="Subscription">
        <h3><CreditCard size={16} aria-hidden /> Subscription</h3>
        <dl className="p10-facts">
          <div><dt>State</dt><dd>{vocabulary?.subscription_states[status?.subscription?.state ?? 'none']
            ?? status?.subscription?.state ?? 'No subscription'}</dd></div>
          <div><dt>Plan</dt><dd>{status?.subscription?.plan_name ?? status?.subscription?.plan_key ?? 'No plan recorded'}</dd></div>
          <div><dt>Current period ends</dt><dd>{when(status?.subscription?.current_period_end)}</dd></div>
          <div><dt>Grants entitlements</dt><dd>{status?.subscription?.grants_entitlements ? 'Yes' : 'No'}</dd></div>
          <div><dt>Provider</dt><dd>{status?.provider.name || 'none configured'}</dd></div>
        </dl>
        {!status?.provider.configured && (
          <p className="p10-warn">No payment provider is configured in this deployment, so no checkout session
            or billing portal can be created here. TONDE will not invent one.</p>
        )}
        <div className="p10-actions">
          <label className="p10-field">
            <span>Plan to check out</span>
            <input aria-label="Plan key" value={planKey} maxLength={80}
              onChange={event => setPlanKey(event.target.value)} placeholder="plan key" />
          </label>
          <button type="button" disabled={busy !== null || !planKey.trim()}
            onClick={() => void run('checkout', async () => {
              const result = await billingService.checkout(workspaceId, { plan_key: planKey });
              setSessionUrl(result.checkout_url);
              return result.checkout_url
                ? `A checkout session was opened with ${result.provider}. ${result.authority}`
                : result.note;
            })}>
            Start checkout
          </button>
          <button type="button" disabled={busy !== null}
            onClick={() => void run('portal', async () => {
              const result = await billingService.portal(workspaceId);
              setSessionUrl(result.portal_url);
              return result.portal_url ? result.note : result.note;
            })}>
            Open billing portal
          </button>
        </div>
        {sessionUrl && (
          <p className="subtle" role="status">A provider session was opened.
            {' '}<a href={sessionUrl} target="_blank" rel="noreferrer">Continue at the provider
              <ExternalLink size={13} aria-hidden /></a></p>
        )}
        {status?.open_checkouts?.length ? (
          <p className="subtle">Open checkout intents: {status.open_checkouts.map(intent =>
            `${intent.plan_key} (${intent.state})`).join(', ')}</p>
        ) : null}
      </div>

      <div className="p10-row" role="region" aria-label="Entitlements">
        <h3>Entitlements</h3>
        {status?.entitlements?.length
          ? <ul className="p10-list">
            {status.entitlements.map(entitlement => (
              <li key={entitlement.key}>
                <strong>{entitlement.name || entitlement.key}</strong> · {entitlement.kind}
                {' · '}{entitlement.source === 'plan' ? 'granted by the plan' : 'administrative grant'}
                {entitlement.limit_amount !== null
                  ? ` · ${money(Math.max(entitlement.remaining ?? 0, 0))} of ${money(entitlement.limit_amount)} ${entitlement.unit} remaining`
                  : ' · no limit recorded'}
                {entitlement.valid_until ? ` · valid until ${when(entitlement.valid_until)}` : ''}
              </li>
            ))}
          </ul>
          : <p className="subtle">This workspace holds no entitlement rows. A capability TONDE declares no
            entitlement for is simply not sold here — it is not gated.</p>}
      </div>

      <div className="p10-row" role="region" aria-label="Cost">
        <h3><Gauge size={16} aria-hidden /> Cost</h3>
        <ul className="p10-costs">
          {COST_KINDS.map(kind => (
            <li key={kind} className="p10-cost">
              <span className="p10-cost-label">{kind.replaceAll('_', ' ')}</span>
              <strong>{costs ? money(costs[kind]) : '—'}</strong>
              <small>{vocabulary?.cost_kinds[kind] ?? ''}</small>
            </li>
          ))}
        </ul>
        {costs && (
          <p className="subtle">Rows by cost basis: {costs.rows.actual} actual, {costs.rows.estimated} estimated,
            {' '}{costs.rows.unknown} with no cost reported. {costs.note}</p>
        )}
      </div>

      <div className="p10-row" role="region" aria-label="Usage">
        <h3>Usage</h3>
        {usage?.metrics.length
          ? <ul className="p10-list">
            {usage.metrics.map(metric => (
              <li key={metric.metric}>
                <strong>{metric.metric}</strong> · {money(metric.quantity)} {metric.unit} over {metric.events} event(s)
                {' · '}actual {money(metric.actual_provider_cost)} · estimated {money(metric.estimated_provider_cost)}
                {' · '}charged {money(metric.charges)} · credits {money(metric.credits)}
              </li>
            ))}
          </ul>
          : <p className="subtle">No usage has been recorded for this workspace.</p>}
        <p className="subtle">{usage?.cost_separation}</p>
      </div>
    </section>
  );
}
