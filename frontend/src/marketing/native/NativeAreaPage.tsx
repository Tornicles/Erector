import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { resolveLegacyNav, type AreaKey, type EmbedSpec } from '../content/site';
import { mountLegacy } from './legacyRuntime';
import { useMarketingMeta } from '../seo';
import '../styles/legacy-areas.css';

type RunnerModule = { STATIC_HTML: string; SCRIPT: string };
const loadRunner = (area: AreaKey): Promise<RunnerModule> => {
  switch (area) {
    case 'area1':
      return import('./runners/area1');
    case 'area2':
      return import('./runners/area2');
    case 'area3':
      return import('./runners/area3');
    case 'area4':
      return import('./runners/area4');
  }
};

/**
 * Renders a ported original-design area natively (no iframe). The area's own
 * script runs inside the scoped legacy runtime: same markup, styles and
 * interactions as the preserved originals, with navigation bridged to the SPA
 * router and prototype-auth calls routed to real authentication.
 */
export function NativeAreaPage({ spec }: { spec: EmbedSpec }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [notice, setNotice] = useState<string | null>(null);
  useMarketingMeta(spec);

  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    const timer = window.setTimeout(() => setNotice(null), 0);
    void loadRunner(spec.area).then((mod) => {
      if (cancelled || !rootRef.current) return;
      const handle = mountLegacy({
        root: rootRef.current,
        staticHtml: mod.STATIC_HTML,
        script: mod.SCRIPT,
        anchor: spec.anchor,
        fileKey: spec.area,
        api: {
          onNavigate: (intent) => {
            const path = resolveLegacyNav(spec.area, intent);
            if (path) navigate(path);
          },
          onNotice: (message) => {
            setNotice(message);
            window.setTimeout(() => {
              setNotice((current) => (current === message ? null : current));
            }, 2400);
          },
        },
      });
      dispose = () => handle.dispose();
      window.scrollTo(0, 0);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      dispose?.();
    };
  }, [spec.area, spec.anchor, navigate]);

  return (
    <div className={`tnat-${spec.area}`}>
      <div ref={rootRef} />
      {notice && (
        <div role="status" aria-live="polite" className="site-notice">
          {notice}
        </div>
      )}
    </div>
  );
}
