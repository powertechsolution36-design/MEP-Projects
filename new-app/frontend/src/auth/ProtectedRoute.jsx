import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

/**
 * Redirects unauthenticated users to /login (preserving the attempted
 * destination so login can send them back), and shows nothing while the
 * initial session-restore check ('checking') is still in flight, so an
 * authenticated user reloading the page never flashes the login screen.
 */
export default function ProtectedRoute({ children }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'checking') {
    return <div className="full-page-loading">Loading…</div>;
  }
  if (status !== 'authenticated') {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return children;
}
