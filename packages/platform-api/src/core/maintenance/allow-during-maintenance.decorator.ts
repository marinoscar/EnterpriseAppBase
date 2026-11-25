// =============================================================================
// The maintenance-window exemption (issue #257; moved into
// `@marinoscar/platform-api/core` by #727 so packaged controllers can carry it)
// =============================================================================
//
// The app's `MaintenanceGuard` reads the metadata this stamps; a packaged
// controller (the identity slice's sign-in routes) stamps it without importing
// the app. The key string is unchanged, so the app's guard and every existing
// route behave exactly as before.
// =============================================================================

import { SetMetadata } from '@nestjs/common';

/**
 * Reflector key stamped by {@link AllowDuringMaintenance}.
 *
 * @stability stable
 */
export const ALLOW_DURING_MAINTENANCE_KEY = 'allowDuringMaintenance';

/**
 * Exempts a route (or a whole controller) from the maintenance window.
 *
 * WHAT THIS IS NOT: `@Public()`. That decorator answers "does this route need a
 * token?"; this one answers "may this route be served while the application is
 * deliberately out of service?". They are independent: `GET /api/auth/me` needs
 * a token and must still answer during a window, while a public read endpoint
 * must NOT be reachable merely because it is public.
 *
 * Read with `getAllAndOverride([handler, class])`, so a controller-level
 * exemption covers its routes and a handler may not be un-exempted piecemeal.
 * A missing exemption on a sign-in route locks every user out during a window,
 * including the administrator who would end it.
 *
 * @returns a decorator for a handler or a controller class.
 *
 * @example
 * ```ts
 * @AllowDuringMaintenance()
 * @Controller('health')
 * export class HealthController {}
 * ```
 *
 * @stability stable
 */
export const AllowDuringMaintenance = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_DURING_MAINTENANCE_KEY, true);
