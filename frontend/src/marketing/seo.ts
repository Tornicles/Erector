import { useEffect } from 'react';

const SITE_ORIGIN = 'https://tonde.io';

function upsertMeta(selector: string, create: () => HTMLElement): HTMLElement {
  const existing = document.head.querySelector(selector);
  if (existing) return existing as HTMLElement;
  const el = create();
  document.head.appendChild(el);
  return el;
}

/** Per-route titles, descriptions, canonical + Open Graph tags. */
export function useMarketingMeta(spec: { title: string; description: string; path: string }) {
  useEffect(() => {
    document.title = spec.title;
    const canonical = `${SITE_ORIGIN}${spec.path === '/' ? '/' : `${spec.path}/`}`;
    const desc = document.head.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    if (desc) desc.setAttribute('content', spec.description);
    const link = upsertMeta('link[data-tmk="canonical"]', () => {
      const el = document.createElement('link');
      el.setAttribute('rel', 'canonical');
      el.setAttribute('data-tmk', 'canonical');
      return el;
    }) as HTMLLinkElement;
    link.setAttribute('href', canonical);
    const ogProps: Array<[string, string]> = [
      ['og:type', 'website'],
      ['og:title', spec.title],
      ['og:description', spec.description],
      ['og:url', canonical],
    ];
    for (const [property, content] of ogProps) {
      const tag = upsertMeta(`meta[data-tmk="${property}"]`, () => {
        const el = document.createElement('meta');
        el.setAttribute('property', property);
        el.setAttribute('data-tmk', property);
        return el;
      }) as HTMLMetaElement;
      tag.setAttribute('content', content);
    }
  }, [spec.title, spec.description, spec.path]);
}
