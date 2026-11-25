import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { resetCapabilityRegistriesForTests, probeCapabilities } from './capabilities.js';
import { listInstallSteps, resetInstallStepRegistryForTests } from './install-deps.js';
import {
  listModelArtifacts,
  modelArtifactPath,
  pullModels,
  registerModelArtifact,
  resetModelRegistryForTests,
  resolveModelsDir,
  verifyModel,
  verifyModels,
  withheldTypesFor,
  type ModelArtifact,
} from './models.js';
import { workerEnv } from './worker-env.js';

const BYTES = Buffer.from('model-bytes-'.repeat(2000));
const SHA = createHash('sha256').update(BYTES).digest('hex');

let dir: string;
let server: Server;
let base: string;
let handler: (request: IncomingMessage, response: ServerResponse) => void;
const requests: Array<{ url: string; range: string | undefined }> = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    requests.push({ url: request.url ?? '', range: request.headers.range });
    handler(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** A server that honours Range requests. */
function rangeServer(content: Buffer) {
  return (request: IncomingMessage, response: ServerResponse) => {
    const range = /^bytes=(\d+)-$/.exec(request.headers.range ?? '');
    if (range?.[1] !== undefined) {
      const start = Number(range[1]);
      response.writeHead(206, { 'content-range': `bytes ${start}-${content.length - 1}/${content.length}`, 'content-length': content.length - start });
      response.end(content.subarray(start));
      return;
    }
    response.writeHead(200, { 'content-length': content.length });
    response.end(content);
  };
}

function artifact(overrides: Partial<ModelArtifact> = {}): ModelArtifact {
  return { id: 'embed', fileName: 'embed.onnx', sha256: SHA, bytes: BYTES.length, url: `${base}/embed.onnx`, requiredBy: ['app.embed'], ...overrides };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'appctl-models-'));
  requests.length = 0;
  handler = rangeServer(BYTES);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  resetModelRegistryForTests();
  resetInstallStepRegistryForTests();
  resetCapabilityRegistriesForTests();
});

describe('registerModelArtifact', () => {
  it('validates every field', () => {
    const ok = artifact();
    expect(() => registerModelArtifact({ ...ok, id: 'Bad' })).toThrow(/model id/);
    expect(() => registerModelArtifact({ ...ok, fileName: '../x' })).toThrow(/plain file name/);
    expect(() => registerModelArtifact({ ...ok, fileName: 'a/b' })).toThrow(/plain file name/);
    expect(() => registerModelArtifact({ ...ok, sha256: 'ABC' })).toThrow(/sha256/);
    expect(() => registerModelArtifact({ ...ok, bytes: 0 })).toThrow(/bytes/);
    expect(() => registerModelArtifact({ ...ok, url: undefined })).toThrow(/exactly one of url or resolveUrl/);
    expect(() => registerModelArtifact({ ...ok, resolveUrl: () => 'x' })).toThrow(/exactly one of url or resolveUrl/);
    expect(() => registerModelArtifact({ ...ok, url: 'ftp://x/y' })).toThrow(/http\(s\)/);
    expect(() => registerModelArtifact({ ...ok, requiredBy: [] })).toThrow(/requiredBy/);
    expect(() => registerModelArtifact({ ...ok, targetSubdir: '../up' })).toThrow(/targetSubdir/);
    expect(() => registerModelArtifact({ ...ok, targetSubdir: '/abs' })).toThrow(/targetSubdir/);
    registerModelArtifact(ok);
    expect(() => registerModelArtifact(ok)).toThrow(/already registered/);
  });

  it('adds the models install step once, and a model: capability probe', async () => {
    registerModelArtifact(artifact({ id: 'one' }));
    registerModelArtifact(artifact({ id: 'two', fileName: 'two.onnx' }));

    expect(listInstallSteps().map((step) => step.id)).toEqual(['state-dir', 'node-runtime', 'models']);
    expect(listModelArtifacts().map((m) => m.id)).toEqual(['one', 'two']);
    const probe = await probeCapabilities({ binaries: [], env: { [workerEnv().stateDir]: dir } });
    expect(Object.keys(probe.probes ?? {})).toEqual(['model:one', 'model:two']);
    expect(probe.probes?.['model:one']?.status).toBe('missing');
  });
});

describe('verifyModel', () => {
  it('reports missing, wrong size, wrong hash and ok, using targetSubdir', async () => {
    const model = artifact({ targetSubdir: 'tesseract' });
    const path = modelArtifactPath(model, dir);
    expect(path).toBe(join(dir, 'tesseract', 'embed.onnx'));

    expect((await verifyModel(model, dir)).status).toBe('missing');

    mkdirSync(join(dir, 'tesseract'));
    writeFileSync(path, 'short');
    expect(await verifyModel(model, dir)).toMatchObject({ status: 'corrupt', detail: expect.stringContaining('expected') });

    writeFileSync(path, Buffer.alloc(BYTES.length, 1));
    expect(await verifyModel(model, dir)).toMatchObject({ status: 'corrupt', detail: expect.stringContaining('sha256') });

    writeFileSync(path, BYTES);
    expect((await verifyModel(model, dir)).status).toBe('ok');
  });

  it('does not trust a cached hash after the file changes', async () => {
    const model = artifact();
    writeFileSync(modelArtifactPath(model, dir), BYTES);
    expect((await verifyModel(model, dir)).status).toBe('ok');

    writeFileSync(modelArtifactPath(model, dir), Buffer.alloc(BYTES.length, 7));
    expect((await verifyModel(model, dir)).status).toBe('corrupt');
  });
});

describe('withheldTypesFor', () => {
  it('names the types of every model that is not ok, with the blocking ids', async () => {
    const models = [artifact({ id: 'a', requiredBy: ['t1', 't2'] }), artifact({ id: 'b', fileName: 'b.onnx', requiredBy: ['t2'] }), artifact({ id: 'c', fileName: 'c.onnx', requiredBy: ['t3'] })];
    writeFileSync(modelArtifactPath(models[2] as ModelArtifact, dir), BYTES);

    const withheld = withheldTypesFor(await verifyModels(dir, models), models);

    expect([...withheld.entries()]).toEqual([['t1', ['a']], ['t2', ['a', 'b']]]);
  });
});

describe('resolveModelsDir', () => {
  it('uses the MODELS_DIR variable, else <state>/models', () => {
    expect(resolveModelsDir('/state', {})).toBe(join('/state', 'models'));
    expect(resolveModelsDir('/state', { [workerEnv().modelsDir]: ' /baked/models ' })).toBe('/baked/models');
  });
});

describe('pullModels', () => {
  it('downloads, verifies sha256 and renames atomically into targetSubdir', async () => {
    const model = artifact({ targetSubdir: 'sub' });
    const logs: string[] = [];

    const results = await pullModels({ modelsDir: dir, declared: [model], log: (m) => logs.push(m) });

    expect(results).toEqual([expect.objectContaining({ id: 'embed', outcome: 'downloaded', bytes: BYTES.length, resumed: false })]);
    expect(readFileSync(join(dir, 'sub', 'embed.onnx')).equals(BYTES)).toBe(true);
    expect(existsSync(join(dir, 'sub', 'embed.onnx.partial'))).toBe(false);
    expect(logs.join('\n')).toMatch(/Model embed ready: \d+ bytes in \d+ ms/);
  });

  it('skips a valid file without a request, and re-downloads one with --force', async () => {
    const model = artifact();
    writeFileSync(modelArtifactPath(model, dir), BYTES);

    expect((await pullModels({ modelsDir: dir, declared: [model] }))[0]?.outcome).toBe('present');
    expect(requests).toHaveLength(0);

    expect((await pullModels({ modelsDir: dir, declared: [model], force: true }))[0]?.outcome).toBe('downloaded');
    expect(requests).toHaveLength(1);
  });

  it('replaces a corrupt file', async () => {
    const model = artifact();
    writeFileSync(modelArtifactPath(model, dir), Buffer.alloc(BYTES.length, 9));

    const results = await pullModels({ modelsDir: dir, declared: [model] });

    expect(results[0]?.outcome).toBe('downloaded');
    expect((await verifyModel(model, dir)).status).toBe('ok');
  });

  it('rejects a bad sha256: the file is removed, nothing is renamed into place, and it is not retried', async () => {
    const model = artifact({ sha256: createHash('sha256').update('something else').digest('hex') });

    const results = await pullModels({ modelsDir: dir, declared: [model], attempts: 3, sleep: async () => {} });

    expect(results[0]).toMatchObject({ outcome: 'failed', detail: expect.stringContaining('sha256') });
    expect(existsSync(modelArtifactPath(model, dir))).toBe(false);
    expect(existsSync(`${modelArtifactPath(model, dir)}.partial`)).toBe(false);
    expect(requests).toHaveLength(1);
  });

  it('resumes a partial download with a Range request and finishes the file', async () => {
    const model = artifact();
    const half = Math.floor(BYTES.length / 2);
    writeFileSync(`${modelArtifactPath(model, dir)}.partial`, BYTES.subarray(0, half));

    const results = await pullModels({ modelsDir: dir, declared: [model] });

    expect(requests.map((r) => r.range)).toEqual([`bytes=${half}-`]);
    expect(results[0]).toMatchObject({ outcome: 'downloaded', resumed: true });
    expect((await verifyModel(model, dir)).status).toBe('ok');
  });

  it('restarts the file when the server ignores the range', async () => {
    handler = (_request, response) => {
      response.writeHead(200, { 'content-length': BYTES.length });
      response.end(BYTES);
    };
    const model = artifact();
    writeFileSync(`${modelArtifactPath(model, dir)}.partial`, BYTES.subarray(0, 100));

    const results = await pullModels({ modelsDir: dir, declared: [model] });

    expect(results[0]).toMatchObject({ outcome: 'downloaded', resumed: false });
    expect((await verifyModel(model, dir)).status).toBe('ok');
  });

  it('retries a dropped connection and resumes from what arrived', async () => {
    let calls = 0;
    handler = (request, response) => {
      calls += 1;
      if (calls === 1) {
        // Promise the whole file, send part of it, and cut the connection.
        response.writeHead(200, { 'content-length': BYTES.length });
        response.write(BYTES.subarray(0, 4000));
        setTimeout(() => response.destroy(), 20);
        return;
      }
      rangeServer(BYTES)(request, response);
    };
    const model = artifact();

    const results = await pullModels({ modelsDir: dir, declared: [model], attempts: 3, sleep: async () => {} });

    expect(results[0]?.outcome).toBe('downloaded');
    expect(calls).toBe(2);
    expect(requests[1]?.range).toMatch(/^bytes=\d+-$/);
    expect((await verifyModel(model, dir)).status).toBe('ok');
  });

  it('does not retry a 404 and reports it without the URL query', async () => {
    handler = (_request, response) => {
      response.writeHead(404);
      response.end();
    };
    const logs: string[] = [];
    const model = artifact({ url: `${base}/gone.onnx?token=SECRET&X-Signature=abc` });

    const results = await pullModels({ modelsDir: dir, declared: [model], attempts: 3, sleep: async () => {}, log: (m) => logs.push(m) });

    expect(results[0]).toMatchObject({ outcome: 'failed', detail: expect.stringContaining('HTTP 404') });
    expect(requests).toHaveLength(1);
    expect(logs.join('\n')).not.toMatch(/SECRET|X-Signature|token=/);
    expect(JSON.stringify(results)).not.toMatch(/SECRET|X-Signature/);
  });

  it('uses resolveUrl at pull time and keeps going after one model fails', async () => {
    const good = artifact({ id: 'good', fileName: 'good.onnx', url: undefined, resolveUrl: async () => `${base}/good.onnx?sig=zzz` });
    const bad = artifact({ id: 'bad', fileName: 'bad.onnx', url: `${base}/bad.onnx`, sha256: '0'.repeat(64) });

    const results = await pullModels({ modelsDir: dir, declared: [bad, good], sleep: async () => {} });

    expect(results.map((r) => [r.id, r.outcome])).toEqual([['bad', 'failed'], ['good', 'downloaded']]);
    expect(requests.at(-1)?.url).toBe('/good.onnx?sig=zzz');
  });

  it('pulls only the ids asked for, and refuses an unknown id', async () => {
    const one = artifact({ id: 'one', fileName: 'one.onnx' });
    const two = artifact({ id: 'two', fileName: 'two.onnx' });

    const results = await pullModels({ modelsDir: dir, declared: [one, two], ids: ['two'] });

    expect(results.map((r) => r.id)).toEqual(['two']);
    expect(statSync(modelArtifactPath(two, dir)).size).toBe(BYTES.length);
    await expect(pullModels({ modelsDir: dir, declared: [one], ids: ['nope'] })).rejects.toThrow(/Unknown model: nope. Known models: one/);
  });

  it('the models install step detects satisfied state and pulls on install', async () => {
    registerModelArtifact(artifact());
    const step = listInstallSteps().find((s) => s.id === 'models');
    const context = {
      distro: { id: 'ubuntu', versionId: undefined, family: 'debian' as const },
      dryRun: false,
      stateDir: dir,
      run: () => {},
      capture: async () => '',
      log: () => {},
    };
    const savedEnv = process.env[workerEnv().modelsDir];
    delete process.env[workerEnv().modelsDir];
    try {
      expect(await step?.detect(context)).toBe(false);
      await step?.install(context);
      expect(await step?.detect(context)).toBe(true);
      expect(existsSync(join(dir, 'models', 'embed.onnx'))).toBe(true);
    } finally {
      if (savedEnv !== undefined) process.env[workerEnv().modelsDir] = savedEnv;
    }
  });
});
