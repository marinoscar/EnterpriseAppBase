// =============================================================================
// ESLint flat config: boundary rules for the platform packages (issue #690)
// =============================================================================
//
// Scope: `packages/platform-*/src/**` ONLY. The apps are not linted here (there
// is no repo-wide lint rule in CLAUDE.md), and the orphaned `.eslintrc.js` at
// the root is ignored by ESLint 9+ now that a flat config exists.
//
// Two guardrails from docs/specs/platform-packages.md (The Extension Contract
// -> Guardrails; Dependency graph):
//
//   Rule A - no deep imports. A package is reached only through its `exports`
//   map: never `@marinoscar/platform-x/src/...`, `/dist/...`, a slice's
//   `internal/` folder, a relative path that leaves the package, an app, or
//   `@app/shared` (product identity stays in the app; a package that needs a
//   name takes it as an option).
//
//   Rule B - slice direction. Every folder directly under
//   `packages/platform-<pkg>/src/` is a slice. A slice may import another
//   slice of the same package only when `packages/platform-slices.json` lists
//   it, and only through that slice's `index.ts`. Everything else inside a
//   slice (its `internal/` folder above all) is private to the slice.
//
// `createPlatformLintConfig()` is exported so the boundary tests
// (packages/platform-api/test/boundaries.spec.ts) can run the very same rules
// over a fixture workspace and a fixture graph.
// =============================================================================

import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import boundaries from 'eslint-plugin-boundaries';
import tsdoc from 'eslint-plugin-tsdoc';
import tseslint from 'typescript-eslint';

const ROOT = dirname(fileURLToPath(import.meta.url));

/** Files the platform lint applies to, relative to the ESLint `cwd`. */
export const PLATFORM_SOURCE_FILES = ['packages/platform-*/src/**/*.{ts,tsx}'];

/** Reads a slice graph file (`{ "platform-<pkg>": { "<slice>": ["<dep>"] } }`). */
export function readSliceGraph(path = join(ROOT, 'packages', 'platform-slices.json')) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const graph = {};
  for (const [pkg, slices] of Object.entries(raw)) {
    if (pkg.startsWith('$')) continue;
    graph[pkg] = slices;
  }
  return graph;
}

/**
 * Rule A, relative half: a relative import must resolve inside the importing
 * file's own package. `no-restricted-imports` matches the specifier as text,
 * so it cannot tell `../../core` (fine at depth 3) from `../../../platform-web`
 * (leaves the package); this rule resolves the path.
 */
const noRelativeEscape = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      escape:
        "'{{source}}' leaves {{pkg}}. Import another platform package by its name and a subpath from its exports map, never by a relative path.",
    },
  },
  create(context) {
    const filename = context.filename;
    const parts = filename.split(sep);
    const at = parts.lastIndexOf('packages');
    if (at < 0 || !parts[at + 1]?.startsWith('platform-')) return {};
    const packageRoot = parts.slice(0, at + 2).join(sep);
    const pkg = parts[at + 1];
    const check = (node) => {
      const source = node?.value;
      if (typeof source !== 'string' || !source.startsWith('.')) return;
      const target = resolve(dirname(filename), source);
      const rel = relative(packageRoot, target);
      if (rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith('/')) {
        context.report({ node, messageId: 'escape', data: { source, pkg } });
      }
    };
    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
    };
  },
};

const DEEP_IMPORT_PATTERNS = [
  {
    group: ['@marinoscar/platform-*/src', '@marinoscar/platform-*/src/**'],
    message: 'Import a platform package through its exports map, never its src/ folder.',
  },
  {
    group: ['@marinoscar/platform-*/dist', '@marinoscar/platform-*/dist/**'],
    message: 'Import a platform package through its exports map, never its dist/ folder.',
  },
  {
    group: ['@marinoscar/platform-*/**/internal', '@marinoscar/platform-*/**/internal/**'],
    message: "A slice's internal/ folder is private to that slice.",
  },
  {
    group: ['@app/shared', '@app/shared/**'],
    message: 'Platform packages never depend on the app identity package; take the name as an option.',
  },
  {
    group: ['**/apps/**', '**/packages/platform-*/**'],
    message: 'Platform packages never import an app, or another package by path.',
  },
];

/**
 * Rule B policies, generated from the slice graph. `boundaries/dependencies`
 * evaluates every policy and keeps the effect of the LAST one that matches,
 * so the order is: broad disallow first, narrow allows after.
 */
export function slicePolicies(graph) {
  const policies = [
    {
      // Base: no slice-to-slice import at all, across or within a package.
      from: { element: { type: 'slice' } },
      disallow: { to: { element: { type: 'slice' } } },
      message:
        "Slice '{{from.element.captured.slice}}' of {{from.element.captured.pkg}} may not import '{{to.element.captured.slice}}' of {{to.element.captured.pkg}} here. A slice imports another slice of its own package only when packages/platform-slices.json lists it, and only through that slice's index.ts.",
    },
    {
      // A slice never imports its package's root files (the barrel imports
      // the slices; the reverse is a cycle).
      from: { element: { type: 'slice' } },
      disallow: { to: { file: { categories: 'package-root' } } },
      message: "A slice may not import its package's root module; import the slice it needs instead.",
    },
    {
      // Inside one slice, anything goes (internal/ included).
      from: { element: { type: 'slice' } },
      allow: {
        to: {
          element: {
            type: 'slice',
            captured: {
              pkg: '{{ from.element.captured.pkg }}',
              slice: '{{ from.element.captured.slice }}',
            },
          },
        },
      },
    },
    {
      // Root files of a package (src/index.ts) re-export slices through each
      // slice's index only.
      from: { file: { categories: 'package-root' } },
      disallow: { to: { element: { type: 'slice' } } },
      message:
        "Import slice '{{to.element.captured.slice}}' through its index.ts, never a file inside it.",
    },
    {
      from: { file: { categories: 'package-root' } },
      allow: {
        to: {
          element: {
            type: 'slice',
            captured: { pkg: '{{ from.file.captured.pkg }}' },
            fileInternalPath: 'index.{ts,tsx}',
          },
        },
      },
    },
  ];
  for (const [pkg, slices] of Object.entries(graph)) {
    for (const [slice, deps] of Object.entries(slices)) {
      for (const dep of deps) {
        policies.push({
          from: { element: { type: 'slice', captured: { pkg, slice } } },
          allow: {
            to: {
              element: { type: 'slice', captured: { pkg, slice: dep }, fileInternalPath: 'index.{ts,tsx}' },
            },
          },
        });
      }
    }
  }
  return policies;
}

/**
 * eslint-plugin-tsdoc, pinned to the repository's tsdoc.json. Without a
 * type-aware program the plugin looks for tsdoc.json in
 * `context.parserOptions.tsconfigRootDir` (gone from ESLint 10's rule context)
 * and then in ESLint's `cwd`, so it would miss the root tsdoc.json whenever
 * ESLint runs from another directory (an editor, a package folder, the
 * fixture workspaces of the lint tests). The wrapper hands the rule a context
 * whose `parserOptions.tsconfigRootDir` is this file's directory; everything
 * else is the real context (its prototype).
 */
const tsdocAtRepoRoot = {
  rules: {
    syntax: {
      ...tsdoc.rules.syntax,
      create(context) {
        // ESLint freezes the context, so derive from it instead of wrapping it.
        const pinned = Object.create(context, {
          parserOptions: { value: { ...context.languageOptions?.parserOptions, tsconfigRootDir: ROOT } },
        });
        return tsdoc.rules.syntax.create(pinned);
      },
    },
  },
};

/**
 * The contract package's own import rules (issue #701; the conventions table of
 * packages/platform-contract/README.md). `@marinoscar/platform-contract` is
 * loaded by the API (CommonJS, Nest), the web app (ESM, browser) and the CLI,
 * so it may import zod and its own files and nothing else: no framework, no
 * Node built-in, no other platform package (every other package depends on
 * it; the reverse would be a cycle).
 */
export const CONTRACT_SOURCE_FILES = ['packages/platform-contract/src/**/*.{ts,tsx}'];

export const CONTRACT_RESTRICTED_IMPORT_PATTERNS = [
  {
    group: ['@nestjs/*', '@nestjs/*/**', 'nestjs-zod', 'nestjs-zod/**'],
    message: 'The contract is framework-free: Nest and nestjs-zod belong to @marinoscar/platform-api (it wraps contract schemas with createZodDto).',
  },
  {
    group: ['react', 'react/**', 'react-dom', 'react-dom/**', '@mui/*', '@mui/*/**', '@emotion/*'],
    message: 'The contract is framework-free: React and MUI belong to @marinoscar/platform-web.',
  },
  {
    group: ['node:*'],
    message: 'The contract runs in the browser too: no Node built-in.',
  },
  {
    group: ['@marinoscar/platform-*', '@marinoscar/platform-*/**'],
    message: 'The contract imports no other platform package; they all depend on it.',
  },
];

export const CONTRACT_RESTRICTED_IMPORT_PATHS = builtinModules
  .filter((name) => !name.startsWith('_'))
  .map((name) => ({ name, message: 'The contract runs in the browser too: no Node built-in.' }));

/**
 * A web slice's headless entry (issue #704): hooks, services and helpers with
 * no component, so an app can build its own UI on them. It may use MUI's
 * theme module (`@mui/material/styles`: the token contract and `useTheme`)
 * and nothing else of `@mui/*`, no `@emotion/*` and no `@mui/x-*` chart or
 * grid. The slice's theme-token folder is exported through `/headless`, so it
 * follows the same rule.
 */
export const WEB_HEADLESS_SOURCE_FILES = [
  'packages/platform-web/src/*/headless/**/*.{ts,tsx}',
  'packages/platform-web/src/*/theme/**/*.{ts,tsx}',
];

export const WEB_HEADLESS_RESTRICTED_IMPORT_PATTERNS = [
  {
    group: ['@mui/*', '@mui/*/**', '!@mui/material', '!@mui/material/styles'],
    message: 'A headless entry imports no MUI component module; only @mui/material/styles (theme types and useTheme).',
  },
  {
    group: ['@emotion/*', '@emotion/*/**'],
    message: 'A headless entry renders no styled component.',
  },
];

export const WEB_HEADLESS_RESTRICTED_IMPORT_PATHS = [
  { name: '@mui/material', message: 'A headless entry imports no MUI component; only @mui/material/styles.' },
];

/** The whole flat config for a given slice graph. */
export function createPlatformLintConfig({ graph = readSliceGraph(), rootPath = ROOT } = {}) {
  return [
    // Never lint dependencies or build output.
    { ignores: ['**/node_modules/**', '**/dist/**'] },
    {
      files: PLATFORM_SOURCE_FILES,
      languageOptions: {
        parser: tseslint.parser,
        parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
      },
      linterOptions: { reportUnusedDisableDirectives: 'error' },
      plugins: {
        boundaries,
        platform: { rules: { 'no-relative-escape': noRelativeEscape } },
      },
      settings: {
        'import/resolver': {
          typescript: {
            alwaysTryTypes: true,
            project: 'packages/platform-*/tsconfig.json',
            noWarnOnMultipleProjects: true,
          },
        },
        // Element patterns are relative to this; it must be the repo root
        // (ESLint's own `cwd` is not passed to plugins).
        'boundaries/root-path': rootPath,
        'boundaries/include': PLATFORM_SOURCE_FILES,
        'boundaries/elements': [
          {
            type: 'slice',
            pattern: 'packages/*/src/*',
            capture: ['pkg', 'slice'],
          },
        ],
        // The files at the root of a package's src/ (the barrel, src/index.ts)
        // belong to no slice; they are classified by file category instead.
        'boundaries/files': [
          { category: 'package-root', pattern: 'packages/*/src/*.{ts,tsx}', capture: ['pkg', 'file'] },
        ],
      },
      rules: {
        'no-restricted-imports': ['error', { patterns: DEEP_IMPORT_PATTERNS }],
        'platform/no-relative-escape': 'error',
        'boundaries/dependencies': ['error', { default: 'allow', policies: slicePolicies(graph) }],
      },
    },
    // TSDoc syntax (issue #693; docs/PACKAGES.md). Every doc comment in a
    // platform package must parse as TSDoc under the repository's tsdoc.json,
    // which declares the two platform tags `@stability` and `@extensionPoint`
    // on top of TypeDoc's.
    {
      files: PLATFORM_SOURCE_FILES,
      plugins: { tsdoc: tsdocAtRepoRoot },
      rules: { 'tsdoc/syntax': 'error' },
    },
    // A web slice's headless entry imports no MUI component (issue #704). A
    // later block replaces `no-restricted-imports` for these files, so it
    // repeats the deep-import patterns of rule A.
    {
      files: WEB_HEADLESS_SOURCE_FILES,
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: WEB_HEADLESS_RESTRICTED_IMPORT_PATHS,
            patterns: [...DEEP_IMPORT_PATTERNS, ...WEB_HEADLESS_RESTRICTED_IMPORT_PATTERNS],
          },
        ],
      },
    },
    // The contract's import rules (issue #701). A later block replaces the
    // options of `no-restricted-imports` for these files, so it repeats the
    // deep-import patterns of rule A before adding its own.
    {
      files: CONTRACT_SOURCE_FILES,
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: CONTRACT_RESTRICTED_IMPORT_PATHS,
            patterns: [...DEEP_IMPORT_PATTERNS, ...CONTRACT_RESTRICTED_IMPORT_PATTERNS],
          },
        ],
      },
    },
  ];
}

export default createPlatformLintConfig();
