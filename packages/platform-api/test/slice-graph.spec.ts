import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Checks packages/platform-slices.json, the slice dependency graph the
 * boundary lint (eslint.config.mjs, rule B) is generated from:
 *
 *   - every edge points at a slice declared in the same package,
 *   - the graph is acyclic (docs/specs/platform-packages.md#dependency-graph:
 *     a slice depends only on slices above it),
 *   - every directory under packages/platform-<pkg>/src/ is a declared slice,
 *   - every declared slice exists on disk.
 *
 * Each check is a pure function, exercised against fixture graphs first so a
 * broken checker cannot pass the real graph by accident.
 */

type SliceGraph = Record<string, Record<string, string[]>>;

const PACKAGES_DIR = join(__dirname, '..', '..');
const GRAPH_FILE = join(PACKAGES_DIR, 'platform-slices.json');

/**
 * Slices the graph declares ahead of their code. `core` and `testing` are
 * seeded here by #690 so the edge `testing -> core` exists before #694 moves
 * the registry primitive and the conformance harness into them. Remove an
 * entry when its directory lands; the "exists" check then covers it.
 */
const PENDING_SLICES: Record<string, string[]> = {
  'platform-api': ['core', 'testing'],
};

function readGraph(file: string): SliceGraph {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(raw).filter(([key]) => !key.startsWith('$'))) as SliceGraph;
}

/** Edges whose target is not a slice of the same package. */
function undeclaredTargets(graph: SliceGraph): string[] {
  const problems: string[] = [];
  for (const [pkg, slices] of Object.entries(graph)) {
    for (const [slice, deps] of Object.entries(slices)) {
      for (const dep of deps) {
        if (!(dep in slices)) problems.push(`${pkg}: ${slice} -> ${dep} (undeclared)`);
        if (dep === slice) problems.push(`${pkg}: ${slice} -> ${slice} (self edge)`);
      }
    }
  }
  return problems;
}

/** The first cycle found, as `pkg: a -> b -> a`, or null. */
function findCycle(graph: SliceGraph): string | null {
  for (const [pkg, slices] of Object.entries(graph)) {
    const state = new Map<string, 'visiting' | 'done'>();
    const stack: string[] = [];
    const visit = (slice: string): string | null => {
      if (state.get(slice) === 'done') return null;
      if (state.get(slice) === 'visiting') {
        return `${pkg}: ${[...stack.slice(stack.indexOf(slice)), slice].join(' -> ')}`;
      }
      state.set(slice, 'visiting');
      stack.push(slice);
      for (const dep of slices[slice] ?? []) {
        const cycle = visit(dep);
        if (cycle) return cycle;
      }
      stack.pop();
      state.set(slice, 'done');
      return null;
    };
    for (const slice of Object.keys(slices)) {
      const cycle = visit(slice);
      if (cycle) return cycle;
    }
  }
  return null;
}

/** Directories under `<packagesDir>/<pkg>/src/` (files at the root are not slices). */
function sliceDirectories(packagesDir: string, pkg: string): string[] {
  const src = join(packagesDir, pkg, 'src');
  if (!existsSync(src)) return [];
  return readdirSync(src, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Packages on disk that are not in the graph, and slice directories the graph does not declare. */
function undeclaredOnDisk(graph: SliceGraph, packagesDir: string): string[] {
  const problems: string[] = [];
  const packages = readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('platform-'))
    .map((entry) => entry.name);
  for (const pkg of packages) {
    if (!(pkg in graph)) {
      problems.push(`${pkg} (package missing from the graph)`);
      continue;
    }
    for (const dir of sliceDirectories(packagesDir, pkg)) {
      if (!(dir in graph[pkg]!)) problems.push(`${pkg}/src/${dir} (slice missing from the graph)`);
    }
  }
  return problems;
}

/** Declared slices with no directory on disk, minus the pending ones. */
function missingOnDisk(
  graph: SliceGraph,
  packagesDir: string,
  pending: Record<string, string[]> = {},
): string[] {
  const problems: string[] = [];
  for (const [pkg, slices] of Object.entries(graph)) {
    if (!existsSync(join(packagesDir, pkg))) {
      problems.push(`${pkg} (declared package does not exist)`);
      continue;
    }
    const present = new Set(sliceDirectories(packagesDir, pkg));
    for (const slice of Object.keys(slices)) {
      if (!present.has(slice) && !(pending[pkg] ?? []).includes(slice)) {
        problems.push(`${pkg}/src/${slice} (declared slice does not exist)`);
      }
    }
  }
  return problems;
}

describe('slice graph checker (fixture graphs)', () => {
  it('finds a direct and an indirect cycle', () => {
    expect(findCycle({ p: { a: ['b'], b: ['a'] } })).toBe('p: a -> b -> a');
    expect(findCycle({ p: { core: [], a: ['b'], b: ['c'], c: ['a', 'core'] } })).toBe('p: a -> b -> c -> a');
  });

  it('accepts an acyclic graph, including a diamond', () => {
    expect(findCycle({ p: { core: [], otel: ['core'], ident: ['core', 'otel'], jobs: ['ident', 'otel'] } })).toBeNull();
  });

  it('flags an edge to an undeclared slice and a self edge', () => {
    expect(undeclaredTargets({ p: { a: ['ghost'], b: ['b'] } })).toEqual([
      'p: a -> ghost (undeclared)',
      'p: b -> b (self edge)',
    ]);
  });

  it('flags an undeclared slice directory and a declared slice with no directory', () => {
    // Runs against the real packages/ tree: platform-api exists but has no
    // `ghost` slice, and an empty graph declares none of the packages.
    const fixture: SliceGraph = { 'platform-api': { ghost: [] } };
    expect(missingOnDisk(fixture, PACKAGES_DIR)).toEqual(['platform-api/src/ghost (declared slice does not exist)']);
    expect(missingOnDisk(fixture, PACKAGES_DIR, { 'platform-api': ['ghost'] })).toEqual([]);
    expect(undeclaredOnDisk({}, PACKAGES_DIR)).toContain('platform-api (package missing from the graph)');
  });
});

describe('packages/platform-slices.json', () => {
  const graph = readGraph(GRAPH_FILE);

  it('declares every platform package', () => {
    expect(Object.keys(graph).sort()).toEqual([
      'platform-api',
      'platform-cli',
      'platform-contract',
      'platform-db',
      'platform-infra',
      'platform-web',
    ]);
  });

  it('has only edges to declared slices of the same package', () => {
    expect(undeclaredTargets(graph)).toEqual([]);
  });

  it('is acyclic', () => {
    expect(findCycle(graph)).toBeNull();
  });

  it('declares every slice directory under packages/platform-*/src/', () => {
    expect(undeclaredOnDisk(graph, PACKAGES_DIR)).toEqual([]);
  });

  it('declares no slice that does not exist (pending slices excepted)', () => {
    expect(missingOnDisk(graph, PACKAGES_DIR, PENDING_SLICES)).toEqual([]);
  });

  it('keeps PENDING_SLICES honest: remove a slice from it once its directory exists', () => {
    for (const [pkg, slices] of Object.entries(PENDING_SLICES)) {
      for (const slice of slices) {
        expect(`${pkg}/src/${slice} exists: ${existsSync(join(PACKAGES_DIR, pkg, 'src', slice))}`).toBe(
          `${pkg}/src/${slice} exists: false`,
        );
      }
    }
  });
});
