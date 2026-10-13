import { afterEach, describe, expect, it } from 'vitest';

import {
  binaryCapability,
  evaluateCapabilities,
  JOB_TYPE_REQUIREMENTS,
  probeCapabilities,
  PROBED_BINARIES,
  registerJobRequirement,
  registerProbedBinary,
  resetCapabilityRegistriesForTests,
  runStartupSelfTest,
  type CapabilityProbe,
  type JobTypeRequirements,
} from './capabilities.js';

const REQUIREMENTS: Record<string, JobTypeRequirements> = {
  'video.transcode': { required: [binaryCapability('ffmpeg')], degradable: [binaryCapability('exiftool')] },
  'example.checksum': { required: [], degradable: [] },
};

function probe(capabilities: string[]): CapabilityProbe {
  return {
    platform: 'linux',
    arch: 'x64',
    nodeVersion: 'v22.0.0',
    cpus: 4,
    totalMemoryMb: 8192,
    freeMemoryMb: 4096,
    binaries: {},
    capabilities,
  };
}

describe('probeCapabilities (issue #276)', () => {
  it('never throws, even when the binary lookup explodes', () => {
    // A probe that can fail turns a diagnostic command into another thing to
    // diagnose.
    expect(() =>
      probeCapabilities({
        binaries: ['ffmpeg'],
        hasBinary: () => {
          throw new Error('exec is not available in this sandbox');
        },
      }),
    ).not.toThrow();
  });

  it('reports a found binary as a capability key', () => {
    const result = probeCapabilities({ binaries: ['ffmpeg'], hasBinary: () => true });
    expect(result.capabilities).toContain('binary:ffmpeg');
    expect(result.binaries.ffmpeg).toBe(true);
  });

  it('reports real machine facts', () => {
    const result = probeCapabilities();
    expect(result.cpus).toBeGreaterThan(0);
    expect(result.nodeVersion).toBe(process.version);
  });
});

describe('evaluateCapabilities', () => {
  it('passes when nothing is required', () => {
    expect(evaluateCapabilities(['example.checksum'], probe([]), REQUIREMENTS).ok).toBe(true);
  });

  it('fails on a missing REQUIRED capability, naming both it and the type', () => {
    const result = evaluateCapabilities(['video.transcode'], probe([]), REQUIREMENTS);
    expect(result.ok).toBe(false);
    expect(result.missingRequired).toContainEqual({ type: 'video.transcode', capability: 'binary:ffmpeg' });
  });

  it('does not fail on a missing DEGRADABLE capability', () => {
    const result = evaluateCapabilities(['video.transcode'], probe(['binary:ffmpeg']), REQUIREMENTS);
    expect(result.ok).toBe(true);
    expect(result.missingDegradable).toContainEqual({ type: 'video.transcode', capability: 'binary:exiftool' });
  });

  it('ignores a type with no declared requirements', () => {
    expect(evaluateCapabilities(['some.fork.type'], probe([]), REQUIREMENTS).ok).toBe(true);
  });
});

describe('runStartupSelfTest', () => {
  it('reports a hard failure naming the capability and the type', () => {
    const failures: string[] = [];
    const warnings: string[] = [];

    const result = runStartupSelfTest({
      types: ['video.transcode'],
      probe: probe([]),
      requirements: REQUIREMENTS,
      warn: (message) => warnings.push(message),
      fail: (message) => failures.push(message),
    });

    expect(result.ok).toBe(false);
    expect(failures.join('\n')).toContain('binary:ffmpeg');
    expect(failures.join('\n')).toContain('video.transcode');
    // And it says what to do — install it, or drop the type.
    expect(failures.join('\n')).toMatch(/--types/);
  });

  it('warns and continues for a degradable gap', () => {
    const failures: string[] = [];
    const warnings: string[] = [];

    const result = runStartupSelfTest({
      types: ['video.transcode'],
      probe: probe(['binary:ffmpeg']),
      requirements: REQUIREMENTS,
      warn: (message) => warnings.push(message),
      fail: (message) => failures.push(message),
    });

    expect(result.ok).toBe(true);
    expect(failures).toEqual([]);
    expect(warnings.join('\n')).toContain('Reduced function');
  });
});

// =============================================================================
// `db.backup.run`'s two dependencies (#352, epic #345)
// =============================================================================

describe('db.backup.run requirements', () => {
  it('REFUSES to declare the type on a machine with no `pg_dump`', () => {
    // ⚠ THE FAILURE THIS PREVENTS IS THE EXPENSIVE ONE. `db.backup.run`
    // carries `maxAttempts: 1`, so a node that claims it and fails it does not
    // get a retry — the deployment simply has no backup that night, and finds
    // out during a restore.
    const result = evaluateCapabilities(['db.backup.run'], {
      ...probeOf({ pg_dump: false, psql: false }),
    });

    expect(result.ok).toBe(false);
    expect(result.missingRequired).toEqual([
      { type: 'db.backup.run', capability: 'binary:pg_dump' },
    ]);
  });

  it('runs WITHOUT `psql`, reporting reduced function — two audit fields, not a backup', () => {
    // The template's worked example of the degradable tier: the executor uses
    // `psql` only to read the server version and the newest migration, and a
    // node that refused to back the database up because it could not report a
    // version string would be trading the backup for a label.
    const result = evaluateCapabilities(['db.backup.run'], probeOf({ pg_dump: true, psql: false }));

    expect(result.ok).toBe(true);
    expect(result.missingDegradable).toEqual([
      { type: 'db.backup.run', capability: 'binary:psql' },
    ]);
  });

  it('is satisfied when both are present', () => {
    const result = evaluateCapabilities(['db.backup.run'], probeOf({ pg_dump: true, psql: true }));

    expect(result.ok).toBe(true);
    expect(result.missingDegradable).toEqual([]);
  });

  it('probes every binary any requirement names — the two lists move together', () => {
    // A capability that is never PROBED is a capability that is never
    // satisfied, so a requirement naming a binary missing from
    // `PROBED_BINARIES` would fail the self-test on every machine, however
    // complete the install.
    const required = Object.values(JOB_TYPE_REQUIREMENTS)
      .flatMap((entry) => [...entry.required, ...entry.degradable])
      .filter((capability) => capability.startsWith('binary:'))
      .map((capability) => capability.slice('binary:'.length));

    for (const binary of required) {
      expect(PROBED_BINARIES).toContain(binary);
    }
  });
});

/** A probe whose binaries are exactly these, with capabilities to match. */
function probeOf(binaries: Record<string, boolean>): CapabilityProbe {
  return probeCapabilities({
    binaries: Object.keys(binaries),
    hasBinary: (name) => binaries[name] === true,
  });
}

describe('registerProbedBinary and registerJobRequirement (PP-14.19)', () => {
  afterEach(() => resetCapabilityRegistriesForTests());

  it('starts with the platform’s own binaries and requirement, and a reset returns to exactly that', () => {
    const before = { binaries: [...PROBED_BINARIES], types: Object.keys(JOB_TYPE_REQUIREMENTS).sort() };
    registerProbedBinary('ffmpeg', { versionArgs: ['-version'] });
    registerJobRequirement('app.thing', { required: [binaryCapability('exiftool')] });

    resetCapabilityRegistriesForTests();

    expect(PROBED_BINARIES).toEqual(before.binaries);
    expect(PROBED_BINARIES).toEqual(['pg_dump', 'psql']);
    expect(Object.keys(JOB_TYPE_REQUIREMENTS).sort()).toEqual(before.types);
  });

  it('probes a registered binary, so a requirement naming it can be satisfied', () => {
    registerProbedBinary('ffmpeg');
    const result = probeCapabilities({ hasBinary: (name) => name === 'ffmpeg' });

    expect(result.binaries).toMatchObject({ ffmpeg: true, pg_dump: false, psql: false });
    expect(result.capabilities).toEqual(['binary:ffmpeg']);
  });

  it('captures a version banner for a found binary that has versionArgs, and none for one that does not', () => {
    registerProbedBinary('ffmpeg', { versionArgs: ['-version'] });
    registerProbedBinary('exiftool');
    const asked: string[] = [];

    const result = probeCapabilities({
      binaries: ['ffmpeg', 'exiftool', 'missing'],
      hasBinary: (name) => name !== 'missing',
      readVersion: (name) => {
        asked.push(name);
        return name === 'ffmpeg' ? 'ffmpeg version 6.1' : undefined;
      },
    });

    expect(result.versions).toEqual({ ffmpeg: 'ffmpeg version 6.1' });
    expect(asked).toEqual(['ffmpeg', 'exiftool']);
  });

  it('adds no versions key when nothing was captured (a stock node’s probe is unchanged)', () => {
    const result = probeCapabilities({ hasBinary: () => true });

    expect(result).not.toHaveProperty('versions');
    expect(Object.keys(result)).toEqual(['platform', 'arch', 'nodeVersion', 'cpus', 'totalMemoryMb', 'freeMemoryMb', 'binaries', 'capabilities']);
  });

  it('really runs a registered version command, cuts it to its first line and strips control bytes', () => {
    registerProbedBinary('node', { versionArgs: ['--version'] });
    const result = probeCapabilities({ binaries: ['node'], hasBinary: () => true });

    expect(result.versions?.node).toBe(process.version);
  });

  it('never throws when the version command fails or is missing', () => {
    registerProbedBinary('definitely-not-a-real-binary-xyz', { versionArgs: ['--version'] });

    expect(() => probeCapabilities({ binaries: ['definitely-not-a-real-binary-xyz'], hasBinary: () => true })).not.toThrow();
    expect(probeCapabilities({ binaries: ['definitely-not-a-real-binary-xyz'], hasBinary: () => true })).not.toHaveProperty('versions');
  });

  it('replaces the versionArgs of a binary registered twice, without listing it twice', () => {
    registerProbedBinary('ffmpeg', { versionArgs: ['-version'] });
    registerProbedBinary('ffmpeg', { versionArgs: ['--version'] });

    expect(PROBED_BINARIES.filter((name) => name === 'ffmpeg')).toHaveLength(1);
  });

  it('refuses a name that is not a bare command, and versionArgs out of bounds', () => {
    for (const name of ['', '-rf', '../bin/x', '/usr/bin/x', 'a b', 'a;b', 'x'.repeat(65), 'a\nb']) {
      expect(() => registerProbedBinary(name)).toThrow(/bare command name/);
    }
    expect(() => registerProbedBinary('x', { versionArgs: ['1', '2', '3', '4', '5'] })).toThrow(/versionArgs/);
    expect(() => registerProbedBinary('x', { versionArgs: ['a'.repeat(33)] })).toThrow(/versionArgs/);
    expect(() => registerProbedBinary('x', { versionArgs: [''] })).toThrow(/versionArgs/);
    expect(() => registerProbedBinary('x', { versionArgs: ['bad\narg'] })).toThrow(/versionArgs/);
  });

  it('registers a requirement the self-test then enforces, naming the type', () => {
    registerJobRequirement('app.transcode', {
      required: [binaryCapability('ffmpeg')],
      degradable: [binaryCapability('exiftool')],
    });

    const missing = runStartupSelfTest({ types: ['app.transcode'], probe: probe([]) });
    expect(missing.ok).toBe(false);
    expect(missing.missingRequired).toEqual([{ type: 'app.transcode', capability: 'binary:ffmpeg' }]);
    expect(missing.missingDegradable).toEqual([{ type: 'app.transcode', capability: 'binary:exiftool' }]);

    expect(runStartupSelfTest({ types: ['app.transcode'], probe: probe(['binary:ffmpeg']) }).ok).toBe(true);
  });

  it('registers every binary: capability it names as probed, so the requirement is satisfiable on a complete install', () => {
    registerJobRequirement('app.transcode', { required: [binaryCapability('ffmpeg')], degradable: [binaryCapability('exiftool')] });

    expect(PROBED_BINARIES).toEqual(expect.arrayContaining(['ffmpeg', 'exiftool']));
    expect(probeCapabilities({ hasBinary: () => true }).capabilities).toEqual(expect.arrayContaining(['binary:ffmpeg', 'binary:exiftool']));
  });

  it('does not touch a binary already registered with versionArgs when a requirement names it', () => {
    registerProbedBinary('ffmpeg', { versionArgs: ['-version'] });
    registerJobRequirement('app.transcode', { required: [binaryCapability('ffmpeg')] });
    const asked: string[] = [];

    probeCapabilities({ binaries: ['ffmpeg'], hasBinary: () => true, readVersion: (name) => { asked.push(name); return 'v'; } });

    expect(asked).toEqual(['ffmpeg']);
  });

  it('keeps the platform’s db.backup.run requirement intact', () => {
    registerJobRequirement('app.transcode', { required: [] });

    expect(JOB_TYPE_REQUIREMENTS['db.backup.run']).toEqual({ required: ['binary:pg_dump'], degradable: ['binary:psql'] });
  });

  it('refuses an empty type, a blank key and a binary: key that is not a command', () => {
    expect(() => registerJobRequirement(' ', { required: [] })).toThrow(/job type/);
    expect(() => registerJobRequirement('app.x', { required: [' '] })).toThrow(/non-empty/);
    expect(() => registerJobRequirement('app.x', { required: ['binary:../x'] })).toThrow(/bare command/);
    expect(() => registerJobRequirement('app.x', { required: [], degradable: ['binary:a b'] })).toThrow(/bare command/);
    expect(JOB_TYPE_REQUIREMENTS['app.x']).toBeUndefined();
  });

  it('accepts a non-binary capability key and registers nothing to probe for it', () => {
    registerJobRequirement('app.gpu', { required: ['gpu:cuda'] });

    expect(PROBED_BINARIES).toEqual(['pg_dump', 'psql']);
    expect(JOB_TYPE_REQUIREMENTS['app.gpu']).toEqual({ required: ['gpu:cuda'], degradable: [] });
  });
});
