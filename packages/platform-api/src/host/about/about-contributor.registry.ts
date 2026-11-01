// =============================================================================
// The About contributor registry (PP-14.13)
// =============================================================================
//
// `GET /api/admin/about` reports the platform's facts (the API version, the
// deploy document, the deployment mode, the database). An app has facts of its
// own that belong on that page: which regions a provider is configured for, the
// schema version of its data, a feature flag set. `registerAboutContributor`
// adds a named group of facts, served as `extras: [{ id, label, facts }]` and
// rendered by the web About page as one extra section per group.
//
// The route is admin-only (`system_settings:read`), but the facts are still
// bounded and secret-filtered before they leave (`../internal/bounded.ts`: 16
// keys, primitive values, 200-character strings, credential-looking keys
// dropped), and ONE FAILING CONTRIBUTOR NEVER TAKES DOWN THE REPORT: a throw or
// a timeout omits that group and logs a warning. The route keeps answering 200.
// =============================================================================

import { defineRegistry, type Registry } from '../../core/index';
import type { BoundedFacts } from '../internal/bounded';

/**
 * The id pattern of an About contributor: lower-case, 2 to 48 characters,
 * starting with a letter (`transcription`).
 *
 * @stability experimental
 */
export const ABOUT_CONTRIBUTOR_ID_PATTERN = /^[a-z][a-z0-9-]{1,47}$/;

/**
 * How long a contributor may take before its group is omitted.
 *
 * @stability experimental
 */
export const ABOUT_CONTRIBUTOR_TIMEOUT_MS = 2000;

/**
 * One About contributor.
 *
 * @stability experimental
 */
export interface AboutContributorDef {
  /** The id. See {@link ABOUT_CONTRIBUTOR_ID_PATTERN}. */
  readonly id: string;
  /** The group's heading on the About page (at most 80 characters). */
  readonly label: string;
  /**
   * The facts, read fresh on every request. Values are strings, numbers or
   * booleans; the rest is dropped. Never a secret, and no network I/O beyond
   * what the contributor can answer within {@link ABOUT_CONTRIBUTOR_TIMEOUT_MS}.
   *
   * @returns the facts.
   */
  describe(): Promise<BoundedFacts> | BoundedFacts;
}

/**
 * Every registered About contributor, in registration order. Frozen when the
 * application has bootstrapped.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const aboutContributorRegistry: Registry<AboutContributorDef> = defineRegistry<AboutContributorDef>({
  name: 'host.about-contributors',
  idOf: (contributor) => contributor.id,
  idPattern: ABOUT_CONTRIBUTOR_ID_PATTERN,
  validate: (contributor) => {
    if (typeof contributor.label !== 'string' || contributor.label.trim() === '' || contributor.label.length > 80) {
      throw new Error(`about contributor "${contributor.id}": label must be a non-empty string of at most 80 characters`);
    }
    if (typeof contributor.describe !== 'function') {
      throw new Error(`about contributor "${contributor.id}": describe must be a function`);
    }
  },
});

/**
 * Registers an About contributor. Call it at module load, before the
 * application is created; a duplicate id throws.
 *
 * @param contributor - the contributor.
 * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY`, `DUPLICATE_ID` or `FROZEN`.
 *
 * @example
 * ```ts
 * // apps/api/src/app-registrations/host.ts
 * registerAboutContributor({
 *   id: 'transcription',
 *   label: 'Transcription',
 *   describe: async () => ({ provider: 'example-transcribe', regions: 2 }),
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerAboutContributor(contributor: AboutContributorDef): void {
  aboutContributorRegistry.register(contributor);
}
