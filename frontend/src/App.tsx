import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppLayout } from './components/AppLayout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthPage } from './pages/AuthPage';
import { FoundationPage, HomePage, ProjectsPage } from './pages/FoundationPages';
import { StudioPage } from './pages/StudioPage';
import { OnSetPage } from './pages/OnSetPage';
import { DiscoverPage, JobsPage, ProductionIntelligencePage, ProductionKnowledgePage } from './pages/Prompt11Pages';
import { ErrorState, LoadingState } from './components/StateComponents';
function AuthCallback() {
  const { loading, session, error, retry } = useAuth();
  if (loading) return <LoadingState label="Completing secure sign-in…" />;
  if (error) return <ErrorState message={error} retry={retry} />;
  return <Navigate to={session ? '/home' : '/login'} replace />;
}
export const appRoutes = [
  { path: '/login', element: <AuthPage /> },
  { path: '/auth/callback', element: <AuthCallback /> },
  { path: '/auth/reset', element: <AuthPage reset /> },
  { element: <ProtectedRoute />, children: [{ element: <AppLayout />, children: [
    { path: '/', element: <Navigate to="/home" replace /> },
    { path: '/home', element: <HomePage /> },
    { path: '/studio', element: <ProjectsPage studio /> },
    { path: '/studio/:productionId', element: <StudioPage /> },
    { path: '/on-set/:productionId', element: <OnSetPage /> },
    { path: '/projects', element: <ProjectsPage /> },
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
