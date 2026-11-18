import { composeFilesForMode, listComposeModes, registerComposeMode } from '@marinoscar/platform-infra';
import { afterEach, describe, expect, it } from 'vitest';

import { stagingMode } from './staging.compose-mode.js';

// The registerComposeMode example (PP-14.22), and the built-in `test` mode.

afterEach(() => {
  // The registry is module-level; the example registers it per test.
});

describe('stagingMode', () => {
  const listing = ['app.memory.compose.yml', 'app.staging.seed.compose.yml', 'app.test.db.compose.yml', 'app.vps.limits.compose.yml'];

  it('builds the mode from its files, with the app overlays of its scope last', () => {
    if (!listComposeModes().some((mode) => mode.id === 'staging')) registerComposeMode(stagingMode);
    expect(composeFilesForMode('staging', { overlays: listing })).toEqual([
      'base.compose.yml',
      'prod.compose.yml',
      'vps.compose.yml',
      'app.memory.compose.yml',
      'app.staging.seed.compose.yml',
      'app.vps.limits.compose.yml',
    ]);
  });

  it('does not leak its scope into the platform modes', () => {
    expect(composeFilesForMode('vps', { overlays: listing })).not.toContain('app.staging.seed.compose.yml');
  });

  it('leaves the built-in test mode alone: app.test.* reaches the test database only', () => {
    expect(composeFilesForMode('test', { overlays: listing })).toEqual(['test.compose.yml', 'app.test.db.compose.yml']);
  });
});
