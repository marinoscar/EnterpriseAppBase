import type { Job, JobHandler } from '@marinoscar/platform-api/jobs';
import type { SystemAccessReason, SystemAccessReasonDef } from '@marinoscar/platform-api/core';

// =============================================================================
// EXAMPLE: an app's own system access reason (PP-14.14)
// =============================================================================
//
// `transcript-reindex` is a reason the PLATFORM does not know. The app registers
// it (`app-registrations/core.ts`, with `registerSystemAccessReason`) and its job
// runs cross-organization work under it:
//
//     await runAsSystem(systemPrisma, TRANSCRIPT_REINDEX_REASON, (tx) => ...)
//
// What registering the reason does NOT do: it grants no access. Lifting row-level
// security needs the SYSTEM Prisma client, and only the files on the allowlist
// of `test/tenancy/system-injection-boundary.spec.ts` may inject
// `PrismaSystemService`. So this job never touches it. It receives a
// `SystemWork` port, the same shape the packaged slices use (`STORAGE_SYSTEM_DATA`,
// `AI_SYSTEM_PRISMA`): the app's ONE allowlisted host module implements the port
// with `PrismaSystemService.runAsSystem`, and this file stays off the list. A
// reason is a label on an acquisition; the allowlist decides who may acquire.
//
// The job is not registered in the running app (it needs a real search index);
// `test/examples/core/open-vocabularies.spec.ts` runs it against a fake client.
// Recipe: docs/EXTENDING.md, "Add a system access reason".
// =============================================================================

/** The reason the re-index job runs under. */
export const TRANSCRIPT_REINDEX_REASON = 'transcript-reindex' as const satisfies SystemAccessReason;

/** The registration `app-registrations/core.ts` makes. */
export const transcriptReindexReason: SystemAccessReasonDef = {
  id: TRANSCRIPT_REINDEX_REASON,
  description: 'The transcript re-index job rebuilds search rows for every organization in one pass.',
};

/**
 * What the job needs from the app's allowlisted host module: one unit of
 * cross-organization work, under a named reason. The implementation calls
 * `runAsSystem` of `@marinoscar/platform-api/core` on the system client.
 */
export interface SystemWork {
  /** Runs `fn` with row-level security lifted for its transaction. Throws for an unregistered `reason`. */
  run<R>(reason: SystemAccessReason, fn: (tx: ReindexTransaction) => Promise<R>): Promise<R>;
}

/** The slice of the transaction client the job uses. */
export interface ReindexTransaction {
  /** Counts the transcripts still waiting for the new index, across organizations. */
  countStale(): Promise<number>;
  /** Marks them indexed; returns how many. */
  markIndexed(): Promise<number>;
}

/** Injection token of {@link SystemWork}. */
export const TRANSCRIPT_REINDEX_SYSTEM_WORK = Symbol('TRANSCRIPT_REINDEX_SYSTEM_WORK');

/** A queue job: server-only (no node result schema), because it writes as it goes. */
export class TranscriptReindexHandler implements JobHandler {
  readonly type = 'app.transcript.reindex';
  readonly label = 'Transcript re-index';
  readonly profile = { maxRuntimeMs: 10 * 60_000, maxAttempts: 2 } as const;

  /** How many rows the last run indexed (for the example's assertions). */
  lastIndexed = 0;

  constructor(private readonly system: SystemWork) {}

  async process(_job: Job): Promise<void> {
    this.lastIndexed = await this.system.run(TRANSCRIPT_REINDEX_REASON, async (tx) => {
      if ((await tx.countStale()) === 0) return 0;
      return tx.markIndexed();
    });
  }
}
