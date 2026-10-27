import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as ts from 'typescript';

// =============================================================================
// Load order: the `sdk` subpath loads no @nestjs/* module (issue #700)
// =============================================================================
//
// Auto-instrumentation can only patch modules required AFTER `sdk.start()`, so
// the file that installs the SDK must not drag Nest in ahead of it. The slice
// is compiled with the build's own options and loaded in a PLAIN node process
// (Jest's module registry is not `require.cache`, and require-in-the-middle
// does not see Jest's loader), where `require.cache` lists every module the
// subpath really loaded. The Nest-facing index is the control: it must load
// `@nestjs/common`, or the scan proves nothing.
// =============================================================================

const PACKAGE_ROOT = join(__dirname, '..', '..');
const NODE_MODULES = join(PACKAGE_ROOT, '..', '..', 'node_modules');

let outDir: string;

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'platform-api-otel-load-order-'));
  const configPath = join(PACKAGE_ROOT, 'tsconfig.build.json');
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, PACKAGE_ROOT, undefined, configPath);
  const program = ts.createProgram({
    rootNames: [join(PACKAGE_ROOT, 'src', 'otel-core', 'index.ts')],
    options: {
      ...parsed.options,
      outDir,
      rootDir: join(PACKAGE_ROOT, 'src'),
      declaration: false,
      declarationMap: false,
      sourceMap: false,
      noEmit: false,
    },
  });
  expect(program.emit().emitSkipped).toBe(false);
});

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

/** Runs `body` in a fresh node process; it must print `JSON.stringify(...)` of its result. */
function run(body: string, env: Record<string, string> = {}): { stdout: string; stderr: string; status: number | null } {
  const child = spawnSync(process.execPath, ['-e', body], {
    encoding: 'utf8',
    env: { ...process.env, NODE_PATH: NODE_MODULES, NODE_OPTIONS: '', OTEL_ENABLED: '', ...env },
  });
  return { stdout: child.stdout, stderr: child.stderr, status: child.status };
}

const NEST_LOADED = `Object.keys(require.cache).filter((id) => /[\\\\/]@nestjs[\\\\/]/.test(id))`;

describe('otel-core load order', () => {
  it('requiring @marinoscar/platform-api/otel-core/sdk loads no @nestjs/* module', () => {
    const result = run(`
      const sdk = require(${JSON.stringify(join(outDir, 'otel-core', 'sdk', 'index.js'))});
      process.stdout.write(JSON.stringify({ exports: Object.keys(sdk).sort(), nest: ${NEST_LOADED} }));
    `);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as { exports: string[]; nest: string[] };
    expect(parsed.exports).toEqual(expect.arrayContaining(['initializeOtel', 'telemetryGate', 'resolveServiceName']));
    expect(parsed.nest).toEqual([]);
  });

  it('installing the SDK (OTEL enabled) still loads no @nestjs/* module before the app does', () => {
    const result = run(`
      const { initializeOtel } = require(${JSON.stringify(join(outDir, 'otel-core', 'sdk', 'index.js'))});
      const sdk = initializeOtel({ enabled: true, endpoint: 'http://127.0.0.1:9', shutdownOnSigterm: false });
      const nest = ${NEST_LOADED};
      sdk.shutdown().finally(() => process.stdout.write(JSON.stringify({ started: sdk !== null, nest })));
    `);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout.slice(result.stdout.indexOf('{"started"'))) as {
      started: boolean;
      nest: string[];
    };
    expect(parsed.started).toBe(true);
    expect(parsed.nest).toEqual([]);
  });

  it('control: the Nest-facing otel-core index does load @nestjs/common', () => {
    const result = run(`
      require(${JSON.stringify(join(outDir, 'otel-core', 'index.js'))});
      process.stdout.write(JSON.stringify({ nest: ${NEST_LOADED} }));
    `);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as { nest: string[] };
    expect(parsed.nest.some((id) => /[\\/]@nestjs[\\/]common[\\/]/.test(id))).toBe(true);
  });
});
