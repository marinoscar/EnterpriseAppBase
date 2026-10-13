import type { ResponseMetaContributorDef } from '@marinoscar/platform-api/host';

// =============================================================================
// EXAMPLE: add a fact to every response's `meta` (PP-14.13)
// =============================================================================
//
// Every JSON body is `{ data, meta: { timestamp } }`. A contributor adds keys to
// `meta`: it runs synchronously on the response path of every request, so it does
// no I/O. `timestamp` stays the platform's; keys are bounded (a short
// alphanumeric name, at most 8 per contributor and 16 in all), credential-looking
// names and values that are not small JSON are dropped, and a contributor that
// throws is skipped for that response. Never a secret, never user data.
//
// Opt in with `registerHostExamples()` (`app-registrations/host.ts`).
// =============================================================================

/** Stamps the API contract revision the app's clients negotiate against. */
export const apiRevisionMeta: ResponseMetaContributorDef = {
  id: 'api-revision',
  contribute: () => ({ apiRevision: 1 }),
};
