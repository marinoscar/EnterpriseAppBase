import { describe, expect, it } from 'vitest';

import { afterEach } from 'vitest';

import {
  appComposeOverlays,
  COMPOSE_MODES,
  composeFilesForMode,
  listComposeModes,
  registerComposeMode,
  resetComposeModesForTests,
} from './compose-order.js';

afterEach(() => resetComposeModesForTests());

describe('composeFilesForMode()', () => {
  it('lists the platform files of each mode in the documented order', () => {
    expect(composeFilesForMode('dev')).toEqual(['base.compose.yml', 'dev.compose.yml']);
    expect(composeFilesForMode('devdb')).toEqual(['base.compose.yml', 'dev.compose.yml', 'devdb.compose.yml']);
    expect(composeFilesForMode('prod')).toEqual(['base.compose.yml', 'prod.compose.yml']);
    expect(composeFilesForMode('vps')).toEqual(['base.compose.yml', 'prod.compose.yml', 'vps.compose.yml']);
    expect(composeFilesForMode('worker')).toEqual(['worker.compose.yml']);
    expect(composeFilesForMode('worker', { build: true })).toEqual(['worker.compose.yml', 'worker.build.compose.yml']);
  });

  it('puts telemetry before the VPS files and its hardening last among the platform files', () => {
    expect(composeFilesForMode('vps', { telemetry: true })).toEqual([
      'base.compose.yml',
      'prod.compose.yml',
      'telemetry.compose.yml',
      'vps.compose.yml',
      'vps.telemetry.compose.yml',
    ]);
    expect(composeFilesForMode('dev', { telemetry: true })).toEqual(['base.compose.yml', 'dev.compose.yml', 'telemetry.compose.yml']);
    expect(composeFilesForMode('worker', { telemetry: true })).toEqual(['worker.compose.yml']);
  });

  it('appends app overlays after every platform file, sorted by file name', () => {
    const listing = [
      'vps.compose.yml',
      'app.zeta.compose.yml',
      'app.vps.limits.compose.yml',
      'base.compose.yml',
      'app.alpha.compose.yml',
      'app.prod.memory.compose.yml',
      '.env.example',
    ];
    expect(composeFilesForMode('vps', { telemetry: true, overlays: listing })).toEqual([
      'base.compose.yml',
      'prod.compose.yml',
      'telemetry.compose.yml',
      'vps.compose.yml',
      'vps.telemetry.compose.yml',
      'app.alpha.compose.yml',
      'app.prod.memory.compose.yml',
      'app.vps.limits.compose.yml',
      'app.zeta.compose.yml',
    ]);
  });

  it('is deterministic whatever order the directory listing comes in', () => {
    const listing = ['app.b.compose.yml', 'app.A.compose.yml', 'app.a.compose.yml', 'app.prod.x.compose.yml'];
    const reversed = [...listing].reverse();
    expect(composeFilesForMode('prod', { overlays: listing })).toEqual(composeFilesForMode('prod', { overlays: reversed }));
    // Code-point order: upper case before lower case, independent of the locale.
    expect(appComposeOverlays(listing, 'prod')).toEqual(['app.A.compose.yml', 'app.a.compose.yml', 'app.b.compose.yml', 'app.prod.x.compose.yml']);
  });
});

describe('appComposeOverlays()', () => {
  const listing = [
    'app.all.compose.yml',
    'app.dev.hot.compose.yml',
    'app.devdb.seed.compose.yml',
    'app.prod.memory.compose.yml',
    'app.vps.no-agent.compose.yml',
    'app.vps.compose.yml',
    'app.worker.gpu.compose.yml',
    'app.example.compose.yml',
    'app.vps.example.compose.yml',
    'telemetry.compose.yml',
    'appx.compose.yml',
    'app.compose.yml',
  ];

  it.each([
    ['dev', ['app.all.compose.yml', 'app.dev.hot.compose.yml']],
    ['devdb', ['app.all.compose.yml', 'app.dev.hot.compose.yml', 'app.devdb.seed.compose.yml']],
    ['prod', ['app.all.compose.yml', 'app.prod.memory.compose.yml']],
    ['vps', ['app.all.compose.yml', 'app.prod.memory.compose.yml', 'app.vps.compose.yml', 'app.vps.no-agent.compose.yml']],
    ['worker', ['app.worker.gpu.compose.yml']],
  ] as const)('%s gets the unscoped overlays and those of its scopes', (mode, expected) => {
    expect(appComposeOverlays(listing, mode)).toEqual(expected);
  });

  it('never applies an example overlay or a file that is not an app overlay', () => {
    for (const mode of COMPOSE_MODES) {
      const applied = appComposeOverlays(listing, mode);
      expect(applied.filter((name) => name.endsWith('.example.compose.yml'))).toEqual([]);
      expect(applied).not.toContain('telemetry.compose.yml');
      expect(applied).not.toContain('appx.compose.yml');
      expect(applied).not.toContain('app.compose.yml');
    }
  });

  it('accepts .yaml and drops duplicates', () => {
    expect(appComposeOverlays(['app.x.compose.yaml', 'app.x.compose.yaml'], 'dev')).toEqual(['app.x.compose.yaml']);
  });
});

describe('the test mode', () => {
  it('is the disposable test database on its own, with app.test.* overlays only', () => {
    expect(COMPOSE_MODES).toContain('test');
    expect(composeFilesForMode('test')).toEqual(['test.compose.yml']);
    const listing = ['app.test.seed.compose.yml', 'app.compose.yml', 'app.memory.compose.yml', 'app.prod.limits.compose.yml', 'app.test.example.compose.yml'];
    expect(composeFilesForMode('test', { telemetry: true, overlays: listing })).toEqual(['test.compose.yml', 'app.test.seed.compose.yml']);
    // The new scope does not leak into the other modes.
    expect(composeFilesForMode('vps', { overlays: listing })).toEqual(['base.compose.yml', 'prod.compose.yml', 'vps.compose.yml', 'app.memory.compose.yml', 'app.prod.limits.compose.yml']);
  });
});

describe('registerComposeMode()', () => {
  const staging = { id: 'staging', files: ['base.compose.yml', 'prod.compose.yml', 'vps.compose.yml'] };

  it('builds an app mode from its files, then its overlays by scope', () => {
    registerComposeMode(staging);
    const listing = ['app.staging.seed.compose.yml', 'app.memory.compose.yml', 'app.vps.limits.compose.yml', 'app.dev.x.compose.yml'];
    expect(composeFilesForMode('staging', { overlays: listing })).toEqual([
      'base.compose.yml',
      'prod.compose.yml',
      'vps.compose.yml',
      'app.memory.compose.yml',
      'app.staging.seed.compose.yml',
      'app.vps.limits.compose.yml',
    ]);
    // An app scope reaches only its own mode.
    expect(composeFilesForMode('vps', { overlays: listing })).not.toContain('app.staging.seed.compose.yml');
    expect(listComposeModes().map((mode) => mode.id)).toEqual(['staging']);
  });

  it('does not apply plain overlays to a mode without base.compose.yml', () => {
    registerComposeMode({ id: 'ci', files: ['test.compose.yml'] });
    expect(composeFilesForMode('ci', { overlays: ['app.memory.compose.yml', 'app.ci.up.compose.yml'] })).toEqual(['test.compose.yml', 'app.ci.up.compose.yml']);
  });

  it('refuses an unknown mode with a message naming how to register one', () => {
    expect(() => composeFilesForMode('staging')).toThrow(/Unknown compose mode "staging".*registerComposeMode/);
  });

  it.each([
    [{ id: 'dev', files: ['x.compose.yml'] }, /built in/],
    [{ id: 'Bad Id', files: ['x.compose.yml'] }, /invalid/],
    [{ id: 'ok', files: [] }, /at least one/],
    [{ id: 'ok', files: ['../x.compose.yml'] }, /plain compose file name/],
    [{ id: 'ok', files: ['x.yml'] }, /plain compose file name/],
    [{ id: 'ok', files: ['a.compose.yml', 'a.compose.yml'] }, /twice/],
  ])('refuses %j', (mode, message) => {
    expect(() => registerComposeMode(mode)).toThrow(message);
  });

  it('refuses a duplicate id', () => {
    registerComposeMode(staging);
    expect(() => registerComposeMode(staging)).toThrow(/already registered/);
  });
});
