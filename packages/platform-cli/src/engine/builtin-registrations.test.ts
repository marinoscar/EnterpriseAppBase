import {
  annotateEnvKey,
  listEnvGroups,
  listEnvSpecFragments,
  registerEnvGenerator,
  registerEnvGroup,
  registerEnvSpecFragment,
  resetEnvAnnotationRegistryForTests,
  resetEnvGeneratorRegistryForTests,
} from '../core/index.js';
import { telemetryEnvSpecFragment, type TelemetryEnvGroup } from '../telemetry/index.js';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';

import { effectiveGroups } from './deploy/compose-files.js';
import { ENV_GROUPS, metadataFor, type EnvGroup } from './deploy/env-metadata.js';
import {
  PLATFORM_ENV_FRAGMENT_ID,
  ensurePlatformRegistrations,
  resetPlatformRegistrationsForTests,
} from './builtin-registrations.js';

// =============================================================================
// The CLI's registration point for the platform registries  (PP-4.5, #706)
// =============================================================================

afterEach(() => {
  resetPlatformRegistrationsForTests();
  resetEnvAnnotationRegistryForTests();
  resetEnvGeneratorRegistryForTests();
});

describe('ensurePlatformRegistrations', () => {
  it('registers the app map and the telemetry fragment, in that order', () => {
    ensurePlatformRegistrations();
    expect(listEnvSpecFragments().map((fragment) => fragment.id)).toEqual([PLATFORM_ENV_FRAGMENT_ID, 'telemetry']);
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
      `Env key "JWT_SECRET" is defined by env-spec fragment "${PLATFORM_ENV_FRAGMENT_ID}" and again by "coach"`,
    );
  });

  it('fails loudly, and keeps failing, when a fragment registered first claims an app key', () => {
    // A fragment that got in before the app map: the app map's own
    // registration is the one that collides.
    registerEnvSpecFragment({ id: 'early', metadata: { NODE_ENV: {} } });
    const expected = `Env key "NODE_ENV" is defined by env-spec fragment "early" and again by "${PLATFORM_ENV_FRAGMENT_ID}"`;
    expect(() => ensurePlatformRegistrations()).toThrow(expected);
    expect(() => metadataFor('NODE_ENV')).toThrow(expected);
  });

  it('refuses a fragment key in a group this CLI does not know', () => {
    ensurePlatformRegistrations();
    registerEnvSpecFragment({ id: 'coach', metadata: { COACH_TOKEN: { group: 'coach' } } });
    expect(() => metadataFor('COACH_TOKEN')).toThrow(/group "coach", which this CLI does not know/);
  });
});

describe('env groups', () => {
  it('registers the three built-in groups through registerEnvGroup, observability on by default', () => {
    ensurePlatformRegistrations();
    expect(listEnvGroups().map((group) => group.id)).toEqual([...ENV_GROUPS]);
    expect(listEnvGroups().filter((group) => group.defaultEnabled).map((group) => group.id)).toEqual(['observability']);
  });

  it('accepts a fragment key in an app group registered with registerEnvGroup', () => {
    ensurePlatformRegistrations();
    registerEnvGroup({ id: 'coach', label: 'Coach', description: 'The coach.', defaultEnabled: false });
    registerEnvSpecFragment({ id: 'coach', metadata: { COACH_TOKEN: { group: 'coach', secret: true } } });
    expect(metadataFor('COACH_TOKEN')).toMatchObject({ group: 'coach', secret: true });
  });

  it('names the registered groups when a fragment names an unknown one', () => {
    ensurePlatformRegistrations();
    registerEnvSpecFragment({ id: 'coach', metadata: { COACH_TOKEN: { group: 'coach' } } });
    expect(() => metadataFor('COACH_TOKEN')).toThrow(/known: observability, email, microsoft-oauth\). Register the group with registerEnvGroup/);
  });

  it('effectiveGroups is unchanged for the platform, and adds an app group that is on by default', () => {
    expect(effectiveGroups()).toEqual(['observability']);
    expect(effectiveGroups(['email'])).toEqual(['email', 'observability']);
    registerEnvGroup({ id: 'coach', label: 'Coach', description: 'The coach.', defaultEnabled: true });
    expect(effectiveGroups(['email'])).toEqual(['email', 'observability', 'coach']);
    registerEnvGroup({ id: 'billing', label: 'Billing', description: 'Billing.', defaultEnabled: false });
    expect(effectiveGroups()).not.toContain('billing');
  });
});

describe('annotateEnvKey on a key the platform owns (the app wins)', () => {
  it('replaces fixed and help, and leaves every other field of the owner alone', () => {
    expect(metadataFor('NODE_ENV')).toEqual({ fixed: 'production' });
    annotateEnvKey('NODE_ENV', { fixed: 'staging', help: 'Runtime mode of the coach stack.' });
    expect(metadataFor('NODE_ENV')).toEqual({ fixed: 'staging', help: 'Runtime mode of the coach stack.' });

    // JWT_SECRET is the owner's secret; an annotation may add help but not unmask it.
    annotateEnvKey('JWT_SECRET', { help: 'Signs session tokens.' });
    expect(metadataFor('JWT_SECRET')).toMatchObject({ secret: true, generate: 'base64-32', help: 'Signs session tokens.' });
  });

  it('refuses to fix a secret key, so a secret is never a literal in source', () => {
    annotateEnvKey('JWT_SECRET', { fixed: 'hunter2' });
    expect(() => metadataFor('JWT_SECRET')).toThrow(/fixes a secret key/);
  });

  it('cannot bring back a key that is never written', () => {
    expect(metadataFor('TEST_AUTH_ENABLED').never).toBe(true);
    annotateEnvKey('TEST_AUTH_ENABLED', { fixed: 'true' });
    expect(metadataFor('TEST_AUTH_ENABLED')).toEqual({ never: true });
  });

  it('lets a fragment name a generator kind the app registered', () => {
    registerEnvGenerator({ kind: 'token-8', generate: () => 'abcd1234' });
    ensurePlatformRegistrations();
    registerEnvSpecFragment({ id: 'coach', metadata: { COACH_TOKEN: { secret: true, generate: 'token-8' } } });
    expect(metadataFor('COACH_TOKEN')).toEqual({ secret: true, generate: 'token-8' });
  });
});

describe('telemetry fragment groups', () => {
  it('names only groups this CLI knows (type level)', () => {
    expectTypeOf<TelemetryEnvGroup>().toExtend<EnvGroup>();
    type Entry = (typeof telemetryEnvSpecFragment.metadata)[string];
    expectTypeOf<Entry['group']>().toExtend<EnvGroup>();
  });

  it('names only groups this CLI knows (run time)', () => {
    for (const entry of Object.values(telemetryEnvSpecFragment.metadata)) {
      expect(ENV_GROUPS as readonly string[]).toContain(entry.group);
    }
  });
});
