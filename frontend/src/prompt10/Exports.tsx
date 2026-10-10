import { useCallback, useEffect, useState } from 'react';
import { Download, FileText, Package } from 'lucide-react';
import { safeError } from '../services/errors';
import {
  EXPORT_PACKAGE_TYPES, exportService,
  type ExportFormat, type ExportVocabulary, type PackageType, type ProductionExport,
} from '../services/exports';
import { LoadingState } from '../components/StateComponents';

/**
 * Two products on one screen, kept visibly apart:
 *
 * * **DOWNLOAD FULL DOCUMENT** — PDF or DOCX;
 * * **EXPORT PRODUCTION PACKAGE** — ZIP, or its structured-data JSON, narrowed by package type.
 *
 * The list shows the pinned Production version, the format, the state, when it was requested, when it
 * became ready, when it expires and the failure cause when there is one — all read from the database. The
 * screen never shows a download link it did not receive: an authorization that produces no signed URL is
 * reported as exactly that, and an expired export stops offering a download.
 */

const TONE: Record<string, string> = {
  requested: 'muted', building: 'warn', ready: 'ok', failed: 'bad', expired: 'muted',
};

function when(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export function ExportsCanvas({ workspaceId, productionId, canManage = true }: {
  workspaceId: string; productionId: string; canManage?: boolean;
}) {
  const [vocabulary, setVocabulary] = useState<ExportVocabulary | null>(null);
  const [exports, setExports] = useState<ProductionExport[]>([]);
  const [documentFormat, setDocumentFormat] = useState<'pdf' | 'docx'>('pdf');
  const [packageFormat, setPackageFormat] = useState<'zip' | 'json'>('zip');
  const [packageType, setPackageType] = useState<PackageType>('complete');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [links, setLinks] = useState<Record<string, string | null>>({});
  const [reloadKey, setReloadKey] = useState(0);

  const refresh = useCallback(() => setReloadKey(current => current + 1), []);

  useEffect(() => {
    if (!workspaceId) { setLoading(false); return; }
    let active = true;
    setLoading(true); setError(null);
    Promise.all([exportService.vocabulary(workspaceId), exportService.list(workspaceId, { production_id: productionId })])
      .then(([loadedVocabulary, loaded]) => {
        if (!active) return;
        setVocabulary(loadedVocabulary); setExports(loaded.items);
      })
      .catch(failure => { if (active) setError(safeError(failure).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceId, productionId, reloadKey]);

  async function run(key: string, work: () => Promise<string>) {
    setBusy(key); setError(null); setNotice(null);
    try { setNotice(await work()); refresh(); } catch (failure) { setError(safeError(failure).message); }
    finally { setBusy(null); }
  }

  async function request(kind: 'full_document' | 'production_package', format: ExportFormat) {
    await run(`request-${kind}-${format}`, async () => {
      const result = await exportService.request(workspaceId!, {
        production_id: productionId, kind, format, package_type: kind === 'production_package' ? packageType : 'complete',
      });
      const label = kind === 'full_document' ? 'Download Full Document' : 'Export Production Package';
      return `${label} requested for Production revision ${result.production_revision}. No file exists yet; `
        + `build it when you are ready to produce the artifact.`;
    });
  }

  if (!workspaceId) {
    return <p className="capability-note" role="status">Local preview only — connect a Supabase workspace to
      export this Production.</p>;
  }
  if (loading) return <LoadingState label="Reading exports of this Production…" />;

  return (
    <section className="p10-exports" aria-label="Export this Production">
      {error && <p className="error-text" role="alert">{error}</p>}
      {notice && <p className="subtle" role="status">{notice}</p>}
      {vocabulary && <p className="subtle">{vocabulary.boundary}</p>}

      {canManage && (
        <div className="p10-products">
          <div className="p10-product" role="region" aria-label="Download Full Document">
            <h3><FileText size={16} aria-hidden /> {vocabulary?.products.full_document.label ?? 'Download Full Document'}</h3>
            <p className="subtle">{vocabulary?.products.full_document.note}</p>
            <label className="p10-field">
              <span>Format</span>
              <select aria-label="Full document format" value={documentFormat}
                onChange={event => setDocumentFormat(event.target.value as 'pdf' | 'docx')}>
                <option value="pdf">PDF</option>
                <option value="docx">DOCX</option>
              </select>
            </label>
            <button type="button" disabled={busy !== null}
              onClick={() => void request('full_document', documentFormat)}>
              <Download size={14} aria-hidden /> Download Full Document
            </button>
          </div>

          <div className="p10-product" role="region" aria-label="Export Production Package">
            <h3><Package size={16} aria-hidden /> {vocabulary?.products.production_package.label ?? 'Export Production Package'}</h3>
            <p className="subtle">{vocabulary?.products.production_package.note}</p>
            <label className="p10-field">
              <span>Format</span>
              <select aria-label="Package format" value={packageFormat}
                onChange={event => setPackageFormat(event.target.value as 'zip' | 'json')}>
                <option value="zip">ZIP</option>
                <option value="json">Structured data (JSON)</option>
              </select>
            </label>
            <label className="p10-field">
              <span>Package type</span>
              <select aria-label="Package type" value={packageType}
                onChange={event => setPackageType(event.target.value as PackageType)}>
                {EXPORT_PACKAGE_TYPES.map(type => <option key={type} value={type}>{type.replaceAll('_', ' ')}</option>)}
              </select>
            </label>
            <button type="button" disabled={busy !== null}
              onClick={() => void request('production_package', packageFormat)}>
              <Package size={14} aria-hidden /> Export Production Package
            </button>
          </div>
        </div>
      )}

      <div className="p10-row" role="region" aria-label="Exports of this Production">
        <h3>Exports</h3>
        {exports.length === 0
          ? <p className="subtle">No export has been requested for this Production.</p>
          : <ul className="p10-list">
            {exports.map(item => (
              <li key={item.id} className="p10-row">
                <div className="p10-row-head">
                  <strong>{item.kind === 'full_document'
                    ? (vocabulary?.products.full_document.label ?? 'Download Full Document')
                    : (vocabulary?.products.production_package.label ?? 'Export Production Package')}
                    {' · '}{item.requested_format.toUpperCase()}</strong>
                  <span className={`p10-badge p10-${TONE[item.state] ?? 'muted'}`}>
                    {vocabulary?.states[item.state] ?? item.state}
                  </span>
                </div>
                <dl className="p10-facts">
                  <div><dt>Production version</dt><dd>revision {item.production_revision}</dd></div>
                  {item.kind === 'production_package' && <div><dt>Package type</dt><dd>{item.package_type}</dd></div>}
                  <div><dt>Requested</dt><dd>{when(item.created_at)}</dd></div>
                  <div><dt>Completed</dt><dd>{when(item.ready_at ?? item.completed_at)}</dd></div>
                  <div><dt>Expires</dt><dd>{when(item.expired_at)}</dd></div>
                  <div><dt>Contents</dt><dd>{item.file_count ?? '—'} file(s), {item.total_bytes ?? '—'} bytes</dd></div>
                  <div><dt>Checksum</dt><dd>{item.content_checksum ?? '—'}</dd></div>
                </dl>
                {item.state === 'failed' && (
                  <p className="p10-error" role="alert">Failed: {item.failure_code ?? 'cause not recorded'}
                    {item.failure_message ? ` — ${item.failure_message}` : ''}</p>
                )}
                <p className="subtle">{item.note}</p>
                {canManage && (
                  <div className="p10-actions">
                    <button type="button" disabled={busy !== null || !['requested', 'building'].includes(item.state)}
                      onClick={() => void run(`build-${item.id}`, async () => {
                        const built = await exportService.build(workspaceId, item.id);
                        return built.state === 'ready'
                          ? 'The artifact was produced and recorded. Downloads are authorized per request.'
                          : `Build outcome: ${built.state}.`;
                      })}>
                      Build now
                    </button>
                    <button type="button" disabled={busy !== null || item.state !== 'ready'}
                      onClick={() => void run(`download-${item.id}`, async () => {
                        const authorized = await exportService.download(workspaceId, item.id);
                        setLinks(current => ({ ...current, [item.id]: authorized.download_url }));
                        if (!authorized.download_url) return authorized.note
                          ?? 'Download authorized, but no signed link could be produced in this environment.';
                        window.open(authorized.download_url, '_blank', 'noreferrer');
                        return `Download authorized for ${authorized.window_seconds} seconds.`;
                      })}>
                      <Download size={14} aria-hidden /> Download
                    </button>
                    <button type="button" disabled={busy !== null || item.state === 'expired'}
                      onClick={() => void run(`expire-${item.id}`, async () => {
                        const expired = await exportService.expire(workspaceId, item.id);
                        return `Expired: ${expired.state}. It no longer authorizes downloads.`;
                      })}>
                      Expire
                    </button>
                  </div>
                )}
                {links[item.id] && (
                  <p className="subtle" role="status">A short-lived download link was issued for this export.</p>
                )}
              </li>
            ))}
          </ul>}
      </div>
    </section>
  );
}
