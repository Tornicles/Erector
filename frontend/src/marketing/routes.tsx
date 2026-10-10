import type { RouteObject } from 'react-router-dom';
import { EmbedPage } from './components/EmbedPage';
import { MarketingLayout } from './components/MarketingLayout';
import { NativePage } from './components/NativePage';
import { MARKETING_ROUTES } from './content/site';

/** Public marketing routes. Mounted before the authenticated app subtree. */
export const marketingRouteObjects: RouteObject[] = MARKETING_ROUTES.map((spec) => ({
  path: spec.path === '/' ? '/' : spec.path.replace(/^\//, ''),
  element: (
    <MarketingLayout>
      {spec.kind === 'embed' ? <EmbedPage spec={spec} /> : <NativePage spec={spec} />}
    </MarketingLayout>
  ),
}));
