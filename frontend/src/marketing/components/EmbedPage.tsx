import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { legacyPathToSpa, type EmbedSpec } from '../content/site';
import { useMarketingMeta } from '../seo';

interface EmbedMessage {
  tonde?: string;
  height?: number;
  path?: string;
  message?: string;
}

/**
 * Renders an original-design section via the preserved working copy in
 * `public/marketing/legacy/` (originals in `public/marketing/originals/`
 * stay immutable). Handles the legacy postMessage bridge: auto-height,
 * in-site navigation (remapped to SPA routes), and prototype-action notices.
 */
export function EmbedPage({ spec }: { spec: EmbedSpec }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const navigate = useNavigate();
  const [height, setHeight] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useMarketingMeta(spec);

  useEffect(() => {
    setHeight(null);
    setNotice(null);
    frameRef.current?.scrollIntoView({ block: 'start' });
  }, [spec.path, spec.anchor]);

  useEffect(() => {
    function onMessage(event: MessageEvent<EmbedMessage>) {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || typeof data !== 'object' || !data.tonde) return;
      if (data.tonde === 'height' && Number.isFinite(data.height)) {
        setHeight(Math.max(400, Math.min((data.height ?? 980) + 5, 35000)));
      }
      if (data.tonde === 'navigate' && typeof data.path === 'string') {
        const target = legacyPathToSpa(data.path);
        if (target.startsWith('/') && !target.startsWith('//')) navigate(target);
      }
      if (data.tonde === 'notice' && typeof data.message === 'string') {
        setNotice(data.message);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [navigate]);

  return (
    <div className="embedded-page">
      <iframe
        ref={frameRef}
        id="tonde-content"
        title={spec.title.replace('TONDE | ', '')}
        src={`/marketing/legacy/${spec.file}#${spec.anchor}`}
        loading="eager"
        style={height ? { height: `${height}px` } : undefined}
      />
      <div
        id="site-notice"
        role="status"
        aria-live="polite"
        className="site-notice"
        hidden={!notice}
      >
        {notice}
      </div>
    </div>
  );
}
