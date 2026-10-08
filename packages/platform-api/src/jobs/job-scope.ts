// =============================================================================
// JobScope: run a job's tenant work under the job's organization (issue #734)
// =============================================================================
//
// `jobs` itself carries no row-level security: the claim is one
// cross-organization statement (see `job-claim.service.ts`). But the work a
// job DOES often touches the org tables that are RLS-protected
// (`storage_objects`, `ai_runs`, `org_settings`, ...), and a client with no
// scope sees no rows there. `JobScope.run(job, fn)` opens one interactive
// transaction whose first statement is core's transaction-local
// `set_config('app.org_id', job.orgId, true)` (`runInOrg`), so every read and
// write inside `fn` sees exactly the job's organization, and the policy's
// `WITH CHECK` refuses a write into any other.
//
// A SYSTEM job (`orgId` null: housekeeping, fleet sweeps, backups) is refused
// here, loudly: it has no organization to scope to, and it keeps the bypass
// connection exactly as #725 defined it (the app's `PrismaSystemService`,
// `runAsSystem`, with a named `SystemAccessReason`). Falling back to a
// bypass inside this helper would turn "forgot to set orgId" into "read every
// tenant's rows", which is the failure RLS exists to prevent.
// =============================================================================

import { Inject, Injectable } from '@nestjs/common';

import {
  PLATFORM_PRISMA,
  ScopedAccessError,
  runInOrg,
  type RlsRunnableClient,
  type RlsTransactionOptions,
} from '../core/index';

import type { Job } from './data/jobs-db';

/**
 * Runs a handler's tenant work inside the job's organization: one interactive
 * transaction, `app.org_id` set transaction-locally to `job.orgId` as its
 * first statement, so row-level-security-protected tables show only that
 * organization's rows. Injectable (provided and exported by `JobsModule`);
 * it runs on the app's ordinary client (`PLATFORM_PRISMA`).
 *
 * A system job (`orgId: null`) is refused: it keeps the bypass connection
 * (`runAsSystem` on the app's system client) with a named reason.
 *
 * @example
 * ```ts
 * async process(job: Job): Promise<void> {
 *   const count = await this.jobScope.run(job, (tx: Prisma.TransactionClient) => tx.storageObject.count());
 * }
 * ```
 *
 * @stability experimental
 */
@Injectable()
export class JobScope {
  constructor(@Inject(PLATFORM_PRISMA) private readonly prisma: RlsRunnableClient) {}

  /**
   * Runs `fn` in one transaction scoped to `job.orgId`.
   *
   * @typeParam R - what `fn` resolves to.
   * @typeParam TTx - the transaction client's type as the app sees it (its generated `Prisma.TransactionClient`).
   * @param job - the job being processed; only `id` and `orgId` are read.
   * @param fn - the unit of work; receives the scoped transaction client.
   * @param options - `maxWait` and `timeout`, forwarded to Prisma.
   * @returns what `fn` resolved to.
   * @throws ScopedAccessError when the job is a system job (`orgId` null) or `orgId` is not a UUID.
   *
   * @extensionPoint hook
   * @stability experimental
   */
  run<R, TTx = unknown>(
    job: Pick<Job, 'id' | 'orgId'>,
    fn: (tx: TTx) => Promise<R>,
    options: RlsTransactionOptions = {},
  ): Promise<R> {
    if (job.orgId === null || job.orgId === undefined) {
      return Promise.reject(
        new ScopedAccessError(
          `JobScope.run(): job ${job.id} is a system job (orgId null), so it has no organization to scope to; ` +
            'system work keeps the bypass connection (runAsSystem with a SystemAccessReason).',
        ),
      );
    }
    return runInOrg(this.prisma, { orgId: job.orgId }, (tx) => fn(tx as unknown as TTx), options);
  }
}
