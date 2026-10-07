// =============================================================================
// The deployment's tenancy mode, as the RBAC split reads it (issue #723)
// =============================================================================
//
// PP-6.3 needs the mode in places with no dependency injection: the guards'
// `toRequestUser` picks the "current" membership by it
// (`principal.factory.ts`), and so does `PUT /api/users/:id/roles`
// (`users.service.ts`). The mode itself is `TENANCY_MODE`, parsed once at
// startup by `TenancyService` (PP-6.2, #722), which RECORDS it here from its
// constructor. Until that runs (a unit test that builds no Nest module), the
// mode is the default, `'single'`.
//
// A process-wide fact, read-only after startup like `TenancyService` itself.
// Tests simulate a mode by spying on `currentTenancyMode`
// (`jest.spyOn(tenancyMode, 'currentTenancyMode')`) or by booting the app
// with `TENANCY_MODE` set.
// =============================================================================

import type { TenancyMode } from '@marinoscar/platform-api/core';

let recorded: TenancyMode = 'single';

/**
 * The deployment's tenancy mode: what `TenancyService` parsed at startup, or
 * `'single'` before it has.
 */
export function currentTenancyMode(): TenancyMode {
  return recorded;
}

/**
 * Called by `TenancyService`'s constructor with the parsed `TENANCY_MODE`.
 * Nothing else calls it.
 */
export function recordTenancyMode(mode: TenancyMode): void {
  recorded = mode;
}
