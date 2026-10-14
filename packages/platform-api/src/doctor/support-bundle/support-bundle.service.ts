// =============================================================================
// SupportBundleService: builds the support bundle (issue #772, PP-13.1)
// =============================================================================
//
// One JSON file an operator can attach to a support ticket: every registered
// section, collected in parallel, each validated by its own strict schema,
// then the central redaction pass (`redact.ts`), then the size caps.
//
// BOUNDED, SO NOT A QUEUE JOB (CLAUDE.md: "every long-running activity is a
// queue job"). The work finishes inside the request, like the telemetry
// export:
//   - sections run in parallel, each cut off after its `timeoutMs` (default
//     10 s), so the build takes at most the longest section timeout;
//   - the doctor section reads the Doctor's 15 s report cache
//     (`run({ refresh: false })`), so downloading never multiplies probes;
//   - the telemetry section reads the dashboard's 15 s result cache;
//   - 512 KiB per section and 2 MiB per bundle.
// A fork that registers a slow section is bounded by that section's timeout.
//
// FAIL CLOSED, PER SECTION. A throw, a timeout or output that breaks the
// section's schema becomes `{ status: 'error', error: <one redacted line> }`
// and the section's data is DROPPED; the rest of the bundle is intact.
//
// AUDITED after the body is built: one `support_bundle:download` row per
// download, without the actor's email. A failed audit write is logged, not
// fatal (the bundle has been built; refusing it would not undo anything).
// =============================================================================

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type {
  SupportBundle,
  SupportBundleSectionResult,
  SupportBundleSectionStatus,
} from '@marinoscar/platform-contract/doctor';

import { AUDIT_SINK } from '../../core/index';
import type { AuditSink } from '../../core/index';
import { DOCTOR_MODULE_OPTIONS } from '../doctor.options';
import type { ResolvedDoctorModuleOptions } from '../doctor.options';
import { SUPPORT_BUNDLE_REDACTION_VERSION, redactString, redactValue } from './redact';
import { isSupportBundleOmission } from './support-bundle-section.interface';
import type { SupportBundlePrincipal, SupportBundleSection } from './support-bundle-section.interface';
import {
  SUPPORT_BUNDLE_AUDIT_ACTION,
  SUPPORT_BUNDLE_MAX_BYTES,
  SUPPORT_BUNDLE_SECTION_MAX_BYTES,
} from './support-bundle.options';
import { SupportBundleRegistry } from './support-bundle.registry';

/** What a schema failure says. Never the value, never zod's message (it can quote input). */
const SCHEMA_ERROR = 'section output did not match its schema';

/** An `error` line longer than this is cut. */
const MAX_ERROR_LENGTH = 300;

/**
 * One built bundle: the file, its name and what the audit row records.
 *
 * @stability experimental
 */
export interface SupportBundleBuild {
  /** The file: pretty-printed JSON, UTF-8. */
  body: Buffer;
  /** `support-bundle-<appSlug>-<yyyyMMdd'T'HHmmss'Z'>.json`. */
  filename: string;
  /** The bundle the body serializes. */
  bundle: SupportBundle;
  /** Facts about the build, for the audit row and logs. */
  meta: {
    /** Each section's final status. */
    sections: Record<string, SupportBundleSectionStatus>;
    /** `body.length`. */
    bytes: number;
    /** `bundle.redaction.replacements`. */
    replacements: number;
    /** How long the build took, in milliseconds. */
    durationMs: number;
  };
}

class SectionTimeoutError extends Error {
  constructor(ms: number) {
    super(`timed out after ${ms} ms`);
  }
}

/** One line, cut, with no stack: what an `error` field may say. */
function oneLine(message: string): string {
  const line = (message.split(/\r?\n/)[0] ?? '').trim() || 'section failed';
  return line.length > MAX_ERROR_LENGTH ? `${line.slice(0, MAX_ERROR_LENGTH - 1)}…` : line;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** `yyyyMMdd'T'HHmmss'Z'`, UTC. */
function filenameStamp(at: Date): string {
  return (
    `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}` +
    `T${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}Z`
  );
}

function bytesOf(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null, null, 2), 'utf8');
}

/**
 * Builds the support bundle from every section in {@link SupportBundleRegistry}.
 * Provided by `DoctorModule.forRoot()`.
 *
 * @stability experimental
 */
@Injectable()
export class SupportBundleService {
  private readonly logger = new Logger('SupportBundleService');

  constructor(
    @Inject(SupportBundleRegistry) private readonly registry: SupportBundleRegistry,
    @Inject(DOCTOR_MODULE_OPTIONS) private readonly options: ResolvedDoctorModuleOptions,
    @Optional() @Inject(AUDIT_SINK) private readonly audit?: AuditSink,
  ) {
    if (!audit && options.supportBundle.enabled) {
      this.logger.warn(
        'No AUDIT_SINK is bound: support-bundle downloads will not be audited. ' +
          'Bind one with PlatformHostModule.forRoot({ audit }).',
      );
    }
  }

  /**
   * Builds a bundle for `actor`, without auditing it.
   *
   * @param actor - the caller: their id (never written into the bundle) and permissions.
   * @param now - the build instant. Default: now.
   * @returns the file, its name, the bundle and its audit facts.
   */
  async build(actor: SupportBundlePrincipal, now: Date = new Date()): Promise<SupportBundleBuild> {
    const started = Date.now();
    const permissions: ReadonlySet<string> = new Set(actor.permissions);
    const sections = this.registry.list();

    const results = await Promise.all(
      sections.map(async (section) => [section.id, await this.collect(section, actor.userId, permissions, now)] as const),
    );

    // The central redaction pass, one section at a time so a section id is
    // never itself mistaken for a sensitive key.
    let replacements = 0;
    const redacted: Record<string, SupportBundleSectionResult> = {};
    for (const [id, result] of results) {
      const pass = redactValue(result, { path: ['sections', id] });
      replacements += pass.replacements;
      redacted[id] = pass.value;
    }

    // Per-section cap, after redaction (what is measured is what is sent).
    for (const [id, result] of Object.entries(redacted)) {
      if (result.status === 'ok' && bytesOf(result.data) > SUPPORT_BUNDLE_SECTION_MAX_BYTES) {
        this.logger.warn(`Support-bundle section "${id}" exceeded ${SUPPORT_BUNDLE_SECTION_MAX_BYTES} bytes and was truncated.`);
        redacted[id] = { status: 'ok', data: null, truncated: true };
      }
    }

    const bundle: SupportBundle = {
      bundleVersion: 1,
      generatedAt: now.toISOString(),
      redaction: { rules: SUPPORT_BUNDLE_REDACTION_VERSION, replacements },
      sections: redacted,
    };

    // Whole-bundle cap: the largest sections go first.
    let body = JSON.stringify(bundle, null, 2);
    while (Buffer.byteLength(body, 'utf8') > SUPPORT_BUNDLE_MAX_BYTES) {
      const largest = Object.entries(redacted)
        .filter(([, result]) => result.status === 'ok' && result.data !== null)
        .map(([id, result]) => [id, bytesOf((result as { data: unknown }).data)] as const)
        .sort((a, b) => b[1] - a[1])[0];
      if (!largest) break;
      this.logger.warn(`Support bundle exceeded ${SUPPORT_BUNDLE_MAX_BYTES} bytes; truncated section "${largest[0]}".`);
      redacted[largest[0]] = { status: 'ok', data: null, truncated: true };
      body = JSON.stringify(bundle, null, 2);
    }

    const buffer = Buffer.from(`${body}\n`, 'utf8');
    return {
      body: buffer,
      filename: `support-bundle-${this.options.supportBundle.appSlug}-${filenameStamp(now)}.json`,
      bundle,
      meta: {
        sections: Object.fromEntries(Object.entries(redacted).map(([id, result]) => [id, result.status])),
        bytes: buffer.length,
        replacements,
        durationMs: Date.now() - started,
      },
    };
  }

  /**
   * Builds a bundle for `actor` and records one `support_bundle:download`
   * audit event (after the body is built; a failed write is logged, not thrown).
   *
   * @param actor - the caller.
   * @returns the built bundle.
   */
  async download(actor: SupportBundlePrincipal): Promise<SupportBundleBuild> {
    const built = await this.build(actor);
    await this.record(actor, built);
    this.logger.log(
      `Support bundle built: ${built.meta.bytes} bytes, ${built.meta.replacements} replacement(s), ` +
        `${built.meta.durationMs} ms (${this.describeSections(built)}).`,
    );
    return built;
  }

  private describeSections(built: SupportBundleBuild): string {
    return Object.entries(built.meta.sections)
      .map(([id, status]) => `${id}=${status}`)
      .join(',');
  }

  private async record(actor: SupportBundlePrincipal, built: SupportBundleBuild): Promise<void> {
    if (!this.audit) return;
    try {
      await this.audit.record({
        action: SUPPORT_BUNDLE_AUDIT_ACTION,
        actorUserId: actor.userId,
        targetType: 'deployment',
        targetId: 'support_bundle',
        // Scalars only (the AuditSink contract): the section statuses as one
        // `id=status` list. Never the actor's email.
        meta: { sections: this.describeSections(built), bytes: built.meta.bytes, replacements: built.meta.replacements },
      });
    } catch (error) {
      this.logger.warn(`Could not audit a support-bundle download: ${redactString(oneLine(messageOf(error))).value}`);
    }
  }

  /** Runs one section under its permission, timeout and schema. Never throws. */
  private async collect(
    section: SupportBundleSection,
    actorUserId: string,
    permissions: ReadonlySet<string>,
    now: Date,
  ): Promise<SupportBundleSectionResult> {
    if (section.permission && !permissions.has(section.permission)) {
      return { status: 'omitted', reason: `requires the ${section.permission} permission` };
    }

    const timeoutMs = section.timeoutMs ?? this.options.supportBundle.sectionTimeoutMs;
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;

    try {
      const raw = await Promise.race([
        Promise.resolve().then(() => section.collect({ actorUserId, permissions, now, signal: controller.signal })),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new SectionTimeoutError(timeoutMs));
          }, timeoutMs);
        }),
      ]);

      if (isSupportBundleOmission(raw)) return { status: 'omitted', reason: oneLine(raw.reason) };

      const parsed = section.schema.safeParse(raw);
      if (!parsed.success) {
        // Paths only: zod's messages can quote the offending input.
        const paths = parsed.error.issues.map((issue) => issue.path.join('.') || '(root)').slice(0, 5);
        this.logger.warn(`Support-bundle section "${section.id}" broke its schema at ${paths.join(', ')}; its data was dropped.`);
        return { status: 'error', error: SCHEMA_ERROR };
      }
      return { status: 'ok', data: parsed.data ?? null };
    } catch (error) {
      const line = oneLine(messageOf(error));
      this.logger.warn(`Support-bundle section "${section.id}" failed: ${redactString(line).value}`);
      return { status: 'error', error: line };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
