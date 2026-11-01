import { createCli } from '@marinoscar/platform-cli';
import { generateWithKind, getEnvGroup, listEnvGroups } from '@marinoscar/platform-cli/core';
import { effectiveGroups, metadataFor, parseEnvExample } from '@marinoscar/platform-cli/deploy';
import { resetCliForTests } from '@marinoscar/platform-cli/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { APP_CLI_OPTIONS } from '../app.js';

import { coachEnvGroup, coachEnvSpecFragment } from './coach.env-group.js';
import { coachTokenGenerator } from './coach.env-generator.js';

// The registerEnvGroup example (PP-14.22): an app makes its keys an opt-in group
// without a package edit, and the deploy wizard asks them only when it is on.

beforeEach(() => resetCliForTests());
afterEach(() => resetCliForTests());

const TEMPLATE = `
# Where the coaching assistant lives.
COACH_API_URL=

# Bearer token for the coaching assistant.
COACH_API_TOKEN=change-me
`;

const options = {
  ...APP_CLI_OPTIONS,
  envGenerators: [coachTokenGenerator],
  envGroups: [coachEnvGroup],
  envSpecFragments: [coachEnvSpecFragment],
};

describe('coachEnvGroup', () => {
  it('is not a group of the shipped CLI', () => {
    createCli(APP_CLI_OPTIONS);
    expect(getEnvGroup('coach')).toBeUndefined();
    expect(listEnvGroups().map((group) => group.id)).toEqual(['observability', 'email', 'microsoft-oauth']);
  });

  it('is registered after the platform groups once passed in envGroups, and is opt-in', () => {
    createCli(options);
    expect(listEnvGroups().map((group) => group.id)).toEqual(['observability', 'email', 'microsoft-oauth', 'coach']);
    expect(effectiveGroups([])).toEqual(['observability']);
  });

  it('puts the keys in the group, so the wizard asks them only when the group is on', () => {
    createCli(options);
    // The wizard skips a key whose metadata names a group the deployment did not enable.
    expect(metadataFor('COACH_API_URL')).toMatchObject({ group: 'coach', essential: true });
    expect(metadataFor('COACH_API_TOKEN')).toMatchObject({ group: 'coach', secret: true, generate: 'token-24', autoGenerate: true });
    const asked = (groups: readonly string[]) =>
      parseEnvExample(TEMPLATE)
        .map((spec) => spec.key)
        .filter((key) => metadataFor(key).group === undefined || groups.includes(metadataFor(key).group as string));
    expect(asked(effectiveGroups([]))).toEqual([]);
    expect(asked(effectiveGroups(['coach']))).toEqual(['COACH_API_URL', 'COACH_API_TOKEN']);
  });

  it('generates the token with the app\'s own kind', () => {
    createCli(options);
    expect(generateWithKind(metadataFor('COACH_API_TOKEN').generate as string)).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });

  it('a fragment naming a group nobody registered fails loudly instead of never asking its keys', () => {
    createCli({ ...APP_CLI_OPTIONS, envSpecFragments: [coachEnvSpecFragment] });
    expect(() => metadataFor('COACH_API_URL')).toThrow(/group "coach", which this CLI does not know.*registerEnvGroup/);
  });

  it('a duplicate group throws at createCli', () => {
    expect(() => createCli({ ...options, envGroups: [coachEnvGroup, coachEnvGroup] })).toThrow(/already registered/);
  });
});
