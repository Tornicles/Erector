import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppLayout } from './components/AppLayout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthPage } from './pages/AuthPage';
import { marketingRouteObjects } from './marketing/routes';
import { FoundationPage, HomePage, ProjectsPage } from './pages/FoundationPages';
import { InvitePage, TeamPage } from './pages/TeamPage';
import { StudioPage } from './pages/StudioPage';
import { OnSetPage } from './pages/OnSetPage';
import { DiscoverPage, JobsPage, ProductionIntelligencePage, ProductionKnowledgePage } from './pages/Prompt11Pages';
import { ErrorState, LoadingState } from './components/StateComponents';
function AuthCallback() {
  const { loading, session, error, retry } = useAuth();
  if (loading) return <LoadingState label="Completing secure sign-in…" />;
  if (error) return <ErrorState message={error} retry={retry} />;
  if (session) {
    // An invite link opened before sign-in waits here; honour it after auth.
    try {
      const pending = sessionStorage.getItem('tonde:pending-invite');
      if (pending) {
        sessionStorage.removeItem('tonde:pending-invite');
        return <Navigate to={`/invite/${pending}`} replace />;
      }
    } catch {
      /* private browsing: fall through to home */
    }
  }
  return <Navigate to={session ? '/home' : '/login'} replace />;
}
export const appRoutes = [
  { path: '/login', element: <AuthPage /> },
  { path: '/signup', element: <AuthPage initialMode="signup" /> },
  { path: '/forgot-password', element: <AuthPage initialMode="forgot" /> },
  { path: '/auth/callback', element: <AuthCallback /> },
  { path: '/auth/reset', element: <AuthPage reset /> },
  { path: '/invite/:token', element: <InvitePage /> },
  // Public marketing site (tonde.io). Mounted before the protected subtree so
  // `/` serves the marketing home; the authenticated app home stays `/home`.
  ...marketingRouteObjects,
  { element: <ProtectedRoute />, children: [{ element: <AppLayout />, children: [
    { path: '/home', element: <HomePage /> },
    { path: '/studio', element: <ProjectsPage studio /> },
    { path: '/production/:productionId/studio', element: <StudioPage /> },
    { path: '/studio/:productionId', element: <StudioPage /> },
    { path: '/on-set/:productionId', element: <OnSetPage /> },
    { path: '/projects', element: <ProjectsPage /> },
    { path: '/team', element: <TeamPage /> },
    { path: '/discover', element: <DiscoverPage /> },
    { path: '/jobs', element: <JobsPage /> },
    { path: '/knowledge', element: <ProductionKnowledgePage /> },
    { path: '/devices-scenes', element: <ProductionIntelligencePage /> },
    { path: '/studio/:productionId/intelligence', element: <ProductionIntelligencePage /> },
    { path: '/assets', element: <FoundationPage area="assets" /> },
    { path: '/setup', element: <FoundationPage area="setup" /> },
    { path: '/settings', element: <FoundationPage area="settings" /> },
    { path: '/settings/:section', element: <FoundationPage area="settings" /> },
    { path: '/account', element: <FoundationPage area="account" /> },
    { path: '/help', element: <FoundationPage area="help" /> },
    { path: '*', element: <ErrorState title="Page not found" message="This route is not part of TONDE. Use the navigation to return to your workspace." /> },
  ] }] },
];
const router = createBrowserRouter(appRoutes);
export default function App() {
  return <ErrorBoundary><AuthProvider><RouterProvider router={router} /></AuthProvider></ErrorBoundary>;
}
