// =============================================================================
// Suite: no AI provider SDK leaks outside its own adapter (issues #435, #742)
// =============================================================================
//
// CLAUDE.md AI rule 1: a provider SDK is imported only inside the directory of
// the adapter that owns it. `ai/core` already pins the narrow claim that it
// imports nothing beyond `zod` and `@nestjs/common` (its own spec). This suite
// is the wider one:
//
//   - in the platform package, NO file OUTSIDE a provider's own directory may
//     import a provider SDK;
//   - in the app, NO file may import one at all: a feature calls
//     `AiService.forUser(...)`;
//   - NO file of the web or the contract may import one (the browser must never
//     hold a provider SDK any more than it may hold a provider key);
//   - NO app `package.json` and no other package declares a provider SDK: they
//     are declared by the owning packages only.
//
// THE SDK OWNER SINCE #991. The five adapters, and every import of their
// SDKs, live in `@marinoscar/platform-ai-providers` (`src/<provider>/`, see
// {@link aiProvidersPackageSdkDirs}); `@marinoscar/platform-api`'s
// `ai/providers/<id>/` folders keep only the Nest bindings, which import no
// SDK, so the platform package's tree is scanned with no exempt directory at
// all. Two manifests may declare the SDKs, which is why `sdkOwner` takes a
// list: `@marinoscar/platform-ai-providers` (optional peers, so a plain-Node
// consumer installs only the SDK it uses) and `@marinoscar/platform-api`
// (dependencies, so an app on the platform gets all three installed, as
// before, and the lean package's optional peers resolve to them).
//
// THE BANNED LIST IS PACKAGE NAMES, NOT A GREP FOR "openai" AS A STRING, so a
// comment or a variable named `openaiKeyHint` does not fail the suite. It is
// deliberately wider than what a `package.json` happens to declare today: a
// fork adding `@anthropic-ai/sdk` or `@google/genai` without also adding its
// adapter under the provider directory should fail on day one, not be missed
// because the list only knew about the SDKs already in the tree.
//
// NOTHING HERE NAMES A PATH. The app passes the source trees it ships (with the
// directories where an adapter may import its SDK) and the manifests to check.
// The platform package's own adapter directories come from
// {@link aiPackageProviderDirs}, which reads the AI slice's layout next to this
// file, so an app that consumes the package from `node_modules` and an app that
// builds it from source both pass the directory they have.
//
// Moved from the reference app's `apps/api/test/ai/ai-no-sdk-leak.spec.ts` with
// the same case list (the manifest cases are one per manifest, as before).
// =============================================================================

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { conformanceSuites } from '../../../testing/index';
import { aiProviderDefinitions } from '../../providers/ai-provider-definition';
import type {
  ConformanceCase,
  ConformanceContext,
  ConformanceFinding,
  ConformanceReport,
  ConformanceSuite,
} from '../../../testing/index';

/**
 * One source tree the suite scans for provider SDK imports.
 *
 * @stability experimental
 */
export interface SdkLeakTree {
  /** A label for the test titles, for example `@marinoscar/platform-api`. */
  name: string;
  /** Absolute root of the tree. */
  root: string;
  /**
   * Directories, relative to `root` with `/` separators and a trailing `/`,
   * where an adapter may import its SDK. Omit for a tree where no file may
   * (the app, the web, the contract).
   */
  sdkDirs?: readonly string[];
  /** Vacuity guard: the tree must hold at least this many source files. */
  minFiles: number;
}

/**
 * The one manifest allowed to declare provider SDKs.
 *
 * @stability experimental
 */
export interface SdkOwnerManifest {
  /** Absolute path of the owning package's `package.json`. */
  manifest: string;
  /** SDK names it must declare (proves the check reads real dependencies). */
  declares: readonly string[];
}

/**
 * How an app configures the `ai-no-sdk-leak` suite.
 *
 * Since #991 the provider SDKs are imported only by
 * `@marinoscar/platform-ai-providers`: scan that package with
 * `sdkDirs: aiProvidersPackageSdkDirs(<its src>)`, and the platform package
 * with no `sdkDirs` (its provider folders import no SDK).
 *
 * @example
 * ```ts
 * aiNoSdkLeak: {
 *   apiTrees: [
 *     { name: '@marinoscar/platform-api', root: PACKAGE_SRC, sdkDirs: aiPackageProviderDirs(PACKAGE_SRC), minFiles: 100 },
 *     { name: 'apps/api/src', root: join(REPO, 'apps/api/src'), minFiles: 100 },
 *   ],
 *   webTrees: [{ name: 'apps/web/src', root: join(REPO, 'apps/web/src'), minFiles: 50 }],
 *   sdkOwner: { manifest: PACKAGE_JSON, declares: ['openai'] },
 *   noSdkManifests: [join(REPO, 'package.json'), join(REPO, 'apps/api/package.json')],
 * }
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface AiNoSdkLeakOptions {
  /** API-side trees. The platform package passes its adapter directories as `sdkDirs`; the app passes none. */
  apiTrees: readonly SdkLeakTree[];
  /** Trees the browser ships (web sources, contract sources): no SDK import anywhere. */
  webTrees: readonly SdkLeakTree[];
  /**
   * The manifest (or manifests) allowed to declare provider SDKs, and the SDK
   * names each must declare (proves the check reads real dependencies). Omit
   * when the app consumes the packages from `node_modules`: the packages own
   * their dependencies.
   */
  sdkOwner?: SdkOwnerManifest | readonly SdkOwnerManifest[];
  /** Absolute `package.json` paths that must declare no provider SDK. */
  noSdkManifests: readonly string[];
  /** More SDK package names to ban, beyond {@link PROVIDER_SDK_PACKAGES}. */
  extraSdkPackages?: readonly string[];
  /**
   * Directories where the adapter of a provider registered with
   * `registerAiProvider` (an app's or another package's) may import its SDK
   * (PP-14.6), relative to the root of each `apiTrees` entry, with `/`
   * separators and a trailing `/`: `['platform-extensions/ai/']`. Applied in
   * addition to a tree's own `sdkDirs`. Nothing else in that tree may import
   * an SDK, and each directory must hold at least one source file in some tree
   * (a typo would otherwise exempt nothing and look green).
   *
   * The SDK packages each registered definition lists in `sdkPackages` are
   * banned too, everywhere outside these directories, so an adapter's SDK
   * stays inside its own folder; a `package.json` that declares one of them is
   * not a finding (the folder's owner must declare what it imports).
   */
  providerDirs?: readonly string[];
}

/**
 * Known AI provider SDK package names. Not exhaustive of every SDK that will
 * ever exist: exhaustive of every one worth naming, so a reviewer adding a
 * provider sees this list and extends it.
 *
 * @stability experimental
 */
export const PROVIDER_SDK_PACKAGES: readonly string[] = Object.freeze([
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
]);

/**
 * The top-level directories of `@marinoscar/platform-ai-providers` that may
 * import a provider SDK, in the form {@link SdkLeakTree.sdkDirs} takes: every
 * directory directly under `packageRoot` (that package's `src`, or its
 * `dist`) except `core/`, the provider-agnostic core, which imports none.
 * One directory per provider subpath (`openai/`, `anthropic/`, `gemini/`), so
 * a provider added there is covered without editing this list.
 *
 * @param packageRoot - the root of the `@marinoscar/platform-ai-providers` tree being scanned.
 * @returns one `<provider>/` entry per provider directory, empty when `packageRoot` does not exist.
 *
 * @stability experimental
 */
export function aiProvidersPackageSdkDirs(packageRoot: string): string[] {
  const dir = resolve(packageRoot);
  if (!statSync(dir, { throwIfNoEntry: false })) return [];

  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'core')
    .map((entry) => `${entry.name}/`);
}

/** The `sdkOwner` option as a list. */
function sdkOwners(options: AiNoSdkLeakOptions): readonly SdkOwnerManifest[] {
  if (!options.sdkOwner) return [];

  return Array.isArray(options.sdkOwner) ? (options.sdkOwner as readonly SdkOwnerManifest[]) : [options.sdkOwner as SdkOwnerManifest];
}

/**
 * The platform package's own adapter directories, in the form
 * {@link SdkLeakTree.sdkDirs} takes: one per provider the AI slice ships,
 * relative to `packageRoot` (the package's `src`, or its `dist`). Since #991
 * these folders hold only the Nest bindings of the adapters and import no
 * SDK; the SDK imports are in `@marinoscar/platform-ai-providers` (see
 * {@link aiProvidersPackageSdkDirs}).
 *
 * @param packageRoot - the root of the package tree being scanned.
 * @returns one `<slice>/<providers>/<id>/` entry per provider directory, empty when the slice is not under `packageRoot`.
 *
 * @stability experimental
 */
export function aiPackageProviderDirs(packageRoot: string): string[] {
  // The adapters live in `providers/<id>/` beside `testing/` in the AI slice
  // (this file is `<slice>/testing/conformance/`), and the package source and
  // its build have the same layout, so the slice-relative location is read off
  // this file and re-applied to the root the caller passes. No path is spelled.
  const providers = resolve(__dirname, '..', '..', 'providers');
  const prefix = relative(resolve(__dirname, '..', '..', '..'), providers).split(sep).join('/');
  const dir = join(resolve(packageRoot), prefix);
  if (!statSync(dir, { throwIfNoEntry: false })) return [];

  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${prefix}/${entry.name}/`);
}

// The planted sources of the detector cases are assembled from these, so this
// file never contains an import of its own that the scan above would flag when
// an app scans the package source (the reference app does).
const IMPORT = ['im', 'port'].join('');
const REQUIRE = ['req', 'uire'].join('');

/** One scanned source file. */
interface SourceFile {
  /** Path relative to its source root, forward slashes. */
  rel: string;
  /** File contents. */
  source: string;
}

function sourceFiles(dir: string): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })) return [];

  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    const stat = statSync(full);

    if (stat.isDirectory()) return entry === 'node_modules' ? [] : sourceFiles(full);
    if (!entry.endsWith('.ts') && !entry.endsWith('.tsx')) return [];
    if (entry.endsWith('.spec.ts') || entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) return [];
    if (entry.endsWith('.d.ts')) return [];

    return [full];
  });
}

/**
 * The module specifiers a source text imports, re-exports, dynamically
 * imports or requires.
 *
 * @param source - TypeScript or JavaScript source.
 * @returns the specifiers, in pattern order.
 *
 * @stability experimental
 */
export function importSpecifiers(source: string): string[] {
  const patterns = [
    // named/default/namespace import or re-export ... from '...'
    /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/g,
    // side-effect-only `import '...'`
    /import\s+['"]([^'"]+)['"]/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  return patterns.flatMap((re) => [...source.matchAll(re)].map((match) => match[1]!));
}

/** True when `specifier` names (or is a subpath of) a banned provider SDK package. */
function namesProviderSdk(specifier: string, banned: readonly string[]): boolean {
  return banned.some((pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`));
}

/**
 * The SDK packages the registered AI provider definitions declare
 * (`sdkPackages`), de-duplicated, in registration order.
 *
 * @returns the package names.
 * @stability experimental
 */
export function registeredAiSdkPackages(): string[] {
  return [...new Set(aiProviderDefinitions().flatMap((definition) => definition.sdkPackages ?? []))];
}

/**
 * `<file>: imports "<sdk>"` for every provider SDK import outside the exempt directories.
 *
 * @param files - scanned files with root-relative paths.
 * @param exemptDirs - directories (root-relative, `/`-terminated) where an import is allowed.
 * @param banned - the banned package names (default {@link PROVIDER_SDK_PACKAGES}).
 * @returns one message per offending import.
 *
 * @stability experimental
 */
export function findSdkLeaks(
  files: ReadonlyArray<{ rel: string; source: string }>,
  exemptDirs: readonly string[] = [],
  banned: readonly string[] = PROVIDER_SDK_PACKAGES,
): string[] {
  const offenders: string[] = [];

  for (const file of files) {
    if (exemptDirs.some((dir) => file.rel.startsWith(dir))) continue;
    for (const specifier of importSpecifiers(file.source)) {
      if (namesProviderSdk(specifier, banned)) offenders.push(`${file.rel}: imports "${specifier}"`);
    }
  }

  return offenders;
}

/**
 * The provider SDKs a `package.json` declares, in any dependency field.
 *
 * @param manifest - a parsed `package.json`.
 * @param banned - the banned package names (default {@link PROVIDER_SDK_PACKAGES}).
 * @returns the declared SDK names.
 *
 * @stability experimental
 */
export function declaredSdks(manifest: Record<string, unknown>, banned: readonly string[] = PROVIDER_SDK_PACKAGES): string[] {
  const fields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

  return fields.flatMap((field) =>
    Object.keys((manifest[field] as Record<string, string> | undefined) ?? {}).filter((name) => namesProviderSdk(name, banned)),
  );
}

function readTree(root: string): SourceFile[] {
  return sourceFiles(root).map((file) => ({
    rel: relative(root, file).split(sep).join('/'),
    source: readFileSync(file, 'utf8'),
  }));
}

const finding = (file: string, message: string): ConformanceFinding => ({ file, message });
const treeKey = (kind: 'api' | 'web', name: string): string => `${kind}:${name}`;

/** Runs the scan; see {@link aiNoSdkLeakSuite}. */
function check(_context: ConformanceContext, options: AiNoSdkLeakOptions): ConformanceReport {
  const registered = registeredAiSdkPackages();
  // What a package.json may not declare: the known SDKs, minus the ones a registered
  // provider definition owns (the folder that imports them declares them).
  const bannedInManifests = [...PROVIDER_SDK_PACKAGES, ...(options.extraSdkPackages ?? [])].filter((name) => !registered.includes(name));
  const banned = [...PROVIDER_SDK_PACKAGES, ...(options.extraSdkPackages ?? []), ...registered];
  const providerDirs = options.providerDirs ?? [];
  const scanned: Record<string, number> = {};
  const findings: ConformanceFinding[] = [];
  const providerDirFiles = new Map<string, number>(providerDirs.map((dir) => [dir, 0]));

  for (const [kind, trees] of [
    ['api', options.apiTrees],
    ['web', options.webTrees],
  ] as const) {
    for (const tree of trees) {
      const files = readTree(tree.root);
      const key = treeKey(kind, tree.name);
      scanned[key] = files.length;
      scanned[`${key}#sdkDirs`] = tree.sdkDirs?.length ?? 0;
      // Provider directories apply to app-side trees only: a web tree never gets one.
      const exempt = kind === 'api' ? [...(tree.sdkDirs ?? []), ...providerDirs] : [...(tree.sdkDirs ?? [])];
      if (kind === 'api') {
        for (const dir of providerDirs) {
          providerDirFiles.set(dir, (providerDirFiles.get(dir) ?? 0) + files.filter((file) => file.rel.startsWith(dir)).length);
        }
      }
      for (const message of findSdkLeaks(files, exempt, banned)) {
        findings.push(finding(`${key}|${message.split(': ')[0]}`, message.slice(message.indexOf(': ') + 2)));
      }
    }
  }

  const readManifest = (path: string): Record<string, unknown> => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

  for (const [dir, count] of providerDirFiles) {
    if (count === 0) findings.push(finding(`providerDir|${dir}`, 'holds no source file in any api tree, so it exempts nothing'));
  }
  scanned['providerDirs'] = providerDirs.length;
  scanned['registeredSdkPackages'] = registered.length;

  for (const [index, owner] of sdkOwners(options).entries()) {
    const declared = declaredSdks(readManifest(owner.manifest), banned);
    scanned[index === 0 ? 'sdkOwner#declared' : `sdkOwner#declared#${index}`] = owner.declares.filter((name) => declared.includes(name)).length;
  }
  for (const path of options.noSdkManifests) {
    for (const sdk of declaredSdks(readManifest(path), bannedInManifests)) findings.push(finding(`manifest|${path}`, `declares "${sdk}"`));
  }

  return { scanned, scannedFiles: {}, findings };
}

/** The findings of one tree, as `<file>: <message>` lines. */
function treeLines(report: ConformanceReport, key: string): string[] {
  return report.findings.filter((f) => f.file.startsWith(`${key}|`)).map((f) => `${f.file.slice(key.length + 1)}: ${f.message}`);
}

/** The tests the harness registers for this suite. */
function cases(options: AiNoSdkLeakOptions): ReadonlyArray<ConformanceCase> {
  const out: ConformanceCase[] = [];

  for (const [kind, trees] of [
    ['api', options.apiTrees],
    ['web', options.webTrees],
  ] as const) {
    for (const tree of trees) {
      const key = treeKey(kind, tree.name);
      const hasDirs = tree.sdkDirs !== undefined;

      out.push({
        name: `${tree.name}: finds a non-trivial source tree${hasDirs ? ' and at least one provider directory' : ''}, so this cannot pass vacuously`,
        run: (report, expect) => {
          expect(report.scanned[key]!).toBeGreaterThanOrEqual(tree.minFiles);
          if (hasDirs) expect(report.scanned[`${key}#sdkDirs`]!).toBeGreaterThanOrEqual(1);
        },
      });
      out.push({
        name: hasDirs
          ? `${tree.name}: imports no provider SDK outside its own adapter directory`
          : kind === 'api'
            ? `${tree.name}: imports no provider SDK anywhere: a feature calls AiService.forUser`
            : `${tree.name}: imports no provider SDK anywhere — the browser must never hold one, any more than it may hold a provider key`,
        run: (report, expect) => {
          expect(treeLines(report, key)).toEqual([]);
        },
      });
    }
  }

  if ((options.providerDirs ?? []).length > 0) {
    out.push({
      name: 'every provider directory holds source files, so a typo cannot exempt nothing and look green',
      run: (report, expect) => {
        expect(report.findings.filter((f) => f.file.startsWith('providerDir|')).map((f) => `${f.file.slice('providerDir|'.length)}: ${f.message}`)).toEqual([]);
      },
    });
  }

  for (const [index, owner] of sdkOwners(options).entries()) {
    const key = index === 0 ? 'sdkOwner#declared' : `sdkOwner#declared#${index}`;
    out.push({
      // The first owner keeps the title the single-owner form always had.
      name:
        index === 0
          ? 'declares the shipped SDKs in the owning package only'
          : `declares the shipped SDKs in the owning package only (${owner.manifest.split(/[\\/]/).slice(-2).join('/')})`,
      run: (report, expect) => {
        expect(report.scanned[key]!).toBeGreaterThanOrEqual(owner.declares.length);
      },
    });
  }

  for (const path of options.noSdkManifests) {
    out.push({
      name: `${path.split(/[\\/]/).slice(-3).join('/')} declares no provider SDK`,
      run: (report, expect) => {
        expect(treeLines(report, 'manifest').filter((line) => line.startsWith(path))).toEqual([]);
      },
    });
  }

  out.push(
    {
      name: 'the detector flags an SDK import planted in the app',
      run: (_report, expect) => {
        const planted: SourceFile[] = [
          { rel: 'features/summary.service.ts', source: `${IMPORT} OpenAI from 'openai';\nexport const x = 1;` },
          { rel: 'features/other.ts', source: `const sdk = ${REQUIRE}('@anthropic-ai/sdk/resources');` },
          { rel: 'features/fine.ts', source: "// mentions openai in prose only\nconst openaiKeyHint = 'x';" },
        ];
        expect(findSdkLeaks(planted)).toEqual([
          'features/summary.service.ts: imports "openai"',
          'features/other.ts: imports "@anthropic-ai/sdk/resources"',
        ]);
      },
    },
    {
      name: 'the detector exempts only the provider directories it is given',
      run: (_report, expect) => {
        const planted: SourceFile[] = [
          { rel: 'providers/openai/openai.adapter.ts', source: `${IMPORT} OpenAI from 'openai';` },
          { rel: 'runtime/ai.service.ts', source: `${IMPORT} OpenAI from 'openai';` },
        ];
        expect(findSdkLeaks(planted, ['providers/openai/'])).toEqual(['runtime/ai.service.ts: imports "openai"']);
      },
    },
    {
      name: 'the detector bans a registered provider SDK outside the provider directories, and allows it inside',
      run: (_report, expect) => {
        const planted: SourceFile[] = [
          { rel: 'platform-extensions/ai/kappa/kappa.adapter.ts', source: `${IMPORT} { Org Kappa } from 'kappa-sdk/client';` },
          { rel: 'features/summary.service.ts', source: `${IMPORT} { Org Kappa } from 'kappa-sdk';` },
        ];
        expect(findSdkLeaks(planted, ['platform-extensions/ai/'], [...PROVIDER_SDK_PACKAGES, 'kappa-sdk'])).toEqual([
          'features/summary.service.ts: imports "kappa-sdk"',
        ]);
      },
    },
    {
      name: 'the detector flags a provider SDK declared in an app package.json',
      run: (_report, expect) => {
        expect(declaredSdks({ name: 'api', dependencies: { '@nestjs/core': '^11', openai: '^7' } })).toEqual(['openai']);
        expect(declaredSdks({ devDependencies: { '@google/genai': '^2' } })).toEqual(['@google/genai']);
        expect(declaredSdks({ dependencies: { zod: '^4' } })).toEqual([]);
      },
    },
  );

  return out;
}

/**
 * The suite behind `runPlatformConformance({ suites: { aiNoSdkLeak } })`.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const aiNoSdkLeakSuite: ConformanceSuite<AiNoSdkLeakOptions> = {
  id: 'ai-no-sdk-leak',
  title: 'no AI provider SDK leaks outside its own adapter directory (#435, #739)',
  description: 'No provider SDK is imported outside the adapter directory that owns it, none in the web, none declared outside the owning package (AI rule 1).',
  check,
  cases,
};

if (!conformanceSuites.has(aiNoSdkLeakSuite.id)) conformanceSuites.register(aiNoSdkLeakSuite);
