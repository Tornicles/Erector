import type { RouteObject } from 'react-router-dom';
import { MarketingLayout } from './components/MarketingLayout';
import { NativeAreaPage } from './native/NativeAreaPage';
import { NativePage } from './components/NativePage';
import { MARKETING_ROUTES } from './content/site';

/** Public marketing routes. Mounted before the authenticated app subtree. */
export const marketingRouteObjects: RouteObject[] = MARKETING_ROUTES.map((spec) => ({
  path: spec.path === '/' ? '/' : spec.path.replace(/^\//, ''),
  element: (
    <MarketingLayout>
      {spec.kind === 'embed' ? <NativeAreaPage spec={spec} /> : <NativePage spec={spec} />}
    </MarketingLayout>
  ),
}));
