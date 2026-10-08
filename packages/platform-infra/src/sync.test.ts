import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
  materialise,
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

describe('executable scripts (`file.executable`)', () => {
  const SCRIPT_TO = 'infra/compose/init/10-role.sh';
  const SCRIPT_BODY = '#!/bin/sh\n# Creates the role.\nset -eu\necho one\necho two\necho three\necho four\necho five\necho six\necho seven\necho eight\n';
  const SCRIPTS: InfraFragment = {
    ...telemetryInfraFragment,
    id: 'telemetry',
    files: [...telemetryInfraFragment.files, { from: 'scripts/10-role.sh', to: SCRIPT_TO, executable: true }],
  };
  /** Mode bits are POSIX: on Windows sync neither sets nor checks them. */
  const posix = process.platform !== 'win32';
  const mode = (to: string): number => statSync(join(app, to)).mode & 0o777;

  let pkg: string;
  beforeEach(() => {
    pkg = fakePackage();
    mkdirSync(join(pkg, 'scripts'));
    // Shipped WITHOUT the executable bit: sync sets the mode from the
    // manifest, never from whatever mode an npm extraction left behind.
    writeFileSync(join(pkg, 'scripts', '10-role.sh'), SCRIPT_BODY, { mode: 0o644 });
  });
  const opts = (): { root: string; packageRoot: string; fragments: InfraFragment[] } => ({ root: app, packageRoot: pkg, fragments: [SCRIPTS] });

  it('keeps the shebang on line 1 and puts the generated header after it', () => {
    syncInfra(opts());
    const lines = read(SCRIPT_TO).split('\n');
    expect(lines[0]).toBe('#!/bin/sh');
    expect(lines[1]).toMatch(/^# GENERATED from @marinoscar\/platform-infra@/);
    expect(lines[2]).toBe('# Source of truth: @marinoscar/platform-infra/scripts/10-role.sh; re-materialise with `npx platform-infra sync`');
    expect(lines.slice(3).join('\n')).toBe(SCRIPT_BODY.slice('#!/bin/sh\n'.length));
    // The body (shebang included, header excluded) is the package file.
    expect(splitGenerated(read(SCRIPT_TO)).body).toBe(SCRIPT_BODY);
  });

  it.runIf(posix)('writes the script with mode 0755', () => {
    syncInfra(opts());
    expect(mode(SCRIPT_TO)).toBe(0o755);
  });

  it('records the script as executable in the lock, with the checksum of its body', () => {
    syncInfra(opts());
    const entry = readLock().fragments['telemetry']!;
    expect(entry.executable).toEqual([SCRIPT_TO]);
    expect(entry.files[SCRIPT_TO]).toBe(sha256(SCRIPT_BODY));
  });

  it('writes no `executable` key for a fragment without a script', () => {
    syncInfra({ ...TELEMETRY_ONLY, root: app });
    expect(readLock().fragments['telemetry']).not.toHaveProperty('executable');
  });

  it('is idempotent for a script, mode included', () => {
    syncInfra(opts());
    const again = syncInfra(opts());
    expect(again.written).toEqual([]);
    expect(again.lockWritten).toBe(false);
  });

  it.runIf(posix)('restores a lost executable bit even when the content is unchanged', () => {
    syncInfra(opts());
    chmodSync(join(app, SCRIPT_TO), 0o644);

    const result = syncInfra(opts());

    expect(result.written).toEqual([SCRIPT_TO]);
    expect(mode(SCRIPT_TO)).toBe(0o755);
    expect(checkInfra(opts()).problems).toEqual([]);
  });

  it('passes `--check` right after a sync', () => {
    syncInfra(opts());
    const result = checkInfra(opts());
    expect(result.problems).toEqual([]);
    expect(result.checked).toContain(SCRIPT_TO);
  });

  it.runIf(posix)('fails `--check` on a chmod -x, naming the file and the fix', () => {
    syncInfra(opts());
    chmodSync(join(app, SCRIPT_TO), 0o644);

    const result = checkInfra(opts());

    expect(result.problems).toEqual([{ file: SCRIPT_TO, message: expect.stringContaining('is not executable') }]);
    expect(result.problems[0]!.message).toContain('run `npx platform-infra sync` to restore it');
    expect(result.problems[0]!.message).toContain('git update-index --chmod=+x');
    expect(result.checked).not.toContain(SCRIPT_TO);
  });

  it.runIf(posix)('fails `--check` when only the owner execute bit is gone (the bit git records)', () => {
    syncInfra(opts());
    chmodSync(join(app, SCRIPT_TO), 0o655);
    expect(checkInfra(opts()).problems.map((p) => p.file)).toEqual([SCRIPT_TO]);
  });

  it('fails `--check` when the lock does not record the script as executable', () => {
    syncInfra(opts());
    const lock = readLock();
    delete lock.fragments['telemetry']!.executable;
    write(LOCK_PATH, JSON.stringify(lock));

    expect(checkInfra(opts()).problems).toEqual([
      { file: LOCK_PATH, message: expect.stringContaining(`does not record ${SCRIPT_TO} as executable`) },
    ]);
  });

  it('fails `--check` when the lock records a file as executable that is not generated as one', () => {
    syncInfra({ ...TELEMETRY_ONLY, root: app });
    const lock = readLock();
    lock.fragments['telemetry']!.executable = ['infra/compose/telemetry.compose.yml'];
    write(LOCK_PATH, JSON.stringify(lock));

    expect(checkInfra({ ...TELEMETRY_ONLY, root: app }).problems).toEqual([
      { file: LOCK_PATH, message: expect.stringContaining('records infra/compose/telemetry.compose.yml as executable') },
    ]);
  });

  it('reports a hand edit of a script with its line in the file (shebang first, header after)', () => {
    syncInfra(opts());
    const original = read(SCRIPT_TO);

    write(SCRIPT_TO, original.replace('#!/bin/sh', '#!/bin/bash'));
    expect(checkInfra(opts()).problems.map((p) => p.file)).toEqual([`${SCRIPT_TO}:1`]);

    const lines = original.split('\n');
    lines.splice(10, 0, 'echo local');
    write(SCRIPT_TO, lines.join('\n'));
    expect(checkInfra(opts()).problems.map((p) => p.file)).toEqual([`${SCRIPT_TO}:11`]);
  });

  it('fails `--check` when the header after the shebang was removed', () => {
    syncInfra(opts());
    write(SCRIPT_TO, SCRIPT_BODY);
    expect(checkInfra(opts()).problems).toEqual([{ file: SCRIPT_TO, message: expect.stringMatching(/no generated header/) }]);
  });

  it('refuses an executable file without a shebang, before writing anything', () => {
    writeFileSync(join(pkg, 'scripts', '10-role.sh'), 'set -eu\n');
    expect(() => syncInfra(opts())).toThrow(/first line must be a #! shebang/);
    expect(existsSync(join(app, 'infra'))).toBe(false);
  });

  it('refuses an app-owned file marked executable', () => {
    const bad: InfraFragment = {
      ...telemetryInfraFragment,
      appOwnedFiles: [{ from: 'scripts/10-role.sh', to: 'infra/compose/init/20-app.sh', executable: true }],
    };
    expect(() => syncInfra({ root: app, packageRoot: pkg, fragments: [bad] })).toThrow(/only a generated file can be/);
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

  it('round-trips a header after a shebang, keeping the shebang in the body', () => {
    const file = { from: 'compose/postgres-init/x.sh', to: 'infra/compose/postgres-init/x.sh', executable: true };
    const header = generatedHeader(telemetryInfraFragment, file, '1.2.3');
    const text = materialise(header, '#!/bin/sh\nset -eu\n');
    expect(text.startsWith(`#!/bin/sh\n${header}set -eu\n`)).toBe(true);
    const split = splitGenerated(text);
    expect(split.header).toBe(header);
    expect(split.version).toBe('1.2.3');
    expect(split.body).toBe('#!/bin/sh\nset -eu\n');
    // A body without a shebang keeps the header on line 1.
    expect(materialise(header, 'services: {}\n')).toBe(`${header}services: {}\n`);
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
