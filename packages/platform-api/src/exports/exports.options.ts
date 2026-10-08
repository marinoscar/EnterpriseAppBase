// =============================================================================
// ExportsModule.forRoot() options (issue #744)
// =============================================================================
//
// CODE OPTIONS, not environment variables or system settings, as in EvoPath:
// a retention period or an in-flight cap is a product decision an app makes
// once, not a knob an operator turns at run time. The defaults are EvoPath's
// constants.
// =============================================================================

import type { ModuleMetadata } from '@nestjs/common';

import type { JobExecutionProfile } from '../jobs/index';
import type { ExportDatamodel } from './datamodel';
import {
  DEFAULT_EXPORT_DOWNLOAD_URL_TTL_SECONDS,
  DEFAULT_EXPORT_MAX_IN_FLIGHT,
  DEFAULT_EXPORT_PAGE_SIZE,
  DEFAULT_EXPORT_RETENTION_DAYS,
} from './exports.constants';

/**
 * Injection token of the resolved {@link ExportsModuleOptions}.
 *
 * @stability experimental
 */
export const EXPORTS_OPTIONS: unique symbol = Symbol.for('@marinoscar/platform/exports/OPTIONS');

/**
 * The `export.run` profile by default: 15 minutes, 2 attempts.
 *
 * @stability stable
 */
export const DEFAULT_EXPORT_JOB_PROFILE: JobExecutionProfile = Object.freeze({ maxRuntimeMs: 15 * 60 * 1000, maxAttempts: 2 });

/**
 * The `export.purge` profile by default: 30 minutes, 3 attempts.
 *
 * @stability stable
 */
export const DEFAULT_EXPORT_PURGE_PROFILE: JobExecutionProfile = Object.freeze({ maxRuntimeMs: 30 * 60 * 1000, maxAttempts: 3 });

/**
 * A job type an app ran before adopting the slice, kept registered as an
 * alias so its rows still have a handler (a job `type` is permanent).
 *
 * @stability experimental
 * @example
 * ```ts
 * { type: 'health.export.purge', handles: 'purge', label: 'Health export expiry' }
 * ```
 */
export interface ExportLegacyJobType {
  /** The legacy type string (`health.export`). */
  readonly type: string;
  /** Which slice job it is processed as. */
  readonly handles: 'run' | 'purge';
  /** Its label in the jobs console; default the slice job's. */
  readonly label?: string;
  /**
   * `run` only: maps a legacy payload to the `export.run` payload
   * (`{ source, format, request, requestedById, scope, subjectId, orgId }`).
   * Without it the payload must already have that shape.
   */
  readonly toPayload?: (payload: unknown) => unknown;
}

/**
 * Options of `ExportsModule.forRoot()`. Every field but `datamodel` is
 * optional.
 *
 * @stability experimental
 */
export interface ExportsModuleOptions {
  /**
   * The app's `Prisma.dmmf.datamodel`: the platform sources derive each
   * registered model's columns from it. Required.
   */
  datamodel: ExportDatamodel;
  /** The download-name slug (`my-app` in `my-app-user-data-2026-10-08.zip`); a function is read per export. Default `'app'`. */
  appSlug?: string | (() => string);
  /** Days an export file is kept before `export.purge` deletes it. Default 7. */
  retentionDays?: number;
  /** Lifetime of a signed download URL, in seconds. Default 300. */
  downloadUrlTtlSeconds?: number;
  /** Exports one subject (user or organization) may have pending or running. Default 3. */
  maxInFlightPerSubject?: number;
  /** Rows per page the platform sources read. Default 500. */
  pageSize?: number;
  /** The `export.run` execution profile. Default {@link DEFAULT_EXPORT_JOB_PROFILE}. */
  jobProfile?: JobExecutionProfile;
  /** The `export.purge` execution profile. Default {@link DEFAULT_EXPORT_PURGE_PROFILE}. */
  purgeProfile?: JobExecutionProfile;
  /** Whether to register the platform sources. Default both `true`. */
  platformSources?: {
    /** `user-data`. */
    userData?: boolean;
    /** `org-data`. */
    orgData?: boolean;
  };
  /** Legacy job types kept registered as aliases (EvoPath's `health.export`, `health.export.purge`). */
  legacyJobTypes?: readonly ExportLegacyJobType[];
  /** Modules imported next to the slice: the app's host module binding the ports. */
  imports?: ModuleMetadata['imports'];
}

/**
 * {@link ExportsModuleOptions} with every default applied.
 *
 * @stability experimental
 */
export interface ResolvedExportsModuleOptions {
  /** The app's datamodel. */
  readonly datamodel: ExportDatamodel;
  /** Reads the slug. */
  readonly appSlug: () => string;
  /** Days. */
  readonly retentionDays: number;
  /** Seconds. */
  readonly downloadUrlTtlSeconds: number;
  /** Per subject. */
  readonly maxInFlightPerSubject: number;
  /** Rows. */
  readonly pageSize: number;
  /** `export.run`. */
  readonly jobProfile: JobExecutionProfile;
  /** `export.purge`. */
  readonly purgeProfile: JobExecutionProfile;
  /** The platform sources registered. */
  readonly platformSources: { readonly userData: boolean; readonly orgData: boolean };
  /** The aliases. */
  readonly legacyJobTypes: readonly ExportLegacyJobType[];
  /** The modules imported next to the slice. */
  readonly imports: NonNullable<ModuleMetadata['imports']>;
}

function positiveInt(name: string, value: number | undefined): void {
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`ExportsModule.forRoot(): ${name} must be a positive integer (got ${String(value)})`);
  }
}

function profile(name: string, value: JobExecutionProfile | undefined): void {
  if (value === undefined) return;
  positiveInt(`${name}.maxRuntimeMs`, value.maxRuntimeMs);
  positiveInt(`${name}.maxAttempts`, value.maxAttempts);
  const extra = Object.keys(value).filter((key) => key !== 'maxRuntimeMs' && key !== 'maxAttempts');
  if (extra.length > 0) throw new Error(`ExportsModule.forRoot(): ${name} carries only maxRuntimeMs and maxAttempts (got ${extra.join(', ')})`);
}

/**
 * The app slug as a file-name segment: lowercase letters, digits and `-`;
 * `app` when nothing survives.
 *
 * @param name - the application name or slug.
 * @returns the slug.
 *
 * @stability experimental
 */
export function exportFileSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'app';
}

/**
 * Validates `options` and applies the defaults.
 *
 * @param options - what the app passed.
 * @returns the resolved options (frozen).
 * @throws Error when `datamodel` is missing or a number or profile is invalid.
 *
 * @stability experimental
 */
export function resolveExportsModuleOptions(options: ExportsModuleOptions): ResolvedExportsModuleOptions {
  if (!options || !options.datamodel || !Array.isArray(options.datamodel.models)) {
    throw new Error('ExportsModule.forRoot(): datamodel is required (pass the app\'s Prisma.dmmf.datamodel)');
  }
  positiveInt('retentionDays', options.retentionDays);
  positiveInt('downloadUrlTtlSeconds', options.downloadUrlTtlSeconds);
  positiveInt('maxInFlightPerSubject', options.maxInFlightPerSubject);
  positiveInt('pageSize', options.pageSize);
  profile('jobProfile', options.jobProfile);
  profile('purgeProfile', options.purgeProfile);
  for (const legacy of options.legacyJobTypes ?? []) {
    if (typeof legacy.type !== 'string' || legacy.type.trim() === '') throw new Error('ExportsModule.forRoot(): a legacy job type needs a type');
    if (legacy.handles !== 'run' && legacy.handles !== 'purge') {
      throw new Error(`ExportsModule.forRoot(): legacy job type "${legacy.type}" handles 'run' or 'purge'`);
    }
  }
  const slug = options.appSlug;
  return Object.freeze({
    datamodel: options.datamodel,
    appSlug: typeof slug === 'function' ? () => exportFileSlug(slug()) : () => exportFileSlug(slug ?? 'app'),
    retentionDays: options.retentionDays ?? DEFAULT_EXPORT_RETENTION_DAYS,
    downloadUrlTtlSeconds: options.downloadUrlTtlSeconds ?? DEFAULT_EXPORT_DOWNLOAD_URL_TTL_SECONDS,
    maxInFlightPerSubject: options.maxInFlightPerSubject ?? DEFAULT_EXPORT_MAX_IN_FLIGHT,
    pageSize: options.pageSize ?? DEFAULT_EXPORT_PAGE_SIZE,
    jobProfile: Object.freeze({ ...(options.jobProfile ?? DEFAULT_EXPORT_JOB_PROFILE) }),
    purgeProfile: Object.freeze({ ...(options.purgeProfile ?? DEFAULT_EXPORT_PURGE_PROFILE) }),
    platformSources: Object.freeze({
      userData: options.platformSources?.userData ?? true,
      orgData: options.platformSources?.orgData ?? true,
    }),
    legacyJobTypes: Object.freeze([...(options.legacyJobTypes ?? [])]),
    imports: [...(options.imports ?? [])],
  });
}
