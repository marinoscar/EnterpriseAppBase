import type { InfraFile } from './telemetry/index.js';

export type { InfraFile };

/**
 * The part of a fragment manifest that `platform-infra sync` reads: the
 * generated files, the app-owned files and where an app makes its change
 * instead of editing a generated file.
 *
 * @stability experimental
 */
export interface InfraFragmentFiles {
  /** Stable id of the fragment; also its key in `infra/platform-infra.lock.json`. */
  readonly id: string;
  /** Where an app changes what this fragment ships, named in every generated header and drift error. */
  readonly extendThrough: string;
  /** Platform-owned files copied (and rendered) into the app on every sync. They are generated: never edit them in the app. */
  readonly files: readonly InfraFile[];
  /** App-owned files created from a package template only when absent, and never overwritten afterwards. */
  readonly appOwnedFiles: readonly InfraFile[];
}

/**
 * Freezes a manifest and everything inside it, so a consumer cannot reorder
 * the deploy by mutating it.
 *
 * @internal
 */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
