import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { LoadingState, ErrorState } from './StateComponents';
export function ProtectedRoute() {
  const auth = useAuth();
  const location = useLocation();
  if (auth.loading) return <LoadingState />;
  if (auth.localPreview) return <Outlet />;
  if (!auth.configured) return <Navigate to="/login" replace />;
  if (!auth.session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (auth.error || !auth.workspaceId) return <ErrorState title="Workspace connection needs attention" message={auth.error ?? 'Your personal workspace is not ready.'} retry={auth.retry} />;
  return <Outlet />;
}
