// =============================================================================
// `JobsModule.forRoot()` options (issue #734, PP-8.2)
// =============================================================================

import type { DynamicModule, ForwardReference, Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { jobsConfiguration, type JobsConfigurationKeys } from './jobs.configuration';

/**
 * The worker modes `JOBS_WORKER_MODE` (and `worker.mode`) accept.
 *
 * @stability stable
 */
export type JobsWorkerMode = 'all' | 'system' | 'off';

/**
 * What an app passes to `JobsModule.forRoot()`. Every field is optional:
 * `JobsModule.forRoot({})` is the deployment as its environment describes it
 * (`JOBS_*`, `jobsConfiguration()`).
 *
 * @stability experimental
 */
export interface JobsModuleOptions {
  /**
   * Override env-derived worker settings for THIS process (tests, an
   * embedded worker). The environment remains the deployment default.
   */
  worker?: Partial<{
    /** `JOBS_WORKER_MODE`. */
    mode: JobsWorkerMode;
    /** `JOBS_WORKER_CONCURRENCY`. */
    concurrency: number;
    /** `JOBS_POLL_MS`. */
    pollMs: number;
    /** `JOBS_JOB_TIMEOUT_MS`. */
    jobTimeoutMs: number;
  }>;
  /** Override the env-derived retry budget (`JOBS_MAX_ATTEMPTS`, `JOBS_RETRY_BASE_MS`, `JOBS_RETRY_MAX_MS`). */
  retry?: Partial<{
    /** `JOBS_MAX_ATTEMPTS`. */
    maxAttempts: number;
    /** `JOBS_RETRY_BASE_MS`. */
    baseMs: number;
    /** `JOBS_RETRY_MAX_MS`. */
    maxMs: number;
  }>;
  /**
   * The application's display name, for the temp-file prefix
   * (`JOB_TEMP_PREFIX`, `'<slug>-job-'`): two apps on one host must not share
   * a prefix, or one janitor deletes the other's files. Default: the neutral
   * `'app-job-'`. The reference app passes `APP_NAME`.
   */
  appName?: string;
  /**
   * The modules that bind the slice's host ports (`JOBS_METRICS`,
   * `JOBS_EVENT_BUS`, `JOBS_ORG_SCOPE`). Each must be `@Global()` or export
   * the tokens.
   */
  imports?: ReadonlyArray<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
}

/**
 * Injection token of the {@link ResolvedJobsModuleOptions}.
 *
 * @stability experimental
 */
export const JOBS_OPTIONS: unique symbol = Symbol.for('@marinoscar/platform/jobs/OPTIONS');

/**
 * The options after validation, as `JOBS_OPTIONS` provides them.
 *
 * @stability experimental
 */
export interface ResolvedJobsModuleOptions {
  /** The `jobs.*` configuration keys this module overrides, or an empty object. */
  readonly overrides: Readonly<Partial<JobsConfigurationKeys>>;
  /** The application name for the temp-file prefix, when given. */
  readonly appName: string | undefined;
  /** The host-port modules. */
  readonly imports: ReadonlyArray<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
}

const MODES: readonly JobsWorkerMode[] = ['all', 'system', 'off'];

function positiveInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`JobsModule.forRoot: ${field} must be a positive integer, got ${JSON.stringify(value)}.`);
  }
  return value;
}

/**
 * Validates the options and maps them onto the `jobs.*` keys they override.
 *
 * @param options - the app's options.
 * @returns the resolved, frozen options.
 * @throws Error naming the field when an option is invalid.
 *
 * @stability experimental
 */
export function resolveJobsModuleOptions(options: JobsModuleOptions = {}): ResolvedJobsModuleOptions {
  const overrides: Partial<JobsConfigurationKeys> = {};
  const { worker = {}, retry = {} } = options;
  if (worker.mode !== undefined) {
    if (!MODES.includes(worker.mode)) {
      throw new Error(`JobsModule.forRoot: worker.mode must be one of ${MODES.join(', ')}, got ${JSON.stringify(worker.mode)}.`);
    }
    overrides.workerMode = worker.mode;
  }
  if (worker.concurrency !== undefined) overrides.workerConcurrency = positiveInt(worker.concurrency, 'worker.concurrency');
  if (worker.pollMs !== undefined) overrides.pollMs = positiveInt(worker.pollMs, 'worker.pollMs');
  if (worker.jobTimeoutMs !== undefined) overrides.jobTimeoutMs = positiveInt(worker.jobTimeoutMs, 'worker.jobTimeoutMs');
  if (retry.maxAttempts !== undefined) overrides.maxAttempts = positiveInt(retry.maxAttempts, 'retry.maxAttempts');
  if (retry.baseMs !== undefined) overrides.retryBaseMs = positiveInt(retry.baseMs, 'retry.baseMs');
  if (retry.maxMs !== undefined) overrides.retryMaxMs = positiveInt(retry.maxMs, 'retry.maxMs');
  if (options.appName !== undefined && typeof options.appName !== 'string') {
    throw new Error('JobsModule.forRoot: appName must be a string.');
  }
  return Object.freeze({
    overrides: Object.freeze(overrides),
    appName: options.appName,
    imports: Object.freeze([...(options.imports ?? [])]),
  });
}

/**
 * The `ConfigService` the module's own providers read when it overrides
 * keys: the environment's `jobs.*` keys (`jobsConfiguration()`) with the
 * overrides on top. Every key the jobs module reads is a `jobs.*` key, so the
 * view is complete; the app's global `ConfigService` is untouched.
 *
 * @param overrides - the keys to override.
 * @param env - the environment; `process.env` by default.
 * @returns a `ConfigService` over that view.
 *
 * @stability experimental
 */
export function jobsConfigOverlay(
  overrides: Readonly<Partial<JobsConfigurationKeys>>,
  env: NodeJS.ProcessEnv = process.env,
): ConfigService {
  const base = jobsConfiguration(env);
  return new ConfigService({ ...base, jobs: { ...base.jobs, ...overrides } });
}
