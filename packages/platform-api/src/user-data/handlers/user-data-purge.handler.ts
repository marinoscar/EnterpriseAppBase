// =============================================================================
// `user.data.purge`: one user's data, one scope (issue #743, PP-9.1)
// =============================================================================
//
// Enqueued by `POST /api/user-data/deletions` with subject `user:<userId>`
// (the queue's active dedup allows one pending or running purge per user;
// the API never pre-checks with a `findFirst`). The work is
// `UserPurgeRunner.runJob` (read its header).
//
// SERVER-ONLY, PERMANENTLY: no `nodeResultSchema`, no `persistNodeResult`. The
// purge reads and deletes across every table with the bypass client, a
// privilege a remote machine must never hold.
//
// LEGACY ALIASES (`legacyJobTypes`): an app's own pre-platform job type (EvoPath's
// `user.data_reset`) is permanent once queued, so the module registers one
// `LegacyUserDataPurgeHandler` per alias: it maps the old payload with the
// app's `toPayload` and runs the same work.
// =============================================================================

import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { USER_DATA_PURGE_JOB_TYPE } from '@marinoscar/platform-contract/user-data';

import { JobHandlerRegistry, type Job, type JobExecutionProfile, type JobHandler } from '../../jobs/index';
import { USER_DATA_OPTIONS, type ResolvedUserDataModuleOptions } from '../user-data.options';
import type { LegacyUserDataJobType } from '../user-data.types';
import { UserPurgeRunner, payloadOf, userDataPurgeInputSchema } from '../user-purge.runner';

/**
 * The profile of `user.data.purge`: 15 minutes, 3 attempts (EvoPath's).
 *
 * @stability experimental
 */
export const USER_DATA_PURGE_PROFILE: JobExecutionProfile = Object.freeze({ maxRuntimeMs: 15 * 60_000, maxAttempts: 3 });

/**
 * The `user.data.purge` job handler. Server-only.
 *
 * @stability experimental
 */
@Injectable()
export class UserDataPurgeHandler implements JobHandler, OnModuleInit {
  readonly type = USER_DATA_PURGE_JOB_TYPE;
  readonly label = 'User data deletion';
  readonly profile = USER_DATA_PURGE_PROFILE;

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly runner: UserPurgeRunner,
  ) {}

  /** Self-registration: the only wiring a handler needs. */
  onModuleInit(): void {
    this.registry.register(this);
  }

  /**
   * Validates the payload and runs the purge.
   *
   * @param job - the claimed job.
   */
  async process(job: Job): Promise<void> {
    const parsed = userDataPurgeInputSchema.safeParse(payloadOf(job));
    if (!parsed.success) throw new Error(`user.data.purge job ${job.id}: payload must carry { userId (uuid), scope }`);
    await this.runner.runJob(job, parsed.data);
  }
}

/**
 * An alias handler for one legacy job type: maps the old payload and runs
 * the `user.data.purge` work. Server-only, same profile.
 *
 * @stability experimental
 */
export class LegacyUserDataPurgeHandler implements JobHandler {
  readonly type: string;
  readonly label: string;
  readonly profile = USER_DATA_PURGE_PROFILE;

  constructor(
    private readonly alias: LegacyUserDataJobType,
    private readonly runner: UserPurgeRunner,
  ) {
    this.type = alias.type;
    this.label = `User data deletion (legacy ${alias.type})`;
  }

  /**
   * Maps the old payload and runs the purge. The payload keeps the old keys
   * next to the platform's.
   *
   * @param job - the claimed legacy job.
   */
  async process(job: Job): Promise<void> {
    const old = payloadOf(job);
    const mapped = userDataPurgeInputSchema.safeParse(this.alias.toPayload(old));
    if (!mapped.success) throw new Error(`${this.alias.type} job ${job.id}: toPayload did not return { userId (uuid), scope }`);
    await this.runner.runJob(job, mapped.data);
  }
}

/**
 * Registers one {@link LegacyUserDataPurgeHandler} per `legacyJobTypes` entry.
 *
 * @stability experimental
 */
@Injectable()
export class LegacyUserDataPurgeHandlers implements OnModuleInit {
  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly runner: UserPurgeRunner,
    @Inject(USER_DATA_OPTIONS) private readonly options: ResolvedUserDataModuleOptions,
  ) {}

  /** The handlers, one per alias (registered by `onModuleInit`). */
  handlers(): LegacyUserDataPurgeHandler[] {
    return this.options.legacyJobTypes.map((alias) => new LegacyUserDataPurgeHandler(alias, this.runner));
  }

  /** Self-registration of every alias. */
  onModuleInit(): void {
    for (const handler of this.handlers()) this.registry.register(handler);
  }
}
