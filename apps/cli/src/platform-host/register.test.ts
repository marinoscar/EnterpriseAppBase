import { listEnvSpecFragments, registerEnvSpecFragment } from '@marinoscar/platform-cli/core';
import { telemetryEnvSpecFragment } from '@marinoscar/platform-cli/telemetry';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';

import { ENV_GROUPS, metadataFor, type EnvGroup } from '../deploy/env-metadata.js';
import {
  APP_ENV_FRAGMENT_ID,
  ensurePlatformRegistrations,
  resetPlatformRegistrationsForTests,
} from './register.js';

// =============================================================================
// The CLI's registration point for the platform registries  (PP-4.5, #706)
// =============================================================================

afterEach(() => resetPlatformRegistrationsForTests());

describe('ensurePlatformRegistrations', () => {
  it('registers the app map and the telemetry fragment, in that order', () => {
    ensurePlatformRegistrations();
    expect(listEnvSpecFragments().map((fragment) => fragment.id)).toEqual([APP_ENV_FRAGMENT_ID, 'telemetry']);
  });

  it('is idempotent', () => {
    ensurePlatformRegistrations();
    ensurePlatformRegistrations();
    metadataFor('GREPTIME_DB');
    expect(listEnvSpecFragments()).toHaveLength(2);
  });

  it('runs lazily from metadataFor, never on import', () => {
    expect(listEnvSpecFragments()).toEqual([]);
    expect(metadataFor('GREPTIME_WRITER_PASSWORD')).toMatchObject({ generate: 'hex-32', autoGenerate: true });
    expect(listEnvSpecFragments()).toHaveLength(2);
  });

  it('refuses a fragment that redefines a key of the app map, naming both owners', () => {
    ensurePlatformRegistrations();
    expect(() => registerEnvSpecFragment({ id: 'coach', metadata: { JWT_SECRET: { secret: true } } })).toThrow(
      `Env key "JWT_SECRET" is defined by env-spec fragment "${APP_ENV_FRAGMENT_ID}" and again by "coach"`,
    );
  });

  it('fails loudly, and keeps failing, when a fragment registered first claims an app key', () => {
    // A fragment that got in before the app map: the app map's own
    // registration is the one that collides.
    registerEnvSpecFragment({ id: 'early', metadata: { NODE_ENV: {} } });
    const expected = `Env key "NODE_ENV" is defined by env-spec fragment "early" and again by "${APP_ENV_FRAGMENT_ID}"`;
    expect(() => ensurePlatformRegistrations()).toThrow(expected);
    expect(() => metadataFor('NODE_ENV')).toThrow(expected);
  });

  it('refuses a fragment key in a group this CLI does not know', () => {
    ensurePlatformRegistrations();
    registerEnvSpecFragment({ id: 'coach', metadata: { COACH_TOKEN: { group: 'coach' } } });
    expect(() => metadataFor('COACH_TOKEN')).toThrow(/group "coach", which this CLI does not know/);
  });
});

describe('telemetry fragment groups', () => {
  it('names only groups this CLI knows (type level)', () => {
    type Entry = (typeof telemetryEnvSpecFragment.metadata)[keyof typeof telemetryEnvSpecFragment.metadata];
    expectTypeOf<NonNullable<Entry['group']>>().toExtend<EnvGroup>();
  });

  it('names only groups this CLI knows (run time)', () => {
    for (const entry of Object.values(telemetryEnvSpecFragment.metadata)) {
      expect(ENV_GROUPS as readonly string[]).toContain(entry.group);
    }
  });
});
