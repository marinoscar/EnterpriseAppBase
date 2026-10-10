// =============================================================================
// The deployment-level configuration the queue and the fleet read
// (issue #734, PP-8.2)
// =============================================================================
//
// The jobs and nodes slices read their deployment settings with
// `ConfigService.get('<key>')`, under the `jobs.*` and `nodes.*` keys
// `jobsConfiguration()` builds from `process.env`. The app spreads it into its
// own `ConfigModule.forRoot({ load })` factory (the reference app:
// `apps/api/src/config/configuration.ts`), so the variable names and their
// defaults are defined once, here, and are the ones every deployment already
// sets (`infra/compose/.env.example` is unchanged).
//
// These are DEPLOYMENT decisions (how many slots this replica runs, whether it
// runs the reaper), not runtime settings: the queue's runtime policy (history
// retention, the stuck threshold, the fleet windows, the credential broker)
// lives in the system settings document (`jobs.policy.ts`).
//
// `JobsModule.forRoot({ worker, retry })` and `NodesModule.forRoot({ tasks })`
// override individual keys for one process (an embedded worker, a test)
// without touching the environment; see `jobs.options.ts`.
// =============================================================================

/**
 * The `jobs.*` keys, as `jobsConfiguration()` builds them.
 *
 * @stability stable
 */
export interface JobsConfigurationKeys {
  /** `JOBS_MAX_ATTEMPTS` (3): attempts before a job fails for good. */
  maxAttempts: number;
  /** `JOBS_RETRY_BASE_MS` (2000): first retry delay; doubles per attempt. */
  retryBaseMs: number;
  /** `JOBS_RETRY_MAX_MS` (60000): the retry delay's ceiling. */
  retryMaxMs: number;
  /** `JOBS_RATELIMIT_MAX_HITS` (10): provider rate-limit deferrals before the job fails. */
  rateLimitMaxHits: number;
  /** `JOBS_RATELIMIT_BASE_MS` (30000): first rate-limit deferral. */
  rateLimitBaseMs: number;
  /** `JOBS_RATELIMIT_MAX_MS` (900000): the deferral's ceiling. */
  rateLimitMaxMs: number;
  /** `JOBS_WORKER_CONCURRENCY` (2): jobs this replica runs at once. */
  workerConcurrency: number;
  /** `JOBS_POLL_MS` (5000): idle poll interval. */
  pollMs: number;
  /** `JOBS_WORKER_MODE` (`all`): `all`, `system` (server-only types) or `off`. */
  workerMode: string;
  /** `JOBS_JOB_TIMEOUT_MS` (600000): the default per-attempt timeout, for a type without a profile. */
  jobTimeoutMs: number;
  /** `JOBS_REAPER_ENABLED` (true unless `false`): whether this replica runs the lease reaper. */
  reaperEnabled: boolean;
  /** `JOBS_SYSTEM_MODE_EXTRA_TYPES` (empty): comma-separated node-eligible types a `system` replica also runs. */
  systemModeExtraTypes: string[];
}

/**
 * The `nodes.*` keys, as `jobsConfiguration()` builds them.
 *
 * @stability stable
 */
export interface NodesConfigurationKeys {
  /** `NODE_STALE_OFFLINE_ENABLED` (true unless `false`): this replica runs the stale-offline sweep. */
  staleOfflineEnabled: boolean;
  /** `NODE_OFFLINE_PRUNE_ENABLED` (true unless `false`): this replica runs the offline prune. */
  offlinePruneEnabled: boolean;
  /** `NODE_SECRET_SWEEP_ENABLED` (true unless `false`): this replica runs the brokered-secret sweep. */
  secretSweepEnabled: boolean;
}

/**
 * The configuration the jobs and nodes slices read.
 *
 * @stability stable
 */
export interface JobsConfiguration {
  /** The queue and the worker pool. */
  jobs: JobsConfigurationKeys;
  /** The fleet's crons. */
  nodes: NodesConfigurationKeys;
}

function int(value: string | undefined, fallback: string): number {
  return parseInt(value || fallback, 10);
}

/**
 * Builds the `jobs.*` and `nodes.*` configuration keys from `env`. Spread it
 * into the app's configuration factory.
 *
 * @param env - the environment; `process.env` by default.
 * @returns the keys, with the shipped defaults for every unset variable.
 *
 * @example
 * ```ts
 * export default () => ({ ...identityConfiguration(), ...jobsConfiguration(), port: 3000 });
 * ```
 *
 * @stability stable
 */
export function jobsConfiguration(env: NodeJS.ProcessEnv = process.env): JobsConfiguration {
  return {
    jobs: {
      maxAttempts: int(env.JOBS_MAX_ATTEMPTS, '3'),
      retryBaseMs: int(env.JOBS_RETRY_BASE_MS, '2000'),
      retryMaxMs: int(env.JOBS_RETRY_MAX_MS, '60000'),
      rateLimitMaxHits: int(env.JOBS_RATELIMIT_MAX_HITS, '10'),
      rateLimitBaseMs: int(env.JOBS_RATELIMIT_BASE_MS, '30000'),
      rateLimitMaxMs: int(env.JOBS_RATELIMIT_MAX_MS, '900000'),
      workerConcurrency: int(env.JOBS_WORKER_CONCURRENCY, '2'),
      pollMs: int(env.JOBS_POLL_MS, '5000'),
      workerMode: env.JOBS_WORKER_MODE || 'all',
      jobTimeoutMs: int(env.JOBS_JOB_TIMEOUT_MS, '600000'),
      reaperEnabled: env.JOBS_REAPER_ENABLED !== 'false',
      systemModeExtraTypes: (env.JOBS_SYSTEM_MODE_EXTRA_TYPES || '')
        .split(',')
        .map((type) => type.trim())
        .filter((type) => type.length > 0),
    },
    nodes: {
      staleOfflineEnabled: env.NODE_STALE_OFFLINE_ENABLED !== 'false',
      offlinePruneEnabled: env.NODE_OFFLINE_PRUNE_ENABLED !== 'false',
      secretSweepEnabled: env.NODE_SECRET_SWEEP_ENABLED !== 'false',
    },
  };
}
