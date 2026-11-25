// Compile-time and run-time checks of the settings extension points
// (PP-14.21) against the INSTALLED declarations: a nested extension with an org
// layer, the assembled order of contributions, and the augmentable profile
// type. Pure functions over throwaway declarations: they never touch the
// static registries, which test/smoke.e2e.mjs leaves for the application.

import {
  assembleSystemSettingsNamespaces,
  extendSystemSettingsNamespace,
  type SettingsContribution,
  type SystemSettingsNamespace,
  type UserProfileSettingsExtensions,
} from '@marinoscar/platform-api/settings';
import { z } from 'zod';

declare module '@marinoscar/platform-api/settings' {
  interface UserProfileSettingsExtensions {
    /** An IANA time zone. */
    timezone?: string;
  }
}

const stored = z.object({ enabled: z.boolean(), limits: z.object({ daily: z.number().int() }) });

const COACH: SystemSettingsNamespace = {
  key: 'coach',
  description: 'A throwaway namespace with a nested object.',
  storedSchema: stored,
  patchSchema: stored.partial(),
  putSchema: stored,
  wirePatchSchema: stored.partial(),
  responseSchema: stored,
  defaults: { enabled: true, limits: { daily: 1 } },
  requiredOnPut: false,
  merge: (current, patch) => ({ ...(current as object), ...((patch as object) ?? {}) }),
};

/** The defaults of `coach` after a nested extension with an org layer folds in `limits.weekly`. */
export function nestedExtensionDefaults(): unknown {
  const extended = extendSystemSettingsNamespace(COACH, {
    key: 'coach',
    path: 'limits',
    storedSchema: z.object({ weekly: z.number().int() }),
    defaults: { weekly: 7 },
    org: { mode: 'tighten', tighten: { weekly: 'min' } },
  });
  if (!extended.org || !('limits' in extended.org.schema.shape)) throw new Error('the org layer lost its nested field');
  return extended.defaults;
}

/** The keys `assembleSystemSettingsNamespaces` lists: the platform's, then the contributions', then the app's. */
export function assembledKeys(): string[] {
  const contribution: SettingsContribution = { id: '@smoke/package', system: [{ ...COACH, key: 'contributed' }] };
  return assembleSystemSettingsNamespaces({
    platform: [COACH],
    app: [{ ...COACH, key: 'appOwned' }],
    contributions: [contribution],
  }).map((ns) => ns.key);
}

/** The augmentation reaches a consumer: `timezone` is a typed, optional profile field. */
export function profileTimezone(profile: UserProfileSettingsExtensions): string | undefined {
  return profile.timezone;
}
