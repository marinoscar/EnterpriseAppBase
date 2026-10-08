// =============================================================================
// The notifications slice's conformance suite (issue #738, PP-8.5)
// =============================================================================
//
// The slice's invariants, checked against the APP that consumes the package
// (spec: "Conformance suites travel with packages"). Importing
// `@marinoscar/platform-api/notifications/testing` registers the
// `notifications` suite with `runPlatformConformance()`.
//
//   1. platform: the platform's channels and its own notifications
//      (broadcasts, `jobs.job_failed`, `nodes.node_offline`) are registered.
//   2. templates: every event that declares `email` has an email template
//      bound, and the template is registered (an unbound one is a recorded
//      delivery failure on every send).
//   3. after-commit: no `notify*()` call sits lexically inside a
//      `$transaction(...)` callback in the app's sources (CLAUDE.md:
//      "notify() runs after the triggering write commits, outside any
//      $transaction"). A static scan; the unit tests prove the runtime half.
//   4. no-secret: neither the stored Web Push settings nor its admin view
//      declares a secret-bearing field (the VAPID private key lives in the
//      credential store only).
//
// Run it after the app's notification manifest has registered everything.
// =============================================================================

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { SECRET_BEARING_KEYS } from '@marinoscar/platform-contract/credentials';
import { pushConfigResponseSchema, pushConfigSchema } from '@marinoscar/platform-contract/notifications';

import { conformanceSuites } from '../../testing/index';
import type { ConformanceCase, ConformanceContext, ConformanceFinding, ConformanceReport, ConformanceSuite } from '../../testing/index';
import { emailTemplateRegistry } from '../../email/index';
import { BROADCASTS_NOTIFICATIONS } from '../broadcasts/broadcasts.notifications';
import { NODES_NOTIFICATIONS } from '../ops/nodes.notifications';
import { OPS_NOTIFICATIONS } from '../ops/ops.notifications';
import { eventEmailTemplateRegistry } from '../registry/bindings.registry';
import { notificationChannelRegistry } from '../registry/channel.registry';
import { notificationEventRegistry } from '../registry/event.registry';
import { PLATFORM_NOTIFICATION_CHANNELS } from '../registry/platform-channels';

declare module '../../testing/index' {
  interface PlatformConformanceSuiteOptions {
    /** The notifications slice's suite: its options, or `false` to opt out. Registered by importing `@marinoscar/platform-api/notifications/testing`. */
    notifications?: NotificationsConformanceOptions | false;
  }
}

/**
 * Options of the `notifications` suite.
 *
 * @stability experimental
 */
export interface NotificationsConformanceOptions {
  /**
   * Source files (relative to a source root, `/`-separated) the after-commit
   * scan skips: a file that names `notify` inside a `$transaction` for a
   * reason the scan cannot see (a string, a comment it misreads). Each entry
   * should carry a reason in the app's own test.
   */
  readonly afterCommitAllowlist?: readonly string[];
}

const FILE_PLATFORM = 'notifications-platform';
const FILE_TEMPLATES = 'notifications-templates';
const FILE_SCHEMAS = 'notifications-schemas';

/** A dispatcher call: `notify(`, `notifyNow(`, `notifyAddress(`, `notifyPermissionHolders(`, `notifyPermissionHoldersNow(`. */
const NOTIFY_CALL = /\.notify(?:Now|Address|PermissionHolders|PermissionHoldersNow)?\(/;

/**
 * Check 1: the platform's channels and notifications are registered.
 *
 * @returns one finding per missing entry.
 *
 * @stability experimental
 */
export function checkPlatformNotifications(): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  for (const channel of PLATFORM_NOTIFICATION_CHANNELS) {
    if (!notificationChannelRegistry.has(channel.id)) {
      findings.push({ file: FILE_PLATFORM, message: `platform channel "${channel.id}" is not registered (call registerPlatformNotificationChannels())` });
    }
  }
  for (const registration of [...BROADCASTS_NOTIFICATIONS, ...OPS_NOTIFICATIONS, ...NODES_NOTIFICATIONS]) {
    if (!notificationEventRegistry.has(registration.event.key)) {
      findings.push({ file: FILE_PLATFORM, message: `platform notification "${registration.event.key}" is not registered (register BROADCASTS_NOTIFICATIONS, OPS_NOTIFICATIONS and NODES_NOTIFICATIONS)` });
    }
  }
  return findings;
}

/**
 * Check 2: every event that declares `email` has a registered email template.
 *
 * @returns one finding per unbound or dangling binding.
 *
 * @stability experimental
 */
export function checkEmailBindings(): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  for (const event of notificationEventRegistry.list()) {
    if (!event.channels.includes('email')) continue;
    const binding = eventEmailTemplateRegistry.get(event.key);
    if (!binding) {
      findings.push({ file: FILE_TEMPLATES, message: `event "${event.key}" declares email but no email template is bound (registerNotification({ emailTemplate }))` });
    } else if (!emailTemplateRegistry.has(binding.template)) {
      findings.push({ file: FILE_TEMPLATES, message: `event "${event.key}" is bound to email template "${binding.template}", which is not registered` });
    }
  }
  return findings;
}

/** Every `.ts` file under `dir`, excluding tests. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === 'node_modules' ? [] : sourceFiles(full);
    if (!entry.endsWith('.ts') || entry.endsWith('.spec.ts') || entry.endsWith('.d.ts')) return [];
    return [full];
  });
}

/** Strips `//` and block comments, keeping line breaks so line numbers survive. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (_match, lead: string) => lead);
}

/**
 * The argument spans of every `$transaction(` call in `source`,
 * parenthesis-matched (a regex would stop at the first `)`).
 */
function transactionSpans(source: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  let index = source.indexOf('$transaction(');
  while (index !== -1) {
    const open = index + '$transaction'.length;
    let depth = 0;
    let end = open;
    for (; end < source.length; end += 1) {
      if (source[end] === '(') depth += 1;
      else if (source[end] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    spans.push({ start: open, end });
    index = source.indexOf('$transaction(', end);
  }
  return spans;
}

/**
 * What {@link checkNotifyAfterCommit} found.
 *
 * @stability experimental
 */
export interface NotifyAfterCommitScan {
  /** The violations, one per `notify` call inside a `$transaction`. */
  findings: ConformanceFinding[];
  /** The files scanned. */
  files: string[];
}

/**
 * Check 3: no dispatcher call inside a `$transaction(...)` callback.
 *
 * @param context - the app's source roots.
 * @param allowlist - relative paths to skip.
 * @returns one finding per offending call, and how many files were scanned.
 *
 * @stability experimental
 */
export function checkNotifyAfterCommit(
  context: ConformanceContext,
  allowlist: readonly string[] = [],
): NotifyAfterCommitScan {
  const findings: ConformanceFinding[] = [];
  const files: string[] = [];
  const skip = new Set(allowlist);
  for (const root of context.sourceRoots) {
    for (const file of sourceFiles(root)) {
      const rel = relative(root, file).split('\\').join('/');
      if (skip.has(rel)) continue;
      files.push(rel);
      const source = stripComments(readFileSync(file, 'utf8'));
      for (const span of transactionSpans(source)) {
        const body = source.slice(span.start, span.end);
        const match = NOTIFY_CALL.exec(body);
        if (match) {
          const line = source.slice(0, span.start + match.index).split('\n').length;
          findings.push({
            file: `${rel}:${line}`,
            message: `${match[0]} is called inside a $transaction callback; call it after the transaction commits`,
          });
        }
      }
    }
  }
  return { findings, files };
}

/**
 * Check 4: neither the stored Web Push settings nor its admin view declares a
 * secret-bearing field.
 *
 * @returns one finding per offending field.
 *
 * @stability experimental
 */
export function checkPushSchemas(): ConformanceFinding[] {
  const forbidden = new Set<string>([...SECRET_BEARING_KEYS, 'privateKey', 'vapidPrivateKey']);
  const findings: ConformanceFinding[] = [];
  for (const [name, schema] of Object.entries({ pushConfigSchema, pushConfigResponseSchema })) {
    for (const key of Object.keys(schema.shape)) {
      if (forbidden.has(key)) findings.push({ file: FILE_SCHEMAS, message: `${name} declares "${key}": the VAPID private key lives in the credential store only` });
    }
  }
  return findings;
}

/**
 * The `notifications` conformance suite. Registered when
 * `@marinoscar/platform-api/notifications/testing` is imported.
 *
 * @example
 * ```ts
 * import '@marinoscar/platform-api/notifications/testing';
 * runPlatformConformance({ sourceRoots: [API_SOURCE_ROOT], suites: { notifications: {} } });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const notificationsConformanceSuite: ConformanceSuite<NotificationsConformanceOptions> = {
  id: 'notifications',
  title: 'the notifications slice keeps its invariants',
  description:
    'The platform channels and notifications are registered, every email-capable event has a template, no notify() runs inside a transaction, and no Web Push shape can carry the private key.',
  check(context, options): ConformanceReport {
    const afterCommit = checkNotifyAfterCommit(context, options.afterCommitAllowlist);
    const findings = [...checkPlatformNotifications(), ...checkEmailBindings(), ...afterCommit.findings, ...checkPushSchemas()];
    return {
      scanned: {
        channels: notificationChannelRegistry.ids().length,
        events: notificationEventRegistry.ids().length,
        files: afterCommit.files.length,
        schemas: 2,
      },
      scannedFiles: { files: afterCommit.files },
      findings,
    };
  },
  cases(): ConformanceCase[] {
    const only = (prefix: string) => (finding: ConformanceFinding) => finding.file === prefix;
    return [
      {
        name: 'platform: the platform channels and notifications are registered',
        run: (report, expect) => {
          expect(report.findings.filter(only(FILE_PLATFORM))).toEqual([]);
        },
      },
      {
        name: 'templates: every event that declares email has a registered template',
        run: (report, expect) => {
          expect(report.findings.filter(only(FILE_TEMPLATES))).toEqual([]);
        },
      },
      {
        name: 'after-commit: no notify() call runs inside a $transaction callback',
        run: (report, expect) => {
          expect(report.scanned.files).toBeGreaterThanOrEqual(1);
          expect(report.findings.filter((finding) => finding.message.includes('$transaction'))).toEqual([]);
        },
      },
      {
        name: 'no-secret: the Web Push settings and their admin view carry no secret-bearing field',
        run: (report, expect) => {
          expect(report.findings.filter(only(FILE_SCHEMAS))).toEqual([]);
        },
      },
    ];
  },
};

if (!conformanceSuites.has(notificationsConformanceSuite.id)) conformanceSuites.register(notificationsConformanceSuite);
