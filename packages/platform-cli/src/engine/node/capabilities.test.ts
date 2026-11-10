import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  binaryCapability,
  evaluateCapabilities,
  httpServiceCapability,
  JOB_TYPE_REQUIREMENTS,
  listCapabilityProbes,
  moduleCapability,
  probeCapabilities,
  PROBED_BINARIES,
  registerCapabilityProbe,
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
  it('never throws, even when the binary lookup explodes', async () => {
    // A probe that can fail turns a diagnostic command into another thing to
    // diagnose.
    await expect(
      probeCapabilities({
        binaries: ['ffmpeg'],
        hasBinary: () => {
          throw new Error('exec is not available in this sandbox');
        },
      }),
    ).resolves.toBeDefined();
  });

  it('reports a found binary as a capability key', async () => {
    const result = await probeCapabilities({ binaries: ['ffmpeg'], hasBinary: () => true });
    expect(result.capabilities).toContain('binary:ffmpeg');
    expect(result.binaries.ffmpeg).toBe(true);
  });

  it('reports real machine facts', async () => {
    const result = await probeCapabilities();
    expect(result.cpus).toBeGreaterThan(0);
    expect(result.nodeVersion).toBe(process.version);
  });
});

describe('evaluateCapabilities', () => {
  it('passes when nothing is required', async () => {
    expect(evaluateCapabilities(['example.checksum'], probe([]), REQUIREMENTS).ok).toBe(true);
  });

  it('fails on a missing REQUIRED capability, naming both it and the type', async () => {
    const result = evaluateCapabilities(['video.transcode'], probe([]), REQUIREMENTS);
    expect(result.ok).toBe(false);
    expect(result.missingRequired).toContainEqual({ type: 'video.transcode', capability: 'binary:ffmpeg' });
  });

  it('does not fail on a missing DEGRADABLE capability', async () => {
    const result = evaluateCapabilities(['video.transcode'], probe(['binary:ffmpeg']), REQUIREMENTS);
    expect(result.ok).toBe(true);
    expect(result.missingDegradable).toContainEqual({ type: 'video.transcode', capability: 'binary:exiftool' });
  });

  it('ignores a type with no declared requirements', async () => {
    expect(evaluateCapabilities(['some.fork.type'], probe([]), REQUIREMENTS).ok).toBe(true);
  });
});

describe('runStartupSelfTest', () => {
  it('reports a hard failure naming the capability and the type', async () => {
    const failures: string[] = [];
    const warnings: string[] = [];

    const result = await runStartupSelfTest({
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

  it('warns and continues for a degradable gap', async () => {
    const failures: string[] = [];
    const warnings: string[] = [];

    const result = await runStartupSelfTest({
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
  it('REFUSES to declare the type on a machine with no `pg_dump`', async () => {
    // ⚠ THE FAILURE THIS PREVENTS IS THE EXPENSIVE ONE. `db.backup.run`
    // carries `maxAttempts: 1`, so a node that claims it and fails it does not
    // get a retry — the deployment simply has no backup that night, and finds
    // out during a restore.
    const result = evaluateCapabilities(['db.backup.run'], {
      ...await probeOf({ pg_dump: false, psql: false }),
    });

    expect(result.ok).toBe(false);
    expect(result.missingRequired).toEqual([
      { type: 'db.backup.run', capability: 'binary:pg_dump' },
    ]);
  });

  it('runs WITHOUT `psql`, reporting reduced function — two audit fields, not a backup', async () => {
    // The template's worked example of the degradable tier: the executor uses
    // `psql` only to read the server version and the newest migration, and a
    // node that refused to back the database up because it could not report a
    // version string would be trading the backup for a label.
    const result = evaluateCapabilities(['db.backup.run'], await probeOf({ pg_dump: true, psql: false }));

    expect(result.ok).toBe(true);
    expect(result.missingDegradable).toEqual([
      { type: 'db.backup.run', capability: 'binary:psql' },
    ]);
  });

  it('is satisfied when both are present', async () => {
    const result = evaluateCapabilities(['db.backup.run'], await probeOf({ pg_dump: true, psql: true }));

    expect(result.ok).toBe(true);
    expect(result.missingDegradable).toEqual([]);
  });

  it('probes every binary any requirement names — the two lists move together', async () => {
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
async function probeOf(binaries: Record<string, boolean>): Promise<CapabilityProbe> {
  return probeCapabilities({
    binaries: Object.keys(binaries),
    hasBinary: (name) => binaries[name] === true,
  });
}

describe('registerProbedBinary and registerJobRequirement (PP-14.19)', () => {
  afterEach(() => resetCapabilityRegistriesForTests());

  it('starts with the platform’s own binaries and requirement, and a reset returns to exactly that', async () => {
    const before = { binaries: [...PROBED_BINARIES], types: Object.keys(JOB_TYPE_REQUIREMENTS).sort() };
    registerProbedBinary('ffmpeg', { versionArgs: ['-version'] });
    registerJobRequirement('app.thing', { required: [binaryCapability('exiftool')] });

    resetCapabilityRegistriesForTests();

    expect(PROBED_BINARIES).toEqual(before.binaries);
    expect(PROBED_BINARIES).toEqual(['pg_dump', 'psql']);
    expect(Object.keys(JOB_TYPE_REQUIREMENTS).sort()).toEqual(before.types);
  });

  it('probes a registered binary, so a requirement naming it can be satisfied', async () => {
    registerProbedBinary('ffmpeg');
    const result = await probeCapabilities({ hasBinary: (name) => name === 'ffmpeg' });

    expect(result.binaries).toMatchObject({ ffmpeg: true, pg_dump: false, psql: false });
    expect(result.capabilities).toEqual(['binary:ffmpeg']);
  });

  it('captures a version banner for a found binary that has versionArgs, and none for one that does not', async () => {
    registerProbedBinary('ffmpeg', { versionArgs: ['-version'] });
    registerProbedBinary('exiftool');
    const asked: string[] = [];

    const result = await probeCapabilities({
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

  it('adds no versions key when nothing was captured (a stock node’s probe is unchanged)', async () => {
    const result = await probeCapabilities({ hasBinary: () => true });

    expect(result).not.toHaveProperty('versions');
    expect(Object.keys(result)).toEqual(['platform', 'arch', 'nodeVersion', 'cpus', 'totalMemoryMb', 'freeMemoryMb', 'binaries', 'capabilities']);
  });

  it('really runs a registered version command, cuts it to its first line and strips control bytes', async () => {
    registerProbedBinary('node', { versionArgs: ['--version'] });
    const result = await probeCapabilities({ binaries: ['node'], hasBinary: () => true });

    expect(result.versions?.node).toBe(process.version);
  });

  it('never throws when the version command fails or is missing', async () => {
    registerProbedBinary('definitely-not-a-real-binary-xyz', { versionArgs: ['--version'] });

    const result = await probeCapabilities({ binaries: ['definitely-not-a-real-binary-xyz'], hasBinary: () => true });
    expect(result).not.toHaveProperty('versions');
  });

  it('replaces the versionArgs of a binary registered twice, without listing it twice', async () => {
    registerProbedBinary('ffmpeg', { versionArgs: ['-version'] });
    registerProbedBinary('ffmpeg', { versionArgs: ['--version'] });

    expect(PROBED_BINARIES.filter((name) => name === 'ffmpeg')).toHaveLength(1);
  });

  it('refuses a name that is not a bare command, and versionArgs out of bounds', async () => {
    for (const name of ['', '-rf', '../bin/x', '/usr/bin/x', 'a b', 'a;b', 'x'.repeat(65), 'a\nb']) {
      expect(() => registerProbedBinary(name)).toThrow(/bare command name/);
    }
    expect(() => registerProbedBinary('x', { versionArgs: ['1', '2', '3', '4', '5'] })).toThrow(/versionArgs/);
    expect(() => registerProbedBinary('x', { versionArgs: ['a'.repeat(33)] })).toThrow(/versionArgs/);
    expect(() => registerProbedBinary('x', { versionArgs: [''] })).toThrow(/versionArgs/);
    expect(() => registerProbedBinary('x', { versionArgs: ['bad\narg'] })).toThrow(/versionArgs/);
  });

  it('registers a requirement the self-test then enforces, naming the type', async () => {
    registerJobRequirement('app.transcode', {
      required: [binaryCapability('ffmpeg')],
      degradable: [binaryCapability('exiftool')],
    });

    const missing = await runStartupSelfTest({ types: ['app.transcode'], probe: probe([]) });
    expect(missing.ok).toBe(false);
    expect(missing.missingRequired).toEqual([{ type: 'app.transcode', capability: 'binary:ffmpeg' }]);
    expect(missing.missingDegradable).toEqual([{ type: 'app.transcode', capability: 'binary:exiftool' }]);

    expect((await runStartupSelfTest({ types: ['app.transcode'], probe: probe(['binary:ffmpeg']) })).ok).toBe(true);
  });

  it('registers every binary: capability it names as probed, so the requirement is satisfiable on a complete install', async () => {
    registerJobRequirement('app.transcode', { required: [binaryCapability('ffmpeg')], degradable: [binaryCapability('exiftool')] });

    expect(PROBED_BINARIES).toEqual(expect.arrayContaining(['ffmpeg', 'exiftool']));
    expect((await probeCapabilities({ hasBinary: () => true })).capabilities).toEqual(expect.arrayContaining(['binary:ffmpeg', 'binary:exiftool']));
  });

  it('does not touch a binary already registered with versionArgs when a requirement names it', async () => {
    registerProbedBinary('ffmpeg', { versionArgs: ['-version'] });
    registerJobRequirement('app.transcode', { required: [binaryCapability('ffmpeg')] });
    const asked: string[] = [];

    await probeCapabilities({ binaries: ['ffmpeg'], hasBinary: () => true, readVersion: (name) => { asked.push(name); return 'v'; } });

    expect(asked).toEqual(['ffmpeg']);
  });

  it('keeps the platform’s db.backup.run requirement intact', async () => {
    registerJobRequirement('app.transcode', { required: [] });

    expect(JOB_TYPE_REQUIREMENTS['db.backup.run']).toEqual({ required: ['binary:pg_dump'], degradable: ['binary:psql'] });
  });

  it('refuses an empty type, a blank key and a binary: key that is not a command', async () => {
    expect(() => registerJobRequirement(' ', { required: [] })).toThrow(/job type/);
    expect(() => registerJobRequirement('app.x', { required: [' '] })).toThrow(/non-empty/);
    expect(() => registerJobRequirement('app.x', { required: ['binary:../x'] })).toThrow(/bare command/);
    expect(() => registerJobRequirement('app.x', { required: [], degradable: ['binary:a b'] })).toThrow(/bare command/);
    expect(JOB_TYPE_REQUIREMENTS['app.x']).toBeUndefined();
  });

  it('accepts a non-binary capability key and registers nothing to probe for it', async () => {
    registerJobRequirement('app.gpu', { required: ['gpu:cuda'] });

    expect(PROBED_BINARIES).toEqual(['pg_dump', 'psql']);
    expect(JOB_TYPE_REQUIREMENTS['app.gpu']).toEqual({ required: ['gpu:cuda'], degradable: [] });
  });
});

// =============================================================================
// Module and service probes  (RETRO-G2.4, #1074)
// =============================================================================

describe('registerCapabilityProbe', () => {
  afterEach(() => resetCapabilityRegistriesForTests());

  it('runs registered probes, lists available ones as capabilities, and reports each outcome', async () => {
    registerCapabilityProbe({ key: 'module:alpha', label: 'Alpha', probe: () => ({ status: 'available', version: '1.2.3' }) });
    registerCapabilityProbe({ key: 'service:beta', label: 'Beta', probe: () => ({ status: 'installed', detail: 'answers HTTP 503' }) });
    registerCapabilityProbe({ key: 'custom:gamma', label: 'Gamma', probe: () => ({ status: 'missing' }) });

    const result = await probeCapabilities({ binaries: [] });

    expect(result.capabilities).toEqual(['module:alpha']);
    expect(result.probes).toEqual({
      'module:alpha': { label: 'Alpha', status: 'available', version: '1.2.3' },
      'service:beta': { label: 'Beta', status: 'installed', detail: 'answers HTTP 503' },
      'custom:gamma': { label: 'Gamma', status: 'missing' },
    });
  });

  it('turns a throwing probe and a probe that outlives its budget into missing, never an exception', async () => {
    registerCapabilityProbe({ key: 'module:boom', label: 'Boom', probe: () => { throw new Error('kaput'); } });
    registerCapabilityProbe({ key: 'service:slow', label: 'Slow', timeoutMs: 20, probe: () => new Promise(() => {}) });

    const result = await probeCapabilities({ binaries: [] });

    expect(result.probes?.['module:boom']).toMatchObject({ status: 'missing', detail: expect.stringContaining('kaput') });
    expect(result.probes?.['service:slow']).toMatchObject({ status: 'missing', detail: expect.stringContaining('within 20 ms') });
    expect(result.capabilities).toEqual([]);
  });

  it('reuses a cached result only when asked to, and never at startup', async () => {
    let calls = 0;
    registerCapabilityProbe({ key: 'service:cached', label: 'C', cacheMs: 60_000, probe: () => ({ status: calls++ === 0 ? 'available' : 'missing' }) });

    await probeCapabilities({ binaries: [] });
    const refreshed = await probeCapabilities({ binaries: [], useCache: true });
    const fresh = await probeCapabilities({ binaries: [] });

    expect(refreshed.probes?.['service:cached']?.status).toBe('available');
    expect(fresh.probes?.['service:cached']?.status).toBe('missing');
    expect(calls).toBe(2);
  });

  it('cuts the detail to printable text of at most 200 characters', async () => {
    registerCapabilityProbe({ key: 'service:noisy', label: 'N', probe: () => ({ status: 'missing', detail: `line\n\u0007${'x'.repeat(500)}` }) });

    const detail = (await probeCapabilities({ binaries: [] })).probes?.['service:noisy']?.detail ?? '';

    expect(detail.length).toBeLessThanOrEqual(200);
    expect(detail).not.toMatch(/[\n\u0007]/);
  });

  it('refuses a malformed or binary: key, a duplicate, and a missing label or function', () => {
    const ok = { label: 'L', probe: () => ({ status: 'available' as const }) };
    expect(() => registerCapabilityProbe({ key: 'nokind', ...ok })).toThrow(/<kind>:<name>/);
    expect(() => registerCapabilityProbe({ key: 'binary:ffmpeg', ...ok })).toThrow(/reserved/);
    expect(() => registerCapabilityProbe({ key: 'module:x', label: '', probe: ok.probe })).toThrow(/label/);
    expect(() => registerCapabilityProbe({ key: 'module:x', label: 'L', probe: undefined as never })).toThrow(/probe/);
    registerCapabilityProbe({ key: 'module:x', ...ok });
    expect(() => registerCapabilityProbe({ key: 'module:x', ...ok })).toThrow(/already registered/);
  });
});

describe('moduleCapability', () => {
  it('resolves a real module without importing it, and reports a missing one', async () => {
    const present = await moduleCapability('vitest').probe({ env: {}, signal: new AbortController().signal });
    const absent = await moduleCapability('definitely-not-installed-xyz').probe({ env: {}, signal: new AbortController().signal });

    expect(present.status).toBe('available');
    expect(present.version).toMatch(/^\d+\./);
    expect(absent).toEqual({ status: 'missing', detail: 'definitely-not-installed-xyz is not installed' });
  });

  it('never executes the module: resolving a module whose top-level code throws still succeeds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cap-mod-'));
    try {
      mkdirSync(join(dir, 'node_modules', 'explodes'), { recursive: true });
      writeFileSync(join(dir, 'node_modules', 'explodes', 'package.json'), JSON.stringify({ name: 'explodes', version: '9.9.9', main: 'index.js' }));
      writeFileSync(join(dir, 'node_modules', 'explodes', 'index.js'), "throw new Error('top-level code ran');\n");

      const result = await moduleCapability('explodes', { resolveFrom: join(dir, 'x.js') }).probe({ env: {}, signal: new AbortController().signal });

      expect(result).toEqual({ status: 'available', version: '9.9.9' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('separates installed from operational with an operational check', async () => {
    const context = { env: {}, signal: new AbortController().signal };
    const failing = await moduleCapability('vitest', { operational: () => { throw new Error('native binding failed to load'); } }).probe(context);
    const refused = await moduleCapability('vitest', { operational: () => 'no GPU' }).probe(context);
    const passing = await moduleCapability('vitest', { operational: async () => true }).probe(context);

    expect(failing).toMatchObject({ status: 'installed', detail: expect.stringContaining('native binding failed to load') });
    expect(refused).toMatchObject({ status: 'installed', detail: 'no GPU' });
    expect(passing.status).toBe('available');
  });

  it('refuses a name that is not an npm package name', () => {
    expect(() => moduleCapability('../x')).toThrow(/npm package name/);
    expect(() => moduleCapability('')).toThrow(/npm package name/);
  });
});

describe('httpServiceCapability', () => {
  const signal = new AbortController().signal;
  const answer = (status: number) => (async () => new Response('', { status })) as unknown as typeof fetch;

  it('maps 2xx to available, another HTTP answer to installed, and a connection error to missing', async () => {
    const base = { id: 'ocr', url: 'http://ocr.example.test:9000', path: '/status' };

    expect(await httpServiceCapability({ ...base, fetch: answer(200) }).probe({ env: {}, signal })).toMatchObject({ status: 'available' });
    expect(await httpServiceCapability({ ...base, fetch: answer(503) }).probe({ env: {}, signal })).toMatchObject({ status: 'installed', detail: expect.stringContaining('HTTP 503') });
    const down = await httpServiceCapability({ ...base, fetch: (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch }).probe({ env: {}, signal });
    expect(down).toMatchObject({ status: 'missing', detail: expect.stringContaining('ECONNREFUSED') });
  });

  it('reads the base URL from the named env var at probe time, and reports an unset one as missing', async () => {
    const requested: string[] = [];
    const definition = httpServiceCapability({
      id: 'ocr',
      env: 'APP_OCR_URL',
      path: 'health',
      fetch: (async (target: URL) => { requested.push(String(target)); return new Response('', { status: 200 }); }) as unknown as typeof fetch,
    });

    expect(await definition.probe({ env: {}, signal })).toEqual({ status: 'missing', detail: 'APP_OCR_URL is not set' });
    expect(await definition.probe({ env: { APP_OCR_URL: 'http://ocr.example.test:9000/base' }, signal })).toMatchObject({ status: 'available' });
    expect(requested).toEqual(['http://ocr.example.test:9000/base/health']);
  });

  it('times out into missing and never shows credentials or a query string', async () => {
    const hang = ((_target: URL, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))) as unknown as typeof fetch;

    const result = await httpServiceCapability({ id: 'slow', url: 'http://user:secret@svc.example.test/x?token=abc', path: '/', timeoutMs: 30, fetch: hang }).probe({ env: {}, signal });

    expect(result.status).toBe('missing');
    expect(result.detail).toContain('no answer within 30 ms');
    expect(result.detail).not.toMatch(/secret|token|user:/);
  });

  it('refuses a bad id or no URL source', () => {
    expect(() => httpServiceCapability({ id: 'Bad Id', url: 'http://x' })).toThrow(/service id/);
    expect(() => httpServiceCapability({ id: 'ok' })).toThrow(/url or the name/);
  });
});

describe('module and service keys in job requirements', () => {
  afterEach(() => resetCapabilityRegistriesForTests());

  it('auto-registers a module probe for a module: key, and lets an explicit registration replace it', async () => {
    registerJobRequirement('app.ocr', { required: ['module:vitest'], degradable: ['module:definitely-not-installed-xyz'] });

    expect(listCapabilityProbes().map((p) => p.key)).toEqual(['module:vitest', 'module:definitely-not-installed-xyz']);
    registerCapabilityProbe(moduleCapability('vitest', { label: 'Custom label' }));
    expect(listCapabilityProbes()[0]?.label).toBe('Custom label');
  });

  it('stops a node whose required module is absent, naming the key, and only warns for a degradable one', async () => {
    registerJobRequirement('app.ocr', { required: ['module:definitely-not-installed-xyz'], degradable: ['module:vitest-missing-too'] });
    const failures: string[] = [];
    const warnings: string[] = [];

    const result = await runStartupSelfTest({ types: ['app.ocr'], fail: (m) => failures.push(m), warn: (m) => warnings.push(m) });

    expect(result.ok).toBe(false);
    expect(failures.join('\n')).toContain('module:definitely-not-installed-xyz');
    expect(failures.join('\n')).toContain('definitely-not-installed-xyz is not installed');
    expect(warnings.join('\n')).toContain('module:vitest-missing-too');
  });

  it('a required capability that is installed but not operational blocks startup and says so; a degradable one only warns', async () => {
    registerCapabilityProbe({ key: 'module:native', label: 'Native', probe: () => ({ status: 'installed', detail: 'binding failed to load' }) });
    registerCapabilityProbe({ key: 'service:side', label: 'Side', probe: () => ({ status: 'installed', detail: 'answers HTTP 500' }) });
    registerJobRequirement('app.hard', { required: ['module:native'] });
    registerJobRequirement('app.soft', { required: [], degradable: ['service:side'] });
    const failures: string[] = [];
    const warnings: string[] = [];

    const hard = await runStartupSelfTest({ types: ['app.hard'], fail: (m) => failures.push(m) });
    const soft = await runStartupSelfTest({ types: ['app.soft'], warn: (m) => warnings.push(m) });

    expect(hard.ok).toBe(false);
    expect(hard.missingRequired).toEqual([{ type: 'app.hard', capability: 'module:native', state: 'installed', detail: 'binding failed to load' }]);
    expect(failures.join('\n')).toMatch(/installed but not operational \(binding failed to load\)/);
    expect(soft.ok).toBe(true);
    expect(warnings.join('\n')).toMatch(/installed but not operational on this machine \(answers HTTP 500\)/);
  });

  it('a required service key with no registered probe can never be satisfied, and says why', async () => {
    registerJobRequirement('app.svc', { required: ['service:nowhere'] });

    const result = evaluateCapabilities(['app.svc'], await probeCapabilities({ binaries: [] }));

    expect(result.missingRequired).toEqual([{ type: 'app.svc', capability: 'service:nowhere', detail: 'no probe is registered for this capability' }]);
  });

  it('a required service gates the self-test while it is down and passes once it recovers', async () => {
    let up = false;
    registerCapabilityProbe({ key: 'service:ocr', label: 'OCR', probe: () => ({ status: up ? 'available' : 'missing' }) });
    registerJobRequirement('app.ocr', { required: ['service:ocr'] });

    expect((await runStartupSelfTest({ types: ['app.ocr'] })).ok).toBe(false);
    up = true;
    expect((await runStartupSelfTest({ types: ['app.ocr'] })).ok).toBe(true);
  });
});
