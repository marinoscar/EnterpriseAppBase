// =============================================================================
// Suite: every `@Cron` enqueues rather than working (issues #353, #694)
// =============================================================================
//
// Epic #345 decision 1: every long-running activity is a queue job. A `@Cron`
// only decides WHETHER work is due and enqueues it. This suite reads the BODY of
// every `@Cron`-decorated method under the app's source roots and requires two
// things of it: that it queues something, and that it contains none of the
// markers of doing the work itself.
//
// It does not follow calls into helper methods: a cron calling
// `this.fireDueBackup(...)` is trusted, and that helper's own spec is what pins
// that it only enqueues. This is a tripwire on the shape of a cron body, not a
// proof about the whole call graph.
//
// Known limit, kept on purpose: the body opens at the first `{` after `@Cron(`,
// so a decorator OPTIONS object is read as the body and reported as queueing
// nothing. That fails loudly, never silently; no cron in the base uses options.
//
// The scan was moved here UNCHANGED from apps/api/test/jobs/cron-enqueue-only.spec.ts:
// same markers, same enqueue pattern, same brace matching. What the app keeps
// is DATA: its exemption list (each one argued) and its vacuity minimum.
// =============================================================================

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import type {
  ConformanceCase,
  ConformanceContext,
  ConformanceFinding,
  ConformanceReport,
  ConformanceSuite,
} from '../conformance-suite';

/**
 * How an app configures the cron suite.
 *
 * @example
 * ```ts
 * const options: CronEnqueueOnlyOptions = {
 *   exempt: [{ file: 'jobs/tasks/job-stuck-reset.task.ts', why: 'The lease reaper recovers abandoned jobs; recovery cannot depend on the queue it recovers.' }],
 *   minCronFiles: 8,
 * };
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface CronEnqueueOnlyOptions {
  /**
   * Files allowed to work inline, as paths relative to the source root that
   * contains them (`/` separators). Each needs a written reason of more than 40
   * characters; the suite fails when an exempt file holds no `@Cron`.
   */
  exempt: ReadonlyArray<{
    /** The exempt file, relative to its source root, with `/` separators. */
    file: string;
    /**
     * The source root the file lives under (absolute). Optional: without it, a
     * file at that relative path under ANY root is exempt. Pin it when several
     * roots are scanned (a packaged slice's `tasks/` next to the app's), so the
     * exemption names exactly one file.
     */
    root?: string;
    /** Why the work must not be a job; more than 40 characters. */
    why: string;
  }>;
  /** Vacuity guard: at least this many files with a `@Cron` must be found. */
  minCronFiles: number;
  /** Extra markers an app adds for its own work helpers. Additive only; the platform markers always apply. */
  extraWorkMarkers?: ReadonlyArray<{
    /** Matches a cron body that does the work itself. */
    pattern: RegExp;
    /** What the match is, completing `a @Cron body containing ...`. */
    what: string;
  }>;
}

/**
 * Markers of a cron doing the work itself.
 *
 * Deliberately concrete rather than clever: these are the exact shapes the
 * seven converted crons used to contain, so a revert reintroduces one of them
 * almost by definition.
 */
const WORK_MARKERS: ReadonlyArray<{ pattern: RegExp; what: string }> = [
  { pattern: /\.deleteMany\(/, what: 'a bulk delete' },
  { pattern: /\.updateMany(AndReturn)?\(/, what: 'a bulk update' },
  { pattern: /\.\$executeRaw/, what: 'raw SQL' },
  { pattern: /withAdminConnection\(/, what: 'a cluster admin connection' },
  { pattern: /\bcleanupExpired\w*\(/, what: 'an inline cleanup call' },
  { pattern: /\.prune\(\)/, what: 'an inline retention prune' },
  { pattern: /\bdropExpired\w*\(/, what: 'an inline DROP DATABASE sweep' },
  { pattern: /\bthis\.sweep\(/, what: 'an inline sweep' },
  { pattern: /\bthis\.releaseStaleRuns\(/, what: 'an inline stale release' },
  { pattern: /\bthis\.storage(Provider)?\./, what: 'a direct storage-provider call' },
];

/** What a cron body must contain to count as queueing its work. */
const ENQUEUES = /enqueueHousekeepingJob\(|\.enqueue\(/;

/** Every `.ts` file under `dir`, excluding tests. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!entry.endsWith('.ts') || entry.endsWith('.spec.ts')) return [];

    return [full];
  });
}

/**
 * The body of every `@Cron`-decorated method in `source`, brace-matched.
 *
 * Brace matching rather than a regex over the whole method: a cron body
 * contains braces (template literals, object arguments, nested blocks), and a
 * lazy match would stop at the first `}` and declare every task compliant.
 */
function cronBodies(source: string): string[] {
  const bodies: string[] = [];
  let index = source.indexOf('@Cron(');

  while (index !== -1) {
    const open = source.indexOf('{', index);

    if (open === -1) break;

    let depth = 0;
    let end = open;

    for (; end < source.length; end += 1) {
      if (source[end] === '{') depth += 1;
      else if (source[end] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }

    bodies.push(source.slice(open, end + 1));
    index = source.indexOf('@Cron(', end);
  }

  return bodies;
}

/** Runs the scan; see {@link cronEnqueueOnlySuite}. */
function check(context: ConformanceContext, options: CronEnqueueOnlyOptions): ConformanceReport {
  if (context.sourceRoots.length === 0) {
    throw new Error('cron-enqueue-only: sourceRoots is empty, so there is nothing to scan.');
  }
  if (!Number.isInteger(options.minCronFiles) || options.minCronFiles < 1) {
    throw new Error('cron-enqueue-only: minCronFiles must be a positive integer, or the scan could pass vacuously.');
  }

  const markers = [...WORK_MARKERS, ...(options.extraWorkMarkers ?? [])];
  const isExempt = (file: { path: string; rel: string }): boolean =>
    options.exempt.some((entry) =>
      entry.root === undefined ? entry.file === file.rel : resolve(entry.root, entry.file) === resolve(file.path),
    );

  const files = context.sourceRoots
    .flatMap((root) => {
      let found: string[];
      try {
        found = sourceFiles(root);
      } catch (cause) {
        throw new Error(`cron-enqueue-only: cannot read source root ${root}: ${(cause as Error).message}`);
      }
      return found.map((file) => ({ path: file, rel: relative(root, file).split('\\').join('/') }));
    })
    .map((file) => ({ ...file, source: readFileSync(file.path, 'utf8') }))
    .filter((file) => file.source.includes('@Cron('));

  const findings: ConformanceFinding[] = [];

  for (const file of files) {
    if (isExempt(file)) continue;

    for (const body of cronBodies(file.source)) {
      if (!ENQUEUES.test(body)) {
        findings.push({ file: file.rel, message: 'a @Cron body that queues nothing' });
      }

      for (const marker of markers) {
        if (marker.pattern.test(body)) {
          findings.push({ file: file.rel, message: `a @Cron body containing ${marker.what}` });
        }
      }
    }
  }

  return {
    scanned: { cronFiles: files.length },
    scannedFiles: {
      cronFiles: files.map((file) => file.rel),
      // Absolute paths, for an exemption pinned to its root.
      cronPaths: files.map((file) => resolve(file.path)),
    },
    findings,
  };
}

/** The tests the harness registers for this suite. */
function cases(options: CronEnqueueOnlyOptions): ReadonlyArray<ConformanceCase> {
  return [
    {
      // The failure this guards: a refactor moves the tasks, the scan finds
      // nothing, and every case below passes over an empty list.
      name: 'finds the crons at all, so a broken scan cannot pass vacuously',
      run: (report, expect) => {
        expect(report.scanned.cronFiles).toBeGreaterThanOrEqual(options.minCronFiles);
      },
    },
    ...options.exempt.map(
      (entry): ConformanceCase => ({
        name: `exempts ${entry.file}, on the record`,
        run: (report, expect) => {
          // The exemption is only real if the file is: a stale entry would
          // silently exempt nothing while looking like it exempted something.
          if (entry.root === undefined) expect(report.scannedFiles.cronFiles).toContain(entry.file);
          else expect(report.scannedFiles.cronPaths).toContain(resolve(entry.root, entry.file));
          expect(entry.why.length).toBeGreaterThanOrEqual(41);
        },
      }),
    ),
    {
      name: 'queues its work instead of doing it, in every non-exempt cron',
      run: (report, expect) => {
        expect(report.findings.map((finding) => `${finding.file}: ${finding.message}`)).toEqual([]);
      },
    },
  ];
}

/**
 * The suite behind `runPlatformConformance({ suites: { cronEnqueueOnly } })`:
 * every `@Cron` body enqueues a job and contains no marker of inline work.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const cronEnqueueOnlySuite: ConformanceSuite<CronEnqueueOnlyOptions> = {
  id: 'cron-enqueue-only',
  title: 'every @Cron enqueues rather than working',
  description: 'A @Cron body only decides whether work is due and enqueues a job; it never does the work inline.',
  check,
  cases,
};
