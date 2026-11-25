// =============================================================================
// The orchestration boundary, as a parameterised conformance suite (#739)
// =============================================================================
//
// CLAUDE.md AI rule 6, harvested from EvoPath's
// `apps/api/test/ai/ai-orchestration-boundary.spec.ts`: orchestration
// libraries (LangGraph, `@langchain/core`) orchestrate model calls ABOVE
// `AiService`; they never make one. So:
//
//   (a) an ALLOWED orchestration package (`allowedRoots`) may be imported only
//       by files under its allowed path prefixes of an API source root;
//   (b) every other orchestration package is banned everywhere: by default
//       `langchain` (the umbrella), `langsmith` (a tracing client that posts
//       runs to a hosted endpoint), every `@langchain/*` package not allowed
//       (a `@langchain/<provider>` integration is a model client of its own)
//       and every `@ai-sdk/*` package;
//   (c) no web source imports any of them (the browser holds no
//       orchestration runtime);
//   (d) no `package.json` declares a banned package, or a `@langchain/*`
//       package that `allowedRoots` does not name.
//
// The base runs it with `allowedRoots: {}`: no orchestration library anywhere.
// EvoPath passes `{ '@langchain/langgraph': ['training-agents/'],
// '@langchain/core': ['training-agents/'] }`.
//
// The scan reads import specifiers, never a grep for a word, and fails when
// it stops seeing the tree.
// =============================================================================

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Options of {@link runOrchestrationBoundarySuite}.
 *
 * @stability experimental
 */
export interface OrchestrationBoundaryOptions {
  /** Absolute API source roots to scan (the app's `src`, `packages/platform-api/src`). */
  readonly apiSourceRoots: readonly string[];
  /** Absolute web source roots to scan: no orchestration import at all. */
  readonly webSourceRoots: readonly string[];
  /** Absolute `package.json` paths whose dependencies are checked. */
  readonly packageJsonPaths: readonly string[];
  /**
   * Orchestration packages the app allows, each with the path prefixes
   * (relative to an API source root, forward slashes) it may be imported
   * under. `{}`: none anywhere.
   */
  readonly allowedRoots: Readonly<Record<string, readonly string[]>>;
  /**
   * Package names (or `scope/*` patterns) banned everywhere. Default:
   * {@link DEFAULT_BANNED_ORCHESTRATION_PACKAGES}, plus every `@langchain/*`
   * package `allowedRoots` does not name.
   */
  readonly banned?: readonly string[];
  /** Fewest API source files the scan must find (default 50), so it cannot pass vacuously. */
  readonly minApiFiles?: number;
}

/**
 * The packages banned everywhere by default.
 *
 * @stability experimental
 */
export const DEFAULT_BANNED_ORCHESTRATION_PACKAGES: readonly string[] = Object.freeze([
  'langchain',
  'langsmith',
  '@ai-sdk/*',
  '@langchain/*',
]);

/**
 * One scanned source file.
 *
 * @stability experimental
 */
export interface OrchestrationScannedFile {
  /** Path relative to its source root, forward slashes. */
  readonly rel: string;
  /** Its import, re-export, dynamic import and require specifiers. */
  readonly specifiers: readonly string[];
}

/**
 * One manifest's declared dependency names, every dependency field.
 *
 * @stability experimental
 */
export interface OrchestrationManifest {
  /** For messages. */
  readonly path: string;
  /** `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`. */
  readonly declared: readonly string[];
}

/** The package a specifier names (`@scope/name` or `name`), or null for a relative one. */
function packageOf(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) return null;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

function matchesPattern(pkg: string, pattern: string): boolean {
  return pattern.endsWith('/*') ? pkg.startsWith(pattern.slice(0, -1)) : pkg === pattern;
}

/**
 * Whether `pkg` is banned: it matches a `banned` pattern and is not one of
 * the allowed orchestration packages.
 *
 * @param pkg - a package name.
 * @param options - the allowed roots and the banned list.
 *
 * @stability experimental
 */
export function isBannedOrchestrationPackage(
  pkg: string,
  options: Pick<OrchestrationBoundaryOptions, 'allowedRoots' | 'banned'>,
): boolean {
  if (Object.prototype.hasOwnProperty.call(options.allowedRoots, pkg)) return false;
  return (options.banned ?? DEFAULT_BANNED_ORCHESTRATION_PACKAGES).some((pattern) => matchesPattern(pkg, pattern));
}

/**
 * Every violation of the boundary in already-scanned input. Pure, so the
 * rules are tested against fixtures.
 *
 * @param input - the API files, the web files and the manifests.
 * @param options - the allowed roots and the banned list.
 * @returns one message per violation; empty when the boundary holds.
 *
 * @stability experimental
 */
export function findOrchestrationViolations(
  input: {
    readonly apiFiles: readonly OrchestrationScannedFile[];
    readonly webFiles: readonly OrchestrationScannedFile[];
    readonly manifests: readonly OrchestrationManifest[];
  },
  options: Pick<OrchestrationBoundaryOptions, 'allowedRoots' | 'banned'>,
): string[] {
  const violations: string[] = [];
  const allowed = options.allowedRoots;

  for (const file of input.apiFiles) {
    for (const specifier of file.specifiers) {
      const pkg = packageOf(specifier);
      if (!pkg) continue;
      if (Object.prototype.hasOwnProperty.call(allowed, pkg)) {
        if (!allowed[pkg]!.some((prefix) => file.rel.startsWith(prefix))) {
          violations.push(`${file.rel}: imports "${specifier}" outside ${allowed[pkg]!.join(', ') || '(no allowed root)'}`);
        }
      } else if (isBannedOrchestrationPackage(pkg, options)) {
        violations.push(`${file.rel}: imports banned "${specifier}"`);
      }
    }
  }

  for (const file of input.webFiles) {
    for (const specifier of file.specifiers) {
      const pkg = packageOf(specifier);
      if (pkg && (Object.prototype.hasOwnProperty.call(allowed, pkg) || isBannedOrchestrationPackage(pkg, options))) {
        violations.push(`${file.rel}: a web source imports "${specifier}"`);
      }
    }
  }

  for (const manifest of input.manifests) {
    for (const name of manifest.declared) {
      if (isBannedOrchestrationPackage(name, options)) violations.push(`${manifest.path}: declares banned "${name}"`);
    }
  }

  return violations;
}

/**
 * The import specifiers of one source text.
 *
 * @param source - TypeScript or JavaScript source.
 *
 * @stability experimental
 */
export function orchestrationImportSpecifiers(source: string): string[] {
  const patterns = [
    /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  return patterns.flatMap((re) => [...source.matchAll(re)].map((match) => match[1]!));
}

function sourceFiles(dir: string): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === 'dist') return [];
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!/\.(ts|tsx)$/.test(entry) || /\.(spec|test)\.tsx?$/.test(entry)) return [];
    return [full];
  });
}

function scanRoot(root: string): OrchestrationScannedFile[] {
  return sourceFiles(root).map((file) => ({
    rel: relative(root, file).split('\\').join('/'),
    specifiers: orchestrationImportSpecifiers(readFileSync(file, 'utf8')),
  }));
}

function readManifest(path: string): OrchestrationManifest {
  const json = JSON.parse(readFileSync(path, 'utf8')) as Record<string, Record<string, string> | undefined>;
  const fields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
  return { path, declared: fields.flatMap((field) => Object.keys(json[field] ?? {})) };
}

/**
 * Registers the orchestration-boundary suite (Jest `describe`/`it`). Call it
 * from one spec file of the app.
 *
 * @param options - the roots, manifests and allowed orchestration packages.
 *
 * @example
 * ```ts
 * runOrchestrationBoundarySuite({
 *   apiSourceRoots: [join(REPO, 'apps/api/src'), join(REPO, 'packages/platform-api/src')],
 *   webSourceRoots: [join(REPO, 'apps/web/src')],
 *   packageJsonPaths: [join(REPO, 'apps/api/package.json')],
 *   allowedRoots: {},
 * });
 * ```
 *
 * @stability experimental
 */
export function runOrchestrationBoundarySuite(options: OrchestrationBoundaryOptions): void {
  describe('the AI orchestration boundary (CLAUDE.md AI rule 6)', () => {
    const apiFiles = options.apiSourceRoots.flatMap((root) => scanRoot(root));
    const webFiles = options.webSourceRoots.flatMap((root) => scanRoot(root));
    const manifests = options.packageJsonPaths.map((path) => readManifest(path));

    it('finds the trees and the manifests, so it cannot pass vacuously', () => {
      expect(apiFiles.length).toBeGreaterThanOrEqual(options.minApiFiles ?? 50);
      expect(manifests.length).toBe(options.packageJsonPaths.length);
    });

    it('imports an allowed orchestration package only under its allowed roots, and no banned one anywhere', () => {
      expect(findOrchestrationViolations({ apiFiles, webFiles: [], manifests: [] }, options)).toEqual([]);
    });

    it('imports no orchestration package from any web source', () => {
      expect(findOrchestrationViolations({ apiFiles: [], webFiles, manifests: [] }, options)).toEqual([]);
    });

    it('declares no banned orchestration package in any manifest', () => {
      expect(findOrchestrationViolations({ apiFiles: [], webFiles: [], manifests }, options)).toEqual([]);
    });
  });
}
