import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import {
  bodyChecksum,
  checkInfra,
  INFRA_FRAGMENTS,
  generatedHeader,
  LOCK_PATH,
  splitGenerated,
  syncInfra,
  type InfraLock,
} from './sync.js';
import { telemetryInfraFragment, type InfraFragment } from './telemetry/index.js';

const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const REPO_ROOT = join(PACKAGE_ROOT, '..', '..');
const VERSION = (JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as { version: string }).version;
const GENERATED = telemetryInfraFragment.files.map((file) => file.to);
const OVERLAY = telemetryInfraFragment.collectorConfigs.app;
/** These cases are about the mechanism, shown on the telemetry fragment alone (platform-fragments.test.ts covers the rest). */
const TELEMETRY_ONLY = { fragments: [telemetryInfraFragment] };

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const packageFile = (from: string): string => readFileSync(join(PACKAGE_ROOT, from), 'utf8');

let app: string;
const read = (to: string): string => readFileSync(join(app, to), 'utf8');
const write = (to: string, text: string): void => writeFileSync(join(app, to), text, 'utf8');
const readLock = (): InfraLock => JSON.parse(read(LOCK_PATH)) as InfraLock;

beforeEach(() => {
  app = mkdtempSync(join(tmpdir(), 'platform-infra-sync-'));
});

afterEach(() => {
  rmSync(app, { recursive: true, force: true });
});

describe('syncInfra()', () => {
  it('copies every generated file with a header, then the package content verbatim', () => {
    const result = syncInfra({ ...TELEMETRY_ONLY, root: app });

    expect(result.written).toEqual(GENERATED);
    for (const file of telemetryInfraFragment.files) {
      const text = read(file.to);
      const lines = text.split('\n');
      expect(lines[0]).toBe(
        `# GENERATED from @marinoscar/platform-infra@${VERSION} (telemetry) — do not edit; extend through infra/otel/app-collector.yaml or a compose overlay`,
      );
      expect(lines[1]).toBe(
        `# Source of truth: @marinoscar/platform-infra/${file.from}; re-materialise with \`npx platform-infra sync\``,
      );
      // Comments elsewhere are kept verbatim: the body IS the package file.
      expect(text.slice(lines[0]!.length + lines[1]!.length + 2)).toBe(packageFile(file.from));
    }
  });

  it('writes the lock with the version and the sha256 of each body (content after the header)', () => {
    syncInfra({ ...TELEMETRY_ONLY, root: app });

    const lock = readLock();
    expect(lock.version).toBe(VERSION);
    expect(Object.keys(lock.fragments)).toEqual(['telemetry']);
    const files = lock.fragments['telemetry']!.files;
    expect(Object.keys(files)).toEqual(GENERATED);
    for (const file of telemetryInfraFragment.files) {
      expect(files[file.to]).toBe(sha256(packageFile(file.from)));
      expect(files[file.to]).toBe(sha256(splitGenerated(read(file.to)).body));
    }
    expect(read(LOCK_PATH).endsWith('}\n')).toBe(true);
  });

  it('creates the app-owned overlay from the example only when it is absent', () => {
    const first = syncInfra({ ...TELEMETRY_ONLY, root: app });
    expect(first.created).toEqual([OVERLAY]);
    expect(read(OVERLAY)).toBe(packageFile('telemetry/otel/app-collector.example.yaml'));
    // The overlay is the app's: no generated header, and not in the lock.
    expect(splitGenerated(read(OVERLAY)).header).toBeUndefined();
    expect(readLock().fragments['telemetry']!.files[OVERLAY]).toBeUndefined();
  });

  it('never overwrites the app-owned overlay', () => {
    syncInfra({ ...TELEMETRY_ONLY, root: app });
    const mine = 'service:\n  pipelines:\n    metrics/app:\n      receivers: [otlp]\n';
    write(OVERLAY, mine);

    const again = syncInfra({ ...TELEMETRY_ONLY, root: app });

    expect(again.created).toEqual([]);
    expect(again.kept).toEqual([OVERLAY]);
    expect(read(OVERLAY)).toBe(mine);
  });

  it('is idempotent: a second run writes nothing and changes no byte', () => {
    syncInfra({ ...TELEMETRY_ONLY, root: app });
    const before = new Map([...GENERATED, LOCK_PATH, OVERLAY].map((to) => [to, read(to)]));
    const mtimes = new Map(GENERATED.map((to) => [to, statSync(join(app, to)).mtimeMs]));

    const again = syncInfra({ ...TELEMETRY_ONLY, root: app });

    expect(again.written).toEqual([]);
    expect(again.unchanged).toEqual(GENERATED);
    expect(again.lockWritten).toBe(false);
    for (const [to, text] of before) expect(read(to), to).toBe(text);
    for (const [to, mtime] of mtimes) expect(statSync(join(app, to)).mtimeMs, to).toBe(mtime);
  });

  it('restores a hand-edited generated file', () => {
    syncInfra({ ...TELEMETRY_ONLY, root: app });
    const original = read('infra/compose/vps.telemetry.compose.yml');
    write('infra/compose/vps.telemetry.compose.yml', original.replace('memory: 256M', 'memory: 512M'));

    const result = syncInfra({ ...TELEMETRY_ONLY, root: app });

    expect(result.written).toEqual(['infra/compose/vps.telemetry.compose.yml']);
    expect(read('infra/compose/vps.telemetry.compose.yml')).toBe(original);
  });

  it('fails before writing anything when a package file is missing', () => {
    const pkg = fakePackage();
    rmSync(join(pkg, 'telemetry', 'otel', 'otel-collector-config.yaml'));

    expect(() => syncInfra({ ...TELEMETRY_ONLY, root: app, packageRoot: pkg })).toThrow(/ENOENT/);
    expect(existsSync(join(app, 'infra'))).toBe(false);
  });

  it('refuses a manifest that would generate an app-owned file', () => {
    const bad: InfraFragment = {
      ...telemetryInfraFragment,
      files: [...telemetryInfraFragment.files, { from: 'telemetry/otel/app-collector.example.yaml', to: OVERLAY }],
    };
    expect(() => syncInfra({ ...TELEMETRY_ONLY, root: app, fragments: [bad] })).toThrow(/app-owned and never overwritten/);
  });

  it.each(['../escape.yml', '/etc/escape.yml', 'infra/../../escape.yml'])('refuses the app path %s', (to) => {
    const bad: InfraFragment = {
      ...telemetryInfraFragment,
      files: [{ from: 'telemetry/compose/telemetry.compose.yml', to }],
    };
    expect(() => syncInfra({ ...TELEMETRY_ONLY, root: app, fragments: [bad] })).toThrow(/app root/);
  });

  it('refuses a package path that leaves the package', () => {
    const bad: InfraFragment = {
      ...telemetryInfraFragment,
      files: [{ from: '../platform-api/package.json', to: 'infra/x.yml' }],
    };
    expect(() => syncInfra({ ...TELEMETRY_ONLY, root: app, fragments: [bad] })).toThrow(/outside @marinoscar\/platform-infra/);
  });

  it('refuses a generated file whose syntax has no comments', () => {
    const bad: InfraFragment = {
      ...telemetryInfraFragment,
      files: [{ from: 'package.json', to: 'infra/x.json' }],
      appOwnedFiles: [],
    };
    expect(() => syncInfra({ ...TELEMETRY_ONLY, root: app, fragments: [bad] })).toThrow(/no comment syntax/);
  });
});

describe('checkInfra() (`sync --check`)', () => {
  it('passes right after a sync', () => {
    syncInfra({ ...TELEMETRY_ONLY, root: app });
    const result = checkInfra({ ...TELEMETRY_ONLY, root: app });
    expect(result.problems).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.checked).toEqual(GENERATED);
  });

  it.each(GENERATED)('fails on a hand edit of %s, naming the file, the line and the fix', (to) => {
    syncInfra({ ...TELEMETRY_ONLY, root: app });
    const lines = read(to).split('\n');
    lines.splice(10, 0, '# a local tweak');
    write(to, lines.join('\n'));

    const { problems } = checkInfra({ ...TELEMETRY_ONLY, root: app });

    expect(problems).toHaveLength(1);
    expect(problems[0]!.file).toBe(`${to}:11`);
    expect(problems[0]!.message).toContain(`differs from @marinoscar/platform-infra@${VERSION} (telemetry)`);
    expect(problems[0]!.message).toContain('run `npx platform-infra sync` to restore it');
    expect(problems[0]!.message).toContain('move your change into infra/otel/app-collector.yaml');
    expect(problems[0]!.message).toContain('compose overlay');
  });

  it('fails when the header was removed', () => {
    syncInfra({ ...TELEMETRY_ONLY, root: app });
    const to = 'infra/otel/otel-collector-config.yaml';
    write(to, splitGenerated(read(to)).body);

    const { problems } = checkInfra({ ...TELEMETRY_ONLY, root: app });
    expect(problems.map((p) => p.file)).toEqual([to]);
    expect(problems[0]!.message).toMatch(/no generated header/);
  });

  it('fails when a generated file is missing', () => {
    syncInfra({ ...TELEMETRY_ONLY, root: app });
    rmSync(join(app, 'infra/compose/telemetry.compose.yml'));

    const { problems } = checkInfra({ ...TELEMETRY_ONLY, root: app });
    expect(problems).toEqual([expect.objectContaining({ file: 'infra/compose/telemetry.compose.yml' })]);
    expect(problems[0]!.message).toMatch(/missing/);
  });

  it('fails when the app-owned overlay is missing (the collector mounts it)', () => {
    syncInfra({ ...TELEMETRY_ONLY, root: app });
    rmSync(join(app, OVERLAY));

    const { problems } = checkInfra({ ...TELEMETRY_ONLY, root: app });
    expect(problems).toEqual([expect.objectContaining({ file: OVERLAY })]);
    expect(problems[0]!.message).toContain('app-collector.example.yaml');
  });

  it('accepts any content in the app-owned overlay', () => {
    syncInfra({ ...TELEMETRY_ONLY, root: app });
    write(OVERLAY, 'receivers: {}\n');
    expect(checkInfra({ ...TELEMETRY_ONLY, root: app }).problems).toEqual([]);
  });

  it('fails when the lock is missing', () => {
    syncInfra({ ...TELEMETRY_ONLY, root: app });
    rmSync(join(app, LOCK_PATH));

    const { problems } = checkInfra({ ...TELEMETRY_ONLY, root: app });
    expect(problems).toEqual([expect.objectContaining({ file: LOCK_PATH })]);
  });

  it('fails when the lock checksum differs from the file', () => {
    syncInfra({ ...TELEMETRY_ONLY, root: app });
    const lock = readLock();
    lock.fragments['telemetry']!.files['infra/compose/telemetry.compose.yml'] = '0'.repeat(64);
    write(LOCK_PATH, JSON.stringify(lock));

    const { problems } = checkInfra({ ...TELEMETRY_ONLY, root: app });
    expect(problems).toHaveLength(1);
    expect(problems[0]!.file).toBe(LOCK_PATH);
    expect(problems[0]!.message).toContain('infra/compose/telemetry.compose.yml');
  });

  it('fails when the lock has no entry for a generated file', () => {
    syncInfra({ ...TELEMETRY_ONLY, root: app });
    const lock = readLock();
    delete lock.fragments['telemetry']!.files['infra/otel/otel-collector-config.yaml'];
    write(LOCK_PATH, JSON.stringify(lock));

    expect(checkInfra({ ...TELEMETRY_ONLY, root: app }).problems).toEqual([
      expect.objectContaining({ file: LOCK_PATH, message: expect.stringContaining('no checksum for infra/otel/otel-collector-config.yaml') }),
    ]);
  });

  it('fails when the package changed and the app was not re-synced', () => {
    syncInfra({ ...TELEMETRY_ONLY, root: app });
    const pkg = fakePackage();
    const config = join(pkg, 'telemetry', 'otel', 'otel-collector-config.yaml');
    writeFileSync(config, readFileSync(config, 'utf8').replace('limit_mib: 400', 'limit_mib: 500'));

    const { problems } = checkInfra({ ...TELEMETRY_ONLY, root: app, packageRoot: pkg });
    expect(problems.map((p) => p.file)).toEqual([expect.stringMatching(/^infra\/otel\/otel-collector-config\.yaml:\d+$/)]);
  });

  it('only warns when the content matches but the version moved on', () => {
    syncInfra({ ...TELEMETRY_ONLY, root: app, version: '0.0.0-old' });

    const result = checkInfra({ ...TELEMETRY_ONLY, root: app, version: '0.1.0' });

    expect(result.problems).toEqual([]);
    expect(result.warnings.map((w) => w.file).sort()).toEqual([...GENERATED, LOCK_PATH].sort());
    // A re-sync clears the warnings and touches only headers and the lock.
    syncInfra({ ...TELEMETRY_ONLY, root: app, version: '0.1.0' });
    expect(checkInfra({ ...TELEMETRY_ONLY, root: app, version: '0.1.0' }).warnings).toEqual([]);
  });

  it('does not read CRLF line endings as drift', () => {
    syncInfra({ ...TELEMETRY_ONLY, root: app });
    for (const to of GENERATED) write(to, read(to).replace(/\n/g, '\r\n'));
    expect(checkInfra({ ...TELEMETRY_ONLY, root: app }).problems).toEqual([]);
  });

  it('warns about a lock entry the fragment no longer generates', () => {
    syncInfra({ ...TELEMETRY_ONLY, root: app });
    const lock = readLock();
    lock.fragments['telemetry']!.files['infra/compose/gone.compose.yml'] = '0'.repeat(64);
    write(LOCK_PATH, JSON.stringify(lock));

    const result = checkInfra({ ...TELEMETRY_ONLY, root: app });
    expect(result.problems).toEqual([]);
    expect(result.warnings).toEqual([expect.objectContaining({ message: expect.stringContaining('gone.compose.yml') })]);
  });
});

describe('header helpers', () => {
  it('round-trips a header through splitGenerated()', () => {
    const file = telemetryInfraFragment.files[0]!;
    const header = generatedHeader(telemetryInfraFragment, file, '1.2.3');
    const split = splitGenerated(`${header}services: {}\n`);
    expect(split.header).toBe(header);
    expect(split.version).toBe('1.2.3');
    expect(split.body).toBe('services: {}\n');
  });

  it('hashes bodies independently of line endings', () => {
    expect(bodyChecksum('a\r\nb\n')).toBe(bodyChecksum('a\nb\n'));
  });
});

describe('this repository is its own first consumer', () => {
  it('has committed infra/ files that match the package and the lock', () => {
    const result = checkInfra({ root: REPO_ROOT });
    expect(result.problems).toEqual([]);
    expect(result.checked).toEqual(INFRA_FRAGMENTS.flatMap((fragment) => fragment.files.map((file) => file.to)));
    expect(result.checked).toEqual(expect.arrayContaining(GENERATED));
  });
});

/** A throwaway copy of this package's shipped files, to change without touching the real one. */
function fakePackage(): string {
  const pkg = mkdtempSync(join(tmpdir(), 'platform-infra-pkg-'));
  onTestFinished(() => rmSync(pkg, { recursive: true, force: true }));
  cpSync(join(PACKAGE_ROOT, 'telemetry'), join(pkg, 'telemetry'), { recursive: true });
  cpSync(join(PACKAGE_ROOT, 'package.json'), join(pkg, 'package.json'));
  return pkg;
}
