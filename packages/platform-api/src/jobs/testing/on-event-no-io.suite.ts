// =============================================================================
// Suite: no event listener body does storage I/O (issue #520, moved by #742)
// =============================================================================
//
// CLAUDE.md, "Every Long-Running Activity Is a Queue Job", rule 1: an event
// listener body that downloads or spawns is a violation. The `cron-enqueue-only`
// suite made the cron half of that rule executable; this is the listener half.
//
// The violation it was written for is the one #520 removed:
// `ObjectProcessingService.handleObjectUploaded`, an async listener on
// `storage.object.uploaded` that downloaded every uploaded object and ran the
// processors on it inside the event dispatch: no worker slot, no timeout, no
// retry, no row in the admin Jobs page, and an object stuck `processing` for
// ever if the process died mid-run. It is now the `storage.object.process`
// job. The "catches the listener #520 removed" case replays that exact body
// through the detector, so the suite is known to catch it.
//
// WHAT IT CHECKS, AND WHAT IT HONESTLY CANNOT. It reads the BODY of every
// listener method under the app's source roots and fails when it contains a
// marker of storage I/O: a call on an injected storage provider, or a
// `.download(` / `.upload(` call. It does not follow calls into helpers: a
// listener calling `this.processing.markAbandoned(...)` is trusted, and that
// helper's own spec pins that it is one bounded row. Like its cron sibling it
// is a tripwire on the shape of a listener body, not a proof about the call
// graph.
//
// Bounded single-row writes in a listener (the broadcast failure listener, the
// node secret revoker, the AI handlers' orphaned-run failure) are deliberately
// NOT markers: docs/specs/job-queue.md, "All long-running work is a job", names
// them as outside the rule.
//
// The scan was moved here UNCHANGED from the reference app's
// `apps/api/test/jobs/on-event-no-io.spec.ts`: same markers, same decorator
// skipping, same comment stripping. What the app keeps is DATA: the roots it
// scans, the listener files that must be seen, and the vacuity minimums.
//
// A note on how this file spells the decorator name: the scan finds listeners
// by the decorator's text, and this file is itself under a scanned root in the
// reference app, so the name is assembled (DECORATOR) rather than written out
// in code. Comments are stripped before the scan, so prose may name it.
// =============================================================================

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { conformanceSuites } from '../../testing/index';
import type {
  ConformanceCase,
  ConformanceContext,
  ConformanceFinding,
  ConformanceReport,
  ConformanceSuite,
} from '../../testing/index';

declare module '../../testing/index' {
  interface PlatformConformanceSuiteOptions {
    /** The `on-event-no-io` suite: its options, or `{ skip: 'reason' }` to opt out. Registered by importing `@marinoscar/platform-api/jobs/testing`. */
    onEventNoIo?: OnEventNoIoOptions;
  }
}

/**
 * How an app configures the listener suite.
 *
 * @example
 * ```ts
 * import '@marinoscar/platform-api/jobs/testing'; // registers the suite
 * runPlatformConformance({
 *   sourceRoots: CRON_SOURCE_ROOTS,
 *   suites: {
 *     onEventNoIo: {
 *       minListenerFiles: 5,
 *       mustScan: ['nodes/ops/node-secret-revoker.ts'],
 *     },
 *   },
 * });
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface OnEventNoIoOptions {
  /** Vacuity guard: at least this many files holding a listener must be found. A positive integer. */
  minListenerFiles: number;
  /** Vacuity guard: at least this many listener bodies must be found. Default: `minListenerFiles`. */
  minListenerBodies?: number;
  /**
   * Listener files that must be among those scanned, as paths relative to the
   * source root that holds them (`/` separators). Proves the scan reaches the
   * packaged slices' listeners and not only the app's own.
   */
  mustScan?: readonly string[];
  /** Extra markers an app adds for its own I/O helpers. Additive only; the platform markers always apply. */
  extraIoMarkers?: ReadonlyArray<{
    /** Matches a listener body that does I/O itself. */
    pattern: RegExp;
    /** What the match is, completing `an event listener body containing ...`. */
    what: string;
  }>;
}

/** The decorator's call text, assembled so this file never matches its own scan. */
const DECORATOR = ['@On', 'Event('].join('');

/** Markers of a listener moving object bytes itself. */
const IO_MARKERS: ReadonlyArray<{ pattern: RegExp; what: string }> = [
  { pattern: /\bthis\.storage(Provider)?\./, what: 'a direct storage-provider call' },
  { pattern: /\.download\(/, what: 'a download' },
  { pattern: /\.upload\(/, what: 'an upload' },
];

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
 * `source` with its comments blanked out.
 *
 * A file's header routinely NAMES the decorator in prose; scanning that as code
 * would take the next method in the file as a listener body. Block comments
 * and whole-line `//` comments are removed; a `//` after code on the same line
 * is left alone rather than risk eating a URL inside a string.
 *
 * @param source - TypeScript source.
 * @returns the source without comments.
 *
 * @stability experimental
 */
export function stripListenerComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Index just past the bracket that closes the one opening at `open`. */
function skipBalanced(source: string, open: number, openChar: string, closeChar: string): number {
  let depth = 0;

  for (let i = open; i < source.length; i += 1) {
    if (source[i] === openChar) depth += 1;
    else if (source[i] === closeChar) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }

  return source.length;
}

/**
 * The body of every event-listener method in `source`, brace-matched.
 *
 * The decorator's own arguments routinely contain a brace (an options object
 * such as `{ async: true }`), and so can the method's parameters (a destructured
 * event). So the scan skips the decorator's argument list, any further stacked
 * decorators, and the parameter list, and only then takes the next `{` as the
 * body. Taking the first `{` after the decorator would read the options object
 * as the body and declare exactly the listener #520 removed compliant.
 *
 * @param source - TypeScript source, comments already stripped.
 * @returns each listener body, braces included.
 *
 * @stability experimental
 */
export function eventListenerBodies(source: string): string[] {
  const bodies: string[] = [];
  let index = source.indexOf(DECORATOR);

  while (index !== -1) {
    // 1. The decorator's argument list.
    let cursor = skipBalanced(source, source.indexOf('(', index), '(', ')');

    // 2. Any further decorators stacked on the same method.
    for (;;) {
      while (/\s/.test(source[cursor] ?? '')) cursor += 1;
      if (source[cursor] !== '@') break;

      const paren = source.indexOf('(', cursor);
      cursor = skipBalanced(source, paren, '(', ')');
    }

    // 3. The method's parameter list, then its body.
    const params = source.indexOf('(', cursor);

    if (params === -1) break;

    const afterParams = skipBalanced(source, params, '(', ')');
    const open = source.indexOf('{', afterParams);

    if (open === -1) break;

    const end = skipBalanced(source, open, '{', '}');

    bodies.push(source.slice(open, end));
    index = source.indexOf(DECORATOR, end);
  }

  return bodies;
}

/**
 * Every I/O marker found in a listener body.
 *
 * @param body - one listener body.
 * @param extra - the app's additive markers.
 * @returns what each matching marker is, completing `an event listener body containing ...`.
 *
 * @stability experimental
 */
export function listenerIoMarkers(
  body: string,
  extra: ReadonlyArray<{ pattern: RegExp; what: string }> = [],
): string[] {
  return [...IO_MARKERS, ...extra].filter((marker) => marker.pattern.test(body)).map((marker) => marker.what);
}

/** Runs the scan; see {@link onEventNoIoSuite}. */
function check(context: ConformanceContext, options: OnEventNoIoOptions): ConformanceReport {
  if (context.sourceRoots.length === 0) {
    throw new Error('on-event-no-io: sourceRoots is empty, so there is nothing to scan.');
  }
  if (!Number.isInteger(options.minListenerFiles) || options.minListenerFiles < 1) {
    throw new Error('on-event-no-io: minListenerFiles must be a positive integer, or the scan could pass vacuously.');
  }

  const files = context.sourceRoots
    .flatMap((root) => {
      let found: string[];
      try {
        found = sourceFiles(root);
      } catch (cause) {
        throw new Error(`on-event-no-io: cannot read source root ${root}: ${(cause as Error).message}`);
      }
      return found.map((file) => ({ path: file, rel: relative(root, file).split('\\').join('/') }));
    })
    .map((file) => ({ ...file, source: stripListenerComments(readFileSync(file.path, 'utf8')) }))
    .filter((file) => file.source.includes(DECORATOR));

  const findings: ConformanceFinding[] = [];
  let bodies = 0;

  for (const file of files) {
    for (const body of eventListenerBodies(file.source)) {
      bodies += 1;
      for (const what of listenerIoMarkers(body, options.extraIoMarkers)) {
        findings.push({ file: file.rel, message: `an event listener body containing ${what}` });
      }
    }
  }

  return {
    scanned: { listenerFiles: files.length, listenerBodies: bodies },
    scannedFiles: { listenerFiles: files.map((file) => file.rel) },
    findings,
  };
}

/** The decorator-reading cases: run against fixed sources, whatever the app is. */
const DETECTOR_CASES: ReadonlyArray<ConformanceCase> = [
  {
    name: 'the detector reads the method body, not the decorator options object',
    run: (_report, expect) => {
      const source = `
        ${DECORATOR}SOME_EVENT, { async: true })
        async handle({ job }: SomeEvent): Promise<void> {
          const x = { nested: true };
          await this.other.thing(x);
        }
      `;
      const [body] = eventListenerBodies(source);

      expect(body !== undefined && body.includes('this.other.thing(x)') && body.includes('nested: true')).toEqual(true);
    },
  },
  {
    name: 'the detector ignores the decorator named in a comment',
    run: (_report, expect) => {
      const source = stripListenerComments(`
        // Before this, an \`${DECORATOR}EVENT, { async: true })\` listener did it.
        /* and ${DECORATOR} here too */
        async run(object: StorageObject): Promise<void> {
          await this.storageProvider.download(object.storageKey);
        }
      `);

      expect(eventListenerBodies(source)).toEqual([]);
    },
  },
  {
    name: 'the detector skips stacked decorators',
    run: (_report, expect) => {
      const source = `
        ${DECORATOR}SOME_EVENT)
        @SomethingElse({ a: 1 })
        handle(event: SomeEvent): void {
          void this.storageProvider.download(event.key);
        }
      `;

      expect(eventListenerBodies(source).flatMap((body) => listenerIoMarkers(body))).toEqual([
        'a direct storage-provider call',
        'a download',
      ]);
    },
  },
  {
    name: 'the detector catches the listener #520 removed',
    run: (_report, expect) => {
      // The pre-#520 `ObjectProcessingService.handleObjectUploaded`, trimmed to
      // its shape. If this stops being flagged, the detector has regressed.
      const source = `
        ${DECORATOR}OBJECT_UPLOADED_EVENT, { async: true })
        async handleObjectUploaded(event: ObjectUploadedEvent): Promise<void> {
          const { object } = event;
          const applicableProcessors = this.processors.filter(p => p.canProcess(object));
          for (const processor of applicableProcessors) {
            try {
              const result = await processor.process(
                object,
                () => this.storageProvider.download(object.storageKey),
              );
            } catch (error) {
              hasError = true;
            }
          }
          await this.markReady(object.id, allMetadata);
        }
      `;

      expect(eventListenerBodies(source).flatMap((body) => listenerIoMarkers(body))).toEqual([
        'a direct storage-provider call',
        'a download',
      ]);
    },
  },
];

/** The tests the harness registers for this suite. */
function cases(options: OnEventNoIoOptions): ReadonlyArray<ConformanceCase> {
  return [
    {
      // The failure this guards: a refactor moves the listeners, the scan finds
      // nothing, and the case below passes over an empty list.
      name: 'finds the listeners at all, so a broken scan cannot pass vacuously',
      run: (report, expect) => {
        expect(report.scanned.listenerFiles).toBeGreaterThanOrEqual(options.minListenerFiles);
        expect(report.scanned.listenerBodies).toBeGreaterThanOrEqual(options.minListenerBodies ?? options.minListenerFiles);
      },
    },
    {
      name: "scans the packaged slices' listeners, not only the app's",
      run: (report, expect) => {
        for (const file of options.mustScan ?? []) expect(report.scannedFiles.listenerFiles).toContain(file);
      },
    },
    {
      name: 'keeps object bytes out of every event listener',
      run: (report, expect) => {
        expect(report.findings.map((finding) => `${finding.file}: ${finding.message}`)).toEqual([]);
      },
    },
    ...DETECTOR_CASES,
  ];
}

/**
 * The suite behind `runPlatformConformance({ suites: { onEventNoIo } })`: no
 * event-listener body does storage I/O. The listener half of queue rule 1; the
 * cron half is `cron-enqueue-only`.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const onEventNoIoSuite: ConformanceSuite<OnEventNoIoOptions> = {
  id: 'on-event-no-io',
  title: 'no event listener body does storage I/O',
  description:
    'A listener body never downloads, uploads or calls the storage provider; that work is a queue job (the listener half of queue rule 1).',
  check,
  cases,
};

if (!conformanceSuites.has(onEventNoIoSuite.id)) conformanceSuites.register(onEventNoIoSuite);
