// =============================================================================
// Pluggable-kind errors (PP-14.5, issue #923)
// =============================================================================
//
// Two errors, both framework-free (no Nest exception base) so a kind works in
// seeds and scripts. The slice that consumes a kind maps them to its own
// HTTP errors: `PluggableUnknownError` -> its `*_UNKNOWN_*` 400 code,
// `PluggableSettingsError` -> a 400 carrying `issues`.
// =============================================================================

import type { z } from 'zod';

/**
 * No implementation is registered under the requested id. The message names the
 * kind, the id and every registered id, and says how to register one.
 *
 * @stability experimental
 */
export class PluggableUnknownError extends Error {
  /** Machine-readable reason. */
  readonly code = 'PLUGGABLE_UNKNOWN' as const;
  /** The kind that was asked. */
  readonly kind: string;
  /** The id that is not registered. */
  readonly id: string;
  /** The ids that are, in registration order. */
  readonly registeredIds: readonly string[];

  /**
   * @param kind - the kind id.
   * @param id - the unknown implementation id.
   * @param registeredIds - the ids registered at the time.
   */
  constructor(kind: string, id: string, registeredIds: readonly string[]) {
    super(
      `Unknown ${kind} implementation "${id}". Registered: ${registeredIds.join(', ') || '(none)'}. ` +
        `Register one with the "${kind}" kind's register() at import time, before the application is created.`,
    );
    this.name = 'PluggableUnknownError';
    this.kind = kind;
    this.id = id;
    this.registeredIds = [...registeredIds];
  }
}

/**
 * An implementation's settings do not parse with its own `settingsSchema`.
 * Carries the zod issues.
 *
 * @stability experimental
 */
export class PluggableSettingsError extends Error {
  /** Machine-readable reason. */
  readonly code = 'PLUGGABLE_SETTINGS_INVALID' as const;
  /** The kind. */
  readonly kind: string;
  /** The implementation id whose settings are invalid. */
  readonly id: string;
  /** The zod issues, with paths relative to the implementation's settings object. */
  readonly issues: readonly z.core.$ZodIssue[];

  /**
   * @param kind - the kind id.
   * @param id - the implementation id.
   * @param issues - the zod issues.
   */
  constructor(kind: string, id: string, issues: readonly z.core.$ZodIssue[]) {
    super(
      `Invalid ${kind} settings for "${id}": ` +
        (issues.map((issue) => `${issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''}${issue.message}`).join('; ') || 'invalid'),
    );
    this.name = 'PluggableSettingsError';
    this.kind = kind;
    this.id = id;
    this.issues = [...issues];
  }
}
