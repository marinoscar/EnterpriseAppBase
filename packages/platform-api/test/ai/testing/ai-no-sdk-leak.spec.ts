import { join } from 'node:path';

import { aiPackageProviderDirs } from '../../../src/ai/testing';
import type { AiNoSdkLeakOptions } from '../../../src/ai/testing';
import { runPlatformConformance } from '../../../src/testing';
import { emptySourceRoot, outcome, recordingTestApi, removeSourceRoots, writeSource } from '../../support/conformance-harness';

afterAll(removeSourceRoots);

const SRC = join(__dirname, '..', '..', '..', 'src');

// Spelled with a join so this file has no import of an SDK in it.
const IMPORT = ['im', 'port'].join('');
const sdkImport = (name = 'openai'): string => `${IMPORT} OpenAI from '${name}';\nexport const x = 1;\n`;

function tree(files: Record<string, string>): string {
  const root = emptySourceRoot();
  for (const [file, source] of Object.entries(files)) writeSource(root, file, source);
  return root;
}

function manifest(content: Record<string, unknown>): string {
  const root = emptySourceRoot();
  writeSource(root, 'package.json', JSON.stringify(content));
  return join(root, 'package.json');
}

async function run(options: AiNoSdkLeakOptions): Promise<Map<string, Error | null>> {
  const { api, tests } = recordingTestApi();
  runPlatformConformance({ sourceRoots: [SRC], suites: { aiNoSdkLeak: options }, testApi: api });
  const results = new Map<string, Error | null>();
  for (const test of tests) {
    if (test.name.startsWith('platform conformance')) continue;
    results.set(test.name.split(' > ')[1]!, await outcome(test));
  }
  return results;
}

const cleanApp = (): Record<string, string> => ({ 'a.ts': 'export const a = 1;\n', 'b.ts': 'export const b = 2;\n' });

describe('the ai-no-sdk-leak suite', () => {
  it('lists the package own provider directories without spelling a path', () => {
    const dirs = aiPackageProviderDirs(SRC);

    expect(dirs.map((dir) => dir.split('/').slice(-2)[0])).toEqual(
      expect.arrayContaining(['anthropic', 'azure-openai', 'gemini', 'openai', 'openai-compatible']),
    );
    expect(dirs.every((dir) => dir.endsWith('/'))).toBe(true);
    expect(aiPackageProviderDirs(join(SRC, 'does-not-exist'))).toEqual([]);
  });

  it('passes a clean app, a web tree, a package with its adapter directory and clean manifests', async () => {
    const results = await run({
      apiTrees: [
        { name: 'pkg', root: tree({ 'ai/providers/openai/adapter.ts': sdkImport(), 'ai/core.ts': 'export const c = 1;\n' }), sdkDirs: ['ai/providers/openai/'], minFiles: 2 },
        { name: 'app', root: tree(cleanApp()), minFiles: 2 },
      ],
      webTrees: [{ name: 'web', root: tree(cleanApp()), minFiles: 2 }],
      sdkOwner: { manifest: manifest({ dependencies: { openai: '^7' } }), declares: ['openai'] },
      noSdkManifests: [manifest({ dependencies: { zod: '^4' } })],
    });

    for (const [name, error] of results) expect([name, error]).toEqual([name, null]);
    expect(results.size).toBe(2 + 2 + 2 + 1 + 1 + 3);
  });

  describe('fails on a planted violation', () => {
    it('an SDK import in an app file, by file name', async () => {
      const results = await run({
        apiTrees: [{ name: 'app', root: tree({ ...cleanApp(), 'features/summary.service.ts': sdkImport() }), minFiles: 2 }],
        webTrees: [],
        noSdkManifests: [],
      });

      const failure = results.get('app: imports no provider SDK anywhere: a feature calls AiService.forUser');
      expect(failure!.message).toContain('features/summary.service.ts: imports "openai"');
    });

    it('an SDK import in the package outside its adapter directory', async () => {
      const results = await run({
        apiTrees: [
          {
            name: 'pkg',
            root: tree({ 'ai/providers/openai/adapter.ts': sdkImport(), 'ai/runtime/ai.service.ts': sdkImport('@anthropic-ai/sdk') }),
            sdkDirs: ['ai/providers/openai/'],
            minFiles: 2,
          },
        ],
        webTrees: [],
        noSdkManifests: [],
      });

      const failure = results.get('pkg: imports no provider SDK outside its own adapter directory');
      expect(failure!.message).toContain('ai/runtime/ai.service.ts: imports "@anthropic-ai/sdk"');
      expect(failure!.message).not.toContain('adapter.ts');
    });

    it('an SDK import in a web source', async () => {
      const results = await run({
        apiTrees: [],
        webTrees: [{ name: 'web', root: tree({ ...cleanApp(), 'chat.tsx': sdkImport('@google/genai') }), minFiles: 2 }],
        noSdkManifests: [],
      });

      const [name, error] = [...results].find(([title]) => title.startsWith('web: imports no provider SDK'))!;
      expect(name).toContain('the browser must never hold one');
      expect(error!.message).toContain('chat.tsx: imports "@google/genai"');
    });

    it('an SDK declared in a manifest that must not hold one, and an extra package the app bans', async () => {
      const dirty = manifest({ name: 'api', devDependencies: { '@anthropic-ai/sdk': '^0.1' } });
      const results = await run({
        apiTrees: [],
        webTrees: [],
        noSdkManifests: [dirty],
        extraSdkPackages: [],
      });
      const failure = [...results].find(([title]) => title.endsWith('declares no provider SDK'))![1];

      expect(failure!.message).toContain('declares "@anthropic-ai/sdk"');

      const custom = await run({
        apiTrees: [{ name: 'app', root: tree({ ...cleanApp(), 'x.ts': sdkImport('my-llm-sdk') }), minFiles: 2 }],
        webTrees: [],
        noSdkManifests: [],
        extraSdkPackages: ['my-llm-sdk'],
      });
      expect(custom.get('app: imports no provider SDK anywhere: a feature calls AiService.forUser')!.message).toContain('my-llm-sdk');
    });

    it('a package whose declared SDKs went missing, or a tree smaller than the app expects (a moved tree cannot pass vacuously)', async () => {
      const results = await run({
        apiTrees: [{ name: 'app', root: tree(cleanApp()), minFiles: 100 }],
        webTrees: [],
        sdkOwner: { manifest: manifest({ dependencies: {} }), declares: ['openai'] },
        noSdkManifests: [],
      });

      expect(results.get('app: finds a non-trivial source tree, so this cannot pass vacuously')).not.toBeNull();
      expect(results.get('declares the shipped SDKs in the owning package only')).not.toBeNull();
    });

    it('a package tree with no provider directory at all', async () => {
      const results = await run({
        apiTrees: [{ name: 'pkg', root: tree(cleanApp()), sdkDirs: [], minFiles: 2 }],
        webTrees: [],
        noSdkManifests: [],
      });

      expect(results.get('pkg: finds a non-trivial source tree and at least one provider directory, so this cannot pass vacuously')).not.toBeNull();
    });
  });
});
