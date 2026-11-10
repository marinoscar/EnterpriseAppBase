// =============================================================================
// The response `meta` contributor registry (PP-14.13)
// =============================================================================
//
// Every successful JSON body is wrapped as `{ data, meta: { timestamp } }`
// (`TransformInterceptor`). An app that wants more facts on every response (an
// API revision, the serving region, a correlation id of its own) registers a
// contributor; the interceptor merges what each returns into `meta`.
//
// THE RULES ARE ENFORCED HERE, because `meta` is on EVERY response, including
// public ones:
//
//   * a contributor runs SYNCHRONOUSLY on the response path: no I/O, no await;
//   * `timestamp` is the platform's and cannot be overridden;
//   * keys are bounded (a short alphanumeric name, at most 8 per contributor
//     and 16 in total) and credential-looking names are dropped;
//   * a value must be JSON and, serialised, at most 512 characters; anything
//     else is dropped;
//   * a contributor that throws is skipped for that response (and logged at
//     debug), never turned into a failed request.
//
// An extension must still never put a secret, a user's data or a stack trace in
// `meta`.
// =============================================================================

import { defineRegistry, type Registry } from '../../core/index';

/**
 * The id pattern of a response meta contributor: lower-case, 2 to 48
 * characters, starting with a letter (`api-revision`).
 *
 * @stability experimental
 */
export const RESPONSE_META_CONTRIBUTOR_ID_PATTERN = /^[a-z][a-z0-9-]{1,47}$/;

/**
 * What a contributor receives: the incoming request, as the HTTP adapter gives
 * it (treat it as read-only).
 *
 * @stability experimental
 */
export type ResponseMetaRequest = Readonly<Record<string, unknown>>;

/**
 * One response meta contributor.
 *
 * @stability experimental
 */
export interface ResponseMetaContributorDef {
  /** The id, for logs. See {@link RESPONSE_META_CONTRIBUTOR_ID_PATTERN}. */
  readonly id: string;
  /**
   * The facts to merge into `meta` for this response. Synchronous and cheap.
   *
   * @param request - the incoming request (read-only).
   * @returns the extra `meta` entries.
   */
  contribute(request: ResponseMetaRequest): Record<string, unknown>;
}

/**
 * Every registered response meta contributor, in registration order. Frozen
 * when the application has bootstrapped.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const responseMetaContributorRegistry: Registry<ResponseMetaContributorDef> =
  defineRegistry<ResponseMetaContributorDef>({
    name: 'host.response-meta-contributors',
    idOf: (contributor) => contributor.id,
    idPattern: RESPONSE_META_CONTRIBUTOR_ID_PATTERN,
    validate: (contributor) => {
      if (typeof contributor.contribute !== 'function') {
        throw new Error(`response meta contributor "${contributor.id}": contribute must be a function`);
      }
    },
  });

/**
 * Registers a response meta contributor. Call it at module load, before the
 * application is created; a duplicate id throws.
 *
 * Pass a definition `{ id, contribute }`, or a bare function whose name is the
 * id (converted from camelCase, so a function named `apiRevision` registers as
 * `api-revision`).
 *
 * @param contributor - the definition or the function.
 * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY`, `DUPLICATE_ID` or `FROZEN`.
 * @throws Error when a bare function has no name.
 *
 * @example
 * ```ts
 * // apps/api/src/app-registrations/host.ts
 * registerResponseMetaContributor({ id: 'api-revision', contribute: () => ({ apiRevision: 4 }) });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerResponseMetaContributor(
  contributor: ResponseMetaContributorDef | ((request: ResponseMetaRequest) => Record<string, unknown>),
): void {
  if (typeof contributor === 'function') {
    const id = contributor.name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    if (id === '') {
      throw new Error('registerResponseMetaContributor: an anonymous function has no id; name the function or pass { id, contribute }');
    }
    responseMetaContributorRegistry.register({ id, contribute: contributor });
    return;
  }
  responseMetaContributorRegistry.register(contributor);
}
