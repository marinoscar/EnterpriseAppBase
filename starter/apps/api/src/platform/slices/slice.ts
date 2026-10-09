// =============================================================================
// The optional platform slices, as data
// =============================================================================
//
// Which slices this app mounts is ONE list: `enabled` in
// `packages/shared/slices.json` (the API and the web app both read it). A
// slice is the packaged `forRoot()`, its host-port adapters, its registrations
// and one minimal example, kept in `src/platform/<id>/` and described to the
// rest of the app by an `ApiSlice` (`./definitions.ts` lists them all).
//
// A slice definition is DATA PLUS LAZY LOADERS: importing one runs nothing,
// so a disabled slice costs no `forRoot()`, no registry entry and no route.
// Everything that touches a static registry or builds a Nest module lives
// behind a function that is called only for an enabled slice.
// =============================================================================

import type { DynamicModule, Provider, Type } from '@nestjs/common';
import type { PlatformPermissionSlice } from '@marinoscar/platform-api/manifest';

/** Every optional slice the starter can mount, in mount order (dependencies first). */
export const SLICE_IDS = [
  'credentials',
  'storage',
  'email',
  'notifications',
  'sharing',
  'ai',
  'db-backup',
  'exports',
  'onboarding',
  'android-app',
] as const;

export type SliceId = (typeof SLICE_IDS)[number];

/** A Nest module a slice mounts. */
export type SliceModule = Type<unknown> | DynamicModule;

/** The enabled slices, for a definition that adapts to its neighbours. */
export interface EnabledSlices {
  has(id: SliceId): boolean;
  readonly ids: readonly SliceId[];
}

/**
 * What a slice adds to lists another slice owns. The owning slice (or the
 * composition) registers the merged lists once, in slice order, so a slice
 * never reaches into another's files.
 */
export interface SliceContributions {
  /** Notification events with their email and browser renderers (the notifications slice registers them). */
  readonly notifications?: readonly import('@marinoscar/platform-api/notifications').NotificationRegistration[];
  /** Email templates this slice owns the words of (the email slice registers them). */
  readonly emailTemplates?: readonly import('@marinoscar/platform-api/email').EmailTemplateEntry[];
  /** Object-storage key prefixes (the storage purge reaches them). */
  readonly storagePrefixes?: readonly import('@marinoscar/platform-api/storage').StorageKeyPrefixDef[];
  /** Purposes the credential stores accept. */
  readonly credentialPurposes?: readonly import('@marinoscar/platform-api/credentials').CredentialPurposeDef[];
  /** System settings namespaces (registered before `SettingsModule.forRoot()` composes the request bodies). */
  readonly systemSettings?: readonly import('@marinoscar/platform-api/settings').SystemSettingsNamespace[];
  /** Optional user settings namespaces. */
  readonly userSettings?: readonly import('@marinoscar/platform-api/settings').UserSettingsNamespace[];
}

/** What a slice adds to the user-data module's options (the data resets). */
export interface SliceUserDataOptions {
  /** Rules that run before a user row is deleted (sharing's last-admin rule). */
  readonly userRemovalHooks?: readonly import('@marinoscar/platform-api/user-data').UserRemovalHook[];
  /** `DatabaseBackupRun.jobId`-style references that keep their jobs through a factory reset. */
  readonly keepJobsReferencedBy?: readonly { readonly model: string; readonly field: string }[];
}

export interface ApiSlice {
  readonly id: SliceId;
  /** One line for the README table and for error messages. */
  readonly label: string;
  /** Slices that must be enabled with this one (the dependency, not a preference). */
  readonly requires: readonly SliceId[];
  /** The slice's name in `PlatformPermissionOptions.slices`, when it declares permissions (seeded by `prisma:seed`). */
  readonly permissionSlices?: readonly PlatformPermissionSlice[];
  /** The slice's registry contributions. Lazy: evaluated for an enabled slice only. */
  readonly contribute?: () => SliceContributions;
  /**
   * Files of the slice that issue raw SQL, relative to `src/`, each with the reason
   * (the `user-owned-data` conformance suite allowlists them; every other raw
   * statement fails it).
   */
  readonly rawSql?: readonly { readonly file: string; readonly why: string }[];
  /** The slice's contribution to the data resets. Lazy, like `contribute`. */
  readonly userData?: () => SliceUserDataOptions;
  /**
   * Import-time registrations that are the slice's own (an onboarding manifest,
   * a device source, an export source). Runs once, before any `forRoot()`.
   */
  readonly register?: (enabled: EnabledSlices) => void;
  /** The configured Nest modules, built here and nowhere else (`forRoot()` runs when this does). */
  readonly modules?: (enabled: EnabledSlices) => readonly SliceModule[];
  /**
   * Host-port bindings that replace the starter's defaults in the global
   * `AppHostModule` (for example the identity notifier once notifications exist).
   * A provider replaces the default of the same token.
   */
  readonly hostPorts?: (enabled: EnabledSlices) => readonly Provider[];
}

/** Thrown for a manifest the app cannot start with; names the slice and the fix. */
export class SliceManifestError extends Error {}

/**
 * Validates the manifest and returns the enabled slices in mount order:
 * an unknown id, a duplicate, or a slice whose `requires` is not enabled throws
 * with the line to add or remove.
 */
export function resolveSlices(ids: readonly string[], definitions: Readonly<Record<SliceId, ApiSlice>>): readonly ApiSlice[] {
  const known = new Set<string>(SLICE_IDS);
  const seen = new Set<string>();
  for (const id of ids) {
    if (!known.has(id)) {
      throw new SliceManifestError(`packages/shared/slices.json: unknown slice "${id}". Known slices: ${SLICE_IDS.join(', ')}.`);
    }
    if (seen.has(id)) throw new SliceManifestError(`packages/shared/slices.json: slice "${id}" is listed twice.`);
    seen.add(id);
  }
  const enabled = SLICE_IDS.filter((id) => seen.has(id)).map((id) => definitions[id]);
  for (const slice of enabled) {
    const missing = slice.requires.filter((id) => !seen.has(id));
    if (missing.length > 0) {
      throw new SliceManifestError(
        `packages/shared/slices.json: slice "${slice.id}" requires ${missing.map((id) => `"${id}"`).join(', ')}. ` +
          `Add ${missing.length === 1 ? 'it' : 'them'} to "enabled", or remove "${slice.id}" too.`,
      );
    }
  }
  return enabled;
}
