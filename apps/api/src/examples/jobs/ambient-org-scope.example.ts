// =============================================================================
// Reference example: an ambient organization scope for enqueued jobs
// (issue #734)
// =============================================================================
//
// `JobsService.enqueue` stores `orgId` from its input; when the caller omits
// it, the queue asks `JOBS_ORG_SCOPE` (an optional port) for the organization
// of the current unit of work. The reference app binds none yet: core exposes
// no request-scoped organization context, so an omitted `orgId` is a system
// job. This is the shape a binding takes once an app tracks one, here over
// `AsyncLocalStorage`:
//
//   // in a host module:  { provide: JOBS_ORG_SCOPE, useValue: ambientOrgScope }
//   // per request:       runWithOrg(principal.activeOrgId, () => next())
//
// An explicit `orgId: null` (housekeeping) is never replaced by it.
// =============================================================================

import { AsyncLocalStorage } from 'node:async_hooks';

import type { JobsOrgScope } from '@marinoscar/platform-api/jobs';

const store = new AsyncLocalStorage<{ orgId: string | null }>();

/** Runs `fn` with `orgId` as the ambient organization of anything it enqueues. */
export function runWithOrg<T>(orgId: string | null, fn: () => T): T {
  return store.run({ orgId }, fn);
}

/** The `JobsOrgScope` an app binds to `JOBS_ORG_SCOPE`. */
export const ambientOrgScope: JobsOrgScope = {
  currentOrgId: () => store.getStore()?.orgId ?? null,
};
