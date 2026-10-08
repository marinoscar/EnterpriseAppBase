// =============================================================================
// No AI provider SDK leaks outside its own adapter — cross-cutting
// conformance (issue #435, epic #419)
// =============================================================================
//
// `ai/core/no-provider-sdk.spec.ts` (in the package) already pins the narrow,
// permanent claim that `ai/core` itself imports nothing beyond
// `zod`/`@nestjs/common`. This suite is the wider one the issue asks for:
//
//   - in `@marinoscar/platform-api` (packages/platform-api/src, every slice),
//     NO file OUTSIDE `ai/providers/<provider>/` may import a provider SDK
//     (#739: the AI slice and its providers moved into the package);
//   - in the app (`apps/api/src`) NO file may import one at all: a feature
//     calls `AiService.forUser(...)`;
//   - NO file of the web (`apps/web/src`, `packages/platform-web/src`) or of
//     the contract may import one (the browser must never hold a provider
//     SDK any more than it may hold a provider key);
//   - NO app `package.json` (`apps/api`, `apps/web`) and no other package
//     declares a provider SDK: they are dependencies of
//     `@marinoscar/platform-api` only.
//
// THE BANNED LIST IS PACKAGE NAMES, NOT A GREP FOR "openai" AS A STRING —
// so a comment or a variable named `openaiKeyHint` does not fail this suite.
// It is deliberately wider than what `package.json` happens to declare today
// (only `openai`): a fork adding `@anthropic-ai/sdk` or `@google/genai`
// without also adding its adapter under `ai/providers/<id>/` should fail
// here on day one, not be missed because the list only knew about the SDK
// already in the tree.
// =============================================================================

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO = join(__dirname, '..', '..', '..', '..');
const SRC_PACKAGE_API = join(REPO, 'packages', 'platform-api', 'src');
const SRC_API = join(REPO, 'apps', 'api', 'src');
const WEB_ROOTS = [join(REPO, 'apps', 'web', 'src'), join(REPO, 'packages', 'platform-web', 'src')];
const SRC_CONTRACT = join(REPO, 'packages', 'platform-contract', 'src');
const PROVIDERS_DIR = join(SRC_PACKAGE_API, 'ai', 'providers');
/** The one package that may declare a provider SDK. */
const SDK_OWNER_PACKAGE_JSON = join(REPO, 'packages', 'platform-api', 'package.json');
/** Every other manifest that must not. */
const OTHER_PACKAGE_JSONS = [
  join(REPO, 'package.json'),
  join(REPO, 'apps', 'api', 'package.json'),
  join(REPO, 'apps', 'web', 'package.json'),
  join(REPO, 'apps', 'cli', 'package.json'),
  join(REPO, 'packages', 'platform-web', 'package.json'),
  join(REPO, 'packages', 'platform-contract', 'package.json'),
  join(REPO, 'packages', 'platform-cli', 'package.json'),
  join(REPO, 'packages', 'platform-db', 'package.json'),
  join(REPO, 'packages', 'platform-infra', 'package.json'),
];

/**
 * Known AI provider SDK package names. Not exhaustive of every SDK that will
 * ever exist — exhaustive of every one worth naming so a reviewer adding a
 * new provider sees this list and extends it, the same "argued list" shape
 * `cron-enqueue-only.spec.ts`'s exemption array uses.
 */
const PROVIDER_SDK_PACKAGES = [
  'openai',
  '@anthropic-ai/sdk',
  '@google/genai',
  '@google/generative-ai',
  '@google-cloud/vertexai',
  'cohere-ai',
  '@mistralai/mistralai',
  'mistralai',
  'groq-sdk',
  '@aws-sdk/client-bedrock-runtime',
  'replicate',
  'together-ai',
  'ollama',
] as const;

function sourceFiles(dir: string): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })) return [];

  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    const stat = statSync(full);

    if (stat.isDirectory()) return sourceFiles(full);
    if (!entry.endsWith('.ts') && !entry.endsWith('.tsx')) return [];
    if (entry.endsWith('.spec.ts') || entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) return [];

    return [full];
  });
}

function importSpecifiers(source: string): string[] {
  const pattern =
    // named/default/namespace import or re-export ... from '...'
    /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/g;
  const bareImportPattern = /import\s+['"]([^'"]+)['"]/g; // side-effect-only `import '...'`
  const dynamicPattern = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  const requirePattern = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  const specifiers: string[] = [];

  for (const re of [pattern, bareImportPattern, dynamicPattern, requirePattern]) {
    for (const match of source.matchAll(re)) {
      specifiers.push(match[1]);
    }
  }

  return specifiers;
}

/** True when `specifier` names (or is a subpath of) a banned provider SDK package. */
function namesProviderSdk(specifier: string): boolean {
  return PROVIDER_SDK_PACKAGES.some(
    (pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`),
  );
}

interface SourceFile {
  /** Path relative to its source root, forward slashes. */
  rel: string;
  /** File contents. */
  source: string;
}

function readTree(root: string): SourceFile[] {
  return sourceFiles(root).map((file) => ({
    rel: relative(root, file).split('\\').join('/'),
    source: readFileSync(file, 'utf8'),
  }));
}

/** `<file>: imports "<sdk>"` for every provider SDK import outside the exempt directories. */
export function findSdkLeaks(files: readonly SourceFile[], exemptDirs: readonly string[] = []): string[] {
  const offenders: string[] = [];
  for (const file of files) {
    if (exemptDirs.some((dir) => file.rel.startsWith(dir))) continue;
    for (const specifier of importSpecifiers(file.source)) {
      if (namesProviderSdk(specifier)) offenders.push(`${file.rel}: imports "${specifier}"`);
    }
  }
  return offenders;
}

/** The provider SDKs a `package.json` declares, in any dependency field. */
export function declaredSdks(manifest: Record<string, unknown>): string[] {
  const fields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
  return fields.flatMap((field) =>
    Object.keys((manifest[field] as Record<string, string> | undefined) ?? {}).filter(namesProviderSdk),
  );
}

describe('no AI provider SDK leaks outside its own adapter directory (#435, #739)', () => {
  describe('@marinoscar/platform-api (packages/platform-api/src)', () => {
    const files = readTree(SRC_PACKAGE_API);

    /** Every provider's own directory (`ai/providers/openai`, …) — the ONLY exemption. */
    const providerDirs = readdirSync(PROVIDERS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `ai/providers/${entry.name}/`);

    it('finds a non-trivial source tree and at least one provider directory, so this cannot pass vacuously', () => {
      expect(files.length).toBeGreaterThan(100);
      expect(providerDirs.length).toBeGreaterThanOrEqual(1);
      expect(providerDirs).toContain('ai/providers/openai/');
    });

    it('imports no provider SDK outside its own adapter directory', () => {
      expect(findSdkLeaks(files, providerDirs)).toEqual([]);
    });
  });

  describe('apps/api/src', () => {
    const files = readTree(SRC_API);

    it('finds a non-trivial source tree, so this cannot pass vacuously', () => {
      expect(files.length).toBeGreaterThan(100);
    });

    it('imports no provider SDK anywhere: a feature calls AiService.forUser', () => {
      expect(findSdkLeaks(files)).toEqual([]);
    });
  });

  describe('the web and the contract', () => {
    const files = [...WEB_ROOTS, SRC_CONTRACT].flatMap((root) =>
      readTree(root).map((file) => ({ ...file, rel: `${relative(REPO, root)}/${file.rel}` })),
    );

    it('finds a non-trivial source tree, so this cannot pass vacuously', () => {
      expect(files.length).toBeGreaterThan(50);
    });

    it('imports no provider SDK anywhere — the browser must never hold one, any more than it may hold a provider key', () => {
      expect(findSdkLeaks(files)).toEqual([]);
    });
  });

  describe('package manifests', () => {
    it('declares the shipped SDKs in @marinoscar/platform-api only', () => {
      const owner = JSON.parse(readFileSync(SDK_OWNER_PACKAGE_JSON, 'utf8')) as Record<string, unknown>;
      expect(declaredSdks(owner)).toEqual(expect.arrayContaining(['openai', '@anthropic-ai/sdk', '@google/genai']));
    });

    it.each(OTHER_PACKAGE_JSONS.map((file) => [relative(REPO, file), file]))('%s declares no provider SDK', (_name, file) => {
      const manifest = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      expect(declaredSdks(manifest)).toEqual([]);
    });
  });

  describe('the detectors themselves (planted violations)', () => {
    it('flag an SDK import planted in apps/api/src', () => {
      const planted: SourceFile[] = [
        { rel: 'features/summary.service.ts', source: "import OpenAI from 'openai';\nexport const x = 1;" },
        { rel: 'features/other.ts', source: "const sdk = require('@anthropic-ai/sdk/resources');" },
        { rel: 'features/fine.ts', source: "// mentions openai in prose only\nconst openaiKeyHint = 'x';" },
      ];
      expect(findSdkLeaks(planted)).toEqual([
        'features/summary.service.ts: imports "openai"',
        'features/other.ts: imports "@anthropic-ai/sdk/resources"',
      ]);
    });

    it('exempt only the provider directories they are given', () => {
      const planted: SourceFile[] = [
        { rel: 'ai/providers/openai/openai.adapter.ts', source: "import OpenAI from 'openai';" },
        { rel: 'ai/runtime/ai.service.ts', source: "import OpenAI from 'openai';" },
      ];
      expect(findSdkLeaks(planted, ['ai/providers/openai/'])).toEqual(['ai/runtime/ai.service.ts: imports "openai"']);
    });

    it('flag a provider SDK declared in an app package.json', () => {
      expect(declaredSdks({ name: 'api', dependencies: { '@nestjs/core': '^11', openai: '^7' } })).toEqual(['openai']);
      expect(declaredSdks({ devDependencies: { '@google/genai': '^2' } })).toEqual(['@google/genai']);
      expect(declaredSdks({ dependencies: { zod: '^4' } })).toEqual([]);
    });
  });
});
