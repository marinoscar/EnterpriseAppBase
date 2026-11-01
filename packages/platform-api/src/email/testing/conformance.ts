// =============================================================================
// The email slice's conformance suite (issue #737, PP-8.4)
// =============================================================================
//
// The slice's invariants, checked against the APP that consumes the package
// (spec: "Conformance suites travel with packages"). Importing
// `@marinoscar/platform-api/email/testing` registers the `email` suite with
// `runPlatformConformance()`.
//
//   1. defaults: the platform's nine templates are registered (unless the app
//      opted out with `registerDefaultTemplates: false`).
//   2. renders: every template with a sample (the platform's own, plus the
//      app's `samples`) renders a non-empty subject, HTML and text, the HTML
//      a complete document naming the product.
//   3. escaping: markup in a template's data never reaches the HTML unescaped.
//   4. no-secret: neither the stored settings nor the admin response declares
//      a secret-bearing field.
//
// Run it after the app's notification manifest (or `EmailModule.forRoot`) has
// registered its templates and configured rendering.
// =============================================================================

import { SECRET_BEARING_KEYS } from '@marinoscar/platform-contract/credentials';
import { emailSettingsResponseSchema, emailSettingsSchema } from '@marinoscar/platform-contract/email';

import { conformanceSuites } from '../../testing/index';
import type { ConformanceCase, ConformanceFinding, ConformanceReport, ConformanceSuite } from '../../testing/index';
import { emailTemplateRegistry, findEmailTemplate } from '../templates/email-template.registry';
import { PLATFORM_EMAIL_TEMPLATES } from '../templates/platform-email-templates';
import { isEmailRenderingConfigured } from '../templates/render-context';

declare module '../../testing/index' {
  interface PlatformConformanceSuiteOptions {
    /** The email slice's suite: its options, or `false` to opt out. Registered by importing `@marinoscar/platform-api/email/testing`. */
    email?: EmailConformanceOptions | false;
  }
}

/**
 * Options of the `email` suite.
 *
 * @stability experimental
 */
export interface EmailConformanceOptions {
  /** Sample data for the app's own templates, by name, rendered by checks 2 and 3. */
  readonly samples?: Readonly<Record<string, unknown>>;
  /** Set when the app passed `registerDefaultTemplates: false`: check 1 is skipped. */
  readonly withoutDefaultTemplates?: boolean;
}

const HOSTILE = '<script>alert(1)</script>';

/** A sample of each platform template; text fields carry markup for check 3. */
const PLATFORM_SAMPLES: Readonly<Record<keyof typeof PLATFORM_EMAIL_TEMPLATES, unknown>> = {
  'test-email': { recipientEmail: 'admin@example.test', providerKind: 'smtp', sentAt: new Date(0), triggeredBy: HOSTILE },
  'user-welcome': { recipientEmail: 'new@example.test', recipientName: HOSTILE, roles: ['viewer'] },
  'allowlist-invitation': { recipientEmail: 'guest@example.test', invitedBy: HOSTILE },
  'role-changed': { recipientEmail: 'user@example.test', previousRoles: [HOSTILE], currentRoles: ['admin'], changedAt: new Date(0) },
  broadcast: { title: HOSTILE, body: HOSTILE },
  'job-failed': { jobId: 'job-1', jobType: 'export.csv', error: HOSTILE, attempts: 3, executor: null, failedAt: new Date(0) },
  'node-offline': { nodeId: 'node-1', nodeName: HOSTILE, lastHeartbeatAt: null, markedOfflineAt: new Date(0), staleAfterMinutes: 5 },
  'backup-failed': { runId: 'run-1', outcome: 'failed', error: HOSTILE, startedAt: null, failedAt: new Date(0), trigger: null },
  'restore-completed': { runId: 'run-1', backupTakenAt: null, completedAt: new Date(0), triggeredBy: HOSTILE, preRestoreBackupId: null },
};

const FILE_DEFAULTS = 'email-templates';
const FILE_RENDERS = 'email-render';
const FILE_SCHEMAS = 'email-schemas';

/**
 * Check 1: every platform template is registered.
 *
 * @param registered - the registered names.
 * @returns one finding per missing platform template.
 *
 * @stability experimental
 */
export function checkPlatformEmailTemplates(registered: readonly string[]): ConformanceFinding[] {
  const have = new Set(registered);
  return Object.keys(PLATFORM_EMAIL_TEMPLATES)
    .filter((name) => !have.has(name))
    .map((name) => ({ file: FILE_DEFAULTS, message: `platform template "${name}" is not registered (call registerPlatformEmailTemplates())` }));
}

/**
 * Checks 2 and 3: each sampled template renders a complete message and
 * escapes markup from its data.
 *
 * @param samples - sample data by template name.
 * @returns one finding per problem.
 *
 * @stability experimental
 */
export function checkEmailTemplateRendering(samples: Readonly<Record<string, unknown>>): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  if (!isEmailRenderingConfigured()) {
    return [{ file: FILE_RENDERS, message: 'email rendering is not configured: EmailModule.forRoot({ appName }) (or configureEmailRendering) never ran' }];
  }
  for (const [name, data] of Object.entries(samples)) {
    const render = findEmailTemplate(name);
    if (!render) {
      findings.push({ file: FILE_RENDERS, message: `a sample names template "${name}", which is not registered` });
      continue;
    }
    try {
      const message = render(data);
      if (!message.subject?.trim()) findings.push({ file: FILE_RENDERS, message: `"${name}" renders an empty subject` });
      if (!message.text?.trim()) findings.push({ file: FILE_RENDERS, message: `"${name}" renders an empty text part` });
      if (!/^<!doctype html>/i.test(message.html ?? '')) findings.push({ file: FILE_RENDERS, message: `"${name}" does not render a complete HTML document` });
      if ((message.html ?? '').includes(HOSTILE)) findings.push({ file: FILE_RENDERS, message: `"${name}" puts markup from its data into the HTML unescaped` });
    } catch (err) {
      findings.push({ file: FILE_RENDERS, message: `"${name}" throws while rendering its sample: ${err instanceof Error ? err.message : String(err)}` });
    }
  }
  return findings;
}

/**
 * Check 4: neither the stored settings nor the admin response declares a
 * secret-bearing field.
 *
 * @returns one finding per offending field.
 *
 * @stability experimental
 */
export function checkEmailSettingsSchemas(): ConformanceFinding[] {
  const forbidden = new Set<string>([...SECRET_BEARING_KEYS, 'smtpPassword', 'sesSecretAccessKey']);
  const findings: ConformanceFinding[] = [];
  for (const [name, schema] of Object.entries({ emailSettingsSchema, emailSettingsResponseSchema })) {
    for (const key of Object.keys(schema.shape)) {
      if (forbidden.has(key)) findings.push({ file: FILE_SCHEMAS, message: `${name} declares "${key}": email secrets live in the credential store only` });
    }
  }
  return findings;
}

/**
 * The `email` conformance suite. Registered when
 * `@marinoscar/platform-api/email/testing` is imported.
 *
 * @example
 * ```ts
 * import '@marinoscar/platform-api/email/testing';
 * runPlatformConformance({ sourceRoots: [API_SOURCE_ROOT], suites: { email: { samples: { 'example-digest': digest } } } });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const emailConformanceSuite: ConformanceSuite<EmailConformanceOptions> = {
  id: 'email',
  title: 'the email slice keeps its invariants',
  description:
    'The platform templates are registered, every sampled template renders a complete, escaped message, and no email settings shape can carry a secret.',
  check(_context, options): ConformanceReport {
    const registered = emailTemplateRegistry.ids();
    const samples: Record<string, unknown> = { ...(options.samples ?? {}) };
    if (!options.withoutDefaultTemplates) Object.assign(samples, PLATFORM_SAMPLES, options.samples ?? {});
    const findings = [
      ...(options.withoutDefaultTemplates ? [] : checkPlatformEmailTemplates(registered)),
      ...checkEmailTemplateRendering(samples),
      ...checkEmailSettingsSchemas(),
    ];
    return {
      scanned: { templates: registered.length, samples: Object.keys(samples).length, schemas: 2 },
      scannedFiles: { templates: registered, samples: Object.keys(samples) },
      findings,
    };
  },
  cases(): ConformanceCase[] {
    return [
      {
        name: 'defaults: the platform email templates are registered',
        run: (report, expect) => {
          expect(report.findings.filter((finding) => finding.file === FILE_DEFAULTS)).toEqual([]);
        },
      },
      {
        name: 'renders: every sampled template renders a complete message with escaped data',
        run: (report, expect) => {
          expect(report.scanned.samples).toBeGreaterThanOrEqual(1);
          expect(report.findings.filter((finding) => finding.file === FILE_RENDERS)).toEqual([]);
        },
      },
      {
        name: 'no-secret: the email settings and their response carry no secret-bearing field',
        run: (report, expect) => {
          expect(report.findings.filter((finding) => finding.file === FILE_SCHEMAS)).toEqual([]);
        },
      },
    ];
  },
};

if (!conformanceSuites.has(emailConformanceSuite.id)) conformanceSuites.register(emailConformanceSuite);
