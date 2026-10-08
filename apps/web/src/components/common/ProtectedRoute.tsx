/**
 * The signed-in gate of the route tree: the package's `RequireAuth` (#727,
 * PP-6.6) with this app's full-screen spinner while the session probe runs.
 */
import { RequireAuth } from '@marinoscar/platform-web/identity/headless';
import { LoadingSpinner } from './LoadingSpinner';

export function ProtectedRoute() {
  return <RequireAuth loading={<LoadingSpinner fullScreen />} />;
}
