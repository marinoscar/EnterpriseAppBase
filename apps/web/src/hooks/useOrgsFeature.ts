/**
 * Whether ORGANIZATION management exists in this deployment (#726, PP-6.7):
 * true iff `GET /api/auth/me` reports `tenancyMode: 'multi'`.
 *
 * In single-org mode (every deployment that predates `TENANCY_MODE`, and the
 * default) the spec says "org management hidden": the Organization and
 * Organizations cards, their routes and the AppBar org switcher are absent.
 *
 * Reads the auth context WITHOUT `useAuth()`, which throws outside an
 * `AuthProvider`: like the AI and telemetry flags it answers "off" when there
 * is no provider or no signed-in user, failing closed, and never fetches.
 * This is a visibility switch only; the API enforces every permission.
 */
import { useContext } from 'react';
import { AuthContext } from '../contexts/AuthContext';

export function useOrgsFeature(): boolean {
  const auth = useContext(AuthContext);
  return auth?.user?.tenancyMode === 'multi';
}
