// =============================================================================
// AiRunsService — the `ai_runs` rows behind background runs
// (issue #432, epic #419)
// =============================================================================
//
// A background run is an `ai_runs` row (what the user asked for, what came
// back) executed by one job (docs/specs/ai-platform.md §2.20): `ai.response.run`
// for a response, `ai.image.generate` for an image generation or edit (#437),
// `ai.audio.transcribe` for a transcription (#438), `ai.audio.speech` for
// speech (#439); `request.operation`
// tells them apart — see `ai-run-operation.ts`.
// This service owns the row's state machine:
//
//   pending ──claim──▶ running ──complete──▶ succeeded
//      │                  │ └────fail──────▶ failed
//      │                  └─release (rate limited; the job retries later)─▶ pending
//      └──────────── cancel (owner) ────────▶ cancelled   (from pending or running)
//
// Every transition is a conditional `updateMany` on the expected CURRENT
// status, so a cancel racing a completion has exactly one winner and a
// cancelled run is never overwritten by a late result.
//
// Cancellation of a RUNNING run is best-effort: this process aborts the
// provider call at once when it holds it; another replica notices on its next
// poll of the row (`AiResponseRunHandler`).
//
// Owner-facing reads (`get`, `cancel`) are scoped to the owner: another
// user's run id is a 404, indistinguishable from one that does not exist.
//
// ORGANIZATION SCOPE (issue #725). `ai_runs` is under row-level security, so
// every read and write goes through a client scoped to ONE organization:
// `forOrg(orgId)` returns that scoped view (`AiRunsInOrg`) and the methods on
// it are the ones above. A handler resolves the organization from its job's
// payload, an HTTP controller from the principal; a run of another
// organization is simply not found.
// =============================================================================

import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { JobsService } from '../../jobs/jobs.service';
import { resolveJobOrgId } from '@marinoscar/platform-api/identity';
import { PrismaService } from '../../prisma/prisma.service';
import type { StoredAiSpeechRunRequest, StoredAiTranscriptionRunRequest } from './ai-audio-run-request';
import type { StoredAiImageRunRequest } from './ai-image-run-request';
import { asJson, type StoredAiRunRequest } from './ai-run-request';
import type { AiRunHandle, AiRunOutput, AiRunStatus, AiRunView } from './ai-runtime.types';

/** The job type of a responses run. PERMANENT once jobs of it exist. */
export const AI_RESPONSE_RUN_TYPE = 'ai.response.run';

/** The job type of an image generation/edit run (#437). PERMANENT once jobs of it exist. */
export const AI_IMAGE_GENERATE_TYPE = 'ai.image.generate';

/** The job type of a transcription run (#438). PERMANENT once jobs of it exist. */
export const AI_AUDIO_TRANSCRIBE_TYPE = 'ai.audio.transcribe';

/** The job type of a speech run (#439). PERMANENT once jobs of it exist. */
export const AI_AUDIO_SPEECH_TYPE = 'ai.audio.speech';

/** `Job.subjectType` of an `ai.response.run` job; `subjectId` is the run id. */
export const AI_RUN_SUBJECT_TYPE = 'ai_run';

/** How many organizations' scoped views are kept. */
const SCOPED_VIEWS_MAX = 64;

const ACTIVE: AiRunStatus[] = ['pending', 'running'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VIEW_SELECT = {
  id: true,
  status: true,
  provider: true,
  modelId: true,
  output: true,
  errorCode: true,
  errorMessage: true,
  jobId: true,
  createdAt: true,
  completedAt: true,
} satisfies Prisma.AiRunSelect;

type ViewRow = Prisma.AiRunGetPayload<{ select: typeof VIEW_SELECT }>;

/** What the handler reads to execute a run. */
export interface AiRunExecutionRow {
  id: string;
  userId: string | null;
  status: string;
  /** The job that last claimed it (a resumed attempt recognises its own run). */
  jobId: string | null;
  request: Prisma.JsonValue;
}

@Injectable()
export class AiRunsService {
  /** Provider calls this process is executing, by run id — for cancel. */
  private readonly inFlight = new Map<string, AbortController>();

  /** Scoped views by organization, least recently used first. */
  private readonly scoped = new Map<string, AiRunsInOrg>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
  ) {}

  // ---- owner-facing -------------------------------------------------------------

  /**
   * Creates the `pending` row and enqueues its job in ONE transaction, so
   * there is never a run no job will execute, nor a job for a missing run.
   */
  async create(input: {
    userId: string;
    /** The organization the run belongs to; also the job payload's `orgId`. */
    orgId: string;
    provider: string;
    modelId: string;
    request:
      | StoredAiRunRequest
      | StoredAiImageRunRequest
      | StoredAiTranscriptionRunRequest
      | StoredAiSpeechRunRequest;
    /** The job type that executes it. Defaults to `ai.response.run`. */
    jobType?: string;
  }): Promise<AiRunHandle> {
    return this.prisma.runInOrg(input.orgId, async (tx) => {
      const run = await tx.aiRun.create({
        data: {
          userId: input.userId,
          orgId: input.orgId,
          provider: input.provider,
          modelId: input.modelId,
          status: 'pending',
          request: asJson(input.request),
        },
        select: { id: true },
      });

      const job = await this.jobs.enqueueWithin(tx, {
        type: input.jobType ?? AI_RESPONSE_RUN_TYPE,
        reason: 'upload',
        subjectType: AI_RUN_SUBJECT_TYPE,
        subjectId: run.id,
        payload: { runId: run.id, orgId: input.orgId },
      });

      await tx.aiRun.update({ where: { id: run.id }, data: { jobId: job.id } });

      return { runId: run.id, jobId: job.id };
    }, { userId: input.userId });
  }

  /**
   * The organization a run's job belongs to: the payload's `orgId`; a job
   * enqueued before #725 has none (single mode: the default organization;
   * multi mode: this throws and the job fails with the reason).
   */
  orgOfJob(job: { id: string; type: string; payload: unknown }): Promise<string> {
    return resolveJobOrgId(this.prisma, job);
  }

  /**
   * The organization a settled job's event belongs to (see {@link orgOfJob});
   * the event carries the job row, whose payload names it.
   */
  orgOfEvent(event: { jobId: string; type: string; job?: { payload: unknown } | undefined }): Promise<string> {
    return resolveJobOrgId(this.prisma, { id: event.jobId, type: event.type, payload: event.job?.payload });
  }

  /**
   * The run state machine, scoped to one organization (row-level security,
   * #725). Memoised for the most recently used organizations, so a handler's
   * polling timer and its settle listener share one scoped client.
   */
  forOrg(orgId: string): AiRunsInOrg {
    const cached = this.scoped.get(orgId);
    if (cached) {
      this.scoped.delete(orgId);
      this.scoped.set(orgId, cached);
      return cached;
    }

    const created = new AiRunsInOrg(this.prisma.forOrg(orgId), this.inFlight);
    this.scoped.set(orgId, created);
    if (this.scoped.size > SCOPED_VIEWS_MAX) this.scoped.delete(this.scoped.keys().next().value as string);
    return created;
  }

  /** Registers this process's controller for a running run; returns the unregister. */
  attach(runId: string, controller: AbortController): () => void {
    this.inFlight.set(runId, controller);

    return () => {
      if (this.inFlight.get(runId) === controller) this.inFlight.delete(runId);
    };
  }
}

/**
 * The run state machine bound to one organization's scoped database client.
 * Obtain it with {@link AiRunsService.forOrg}.
 */
export class AiRunsInOrg {
  constructor(
    private readonly db: ReturnType<PrismaService['forOrg']>,
    private readonly inFlight: Map<string, AbortController>,
  ) {}

  /** The owner's run. Anyone else's (or a malformed id) is a 404. */
  async get(userId: string, runId: string): Promise<AiRunView> {
    const row = UUID.test(runId)
      ? await this.db.aiRun.findFirst({ where: { id: runId, userId }, select: VIEW_SELECT })
      : null;

    if (!row) {
      throw new NotFoundException('AI run not found');
    }

    return toView(row);
  }

  /**
   * Cancels the owner's run if it is still pending or running (idempotent
   * otherwise — a finished run is returned unchanged). A run executing in
   * THIS process has its provider call aborted immediately.
   */
  async cancel(userId: string, runId: string): Promise<AiRunView> {
    await this.get(userId, runId);

    const { count } = await this.db.aiRun.updateMany({
      where: { id: runId, userId, status: { in: ACTIVE } },
      data: { status: 'cancelled', completedAt: new Date() },
    });

    if (count > 0) {
      this.inFlight.get(runId)?.abort(new Error('AI run cancelled'));
    }

    return this.get(userId, runId);
  }

  // ---- handler-facing --------------------------------------------------------------

  async load(runId: string): Promise<AiRunExecutionRow | null> {
    return this.db.aiRun.findUnique({
      where: { id: runId },
      select: { id: true, userId: true, status: true, jobId: true, request: true },
    });
  }

  /** pending -> running. `false` when the run is no longer pending (cancelled, done). */
  async claim(runId: string, jobId: string): Promise<boolean> {
    const { count } = await this.db.aiRun.updateMany({
      where: { id: runId, status: 'pending' },
      data: { status: 'running', jobId },
    });

    return count > 0;
  }

  /** running -> succeeded. `false` when the run was cancelled meanwhile. */
  async complete(runId: string, output: AiRunOutput): Promise<boolean> {
    const { count } = await this.db.aiRun.updateMany({
      where: { id: runId, status: 'running' },
      data: {
        status: 'succeeded',
        output: asJson(output),
        errorCode: null,
        errorMessage: null,
        completedAt: new Date(),
      },
    });

    return count > 0;
  }

  /** pending|running -> failed. Messages are the safe, generic `AiError` ones. */
  async fail(runId: string, errorCode: string, errorMessage: string): Promise<boolean> {
    const { count } = await this.db.aiRun.updateMany({
      where: { id: runId, status: { in: ACTIVE } },
      data: { status: 'failed', errorCode, errorMessage, completedAt: new Date() },
    });

    return count > 0;
  }

  /** running -> pending, for a job the queue will run again (a provider throttle). */
  async release(runId: string): Promise<void> {
    await this.db.aiRun.updateMany({
      where: { id: runId, status: 'running' },
      data: { status: 'pending' },
    });
  }

  async isCancelled(runId: string): Promise<boolean> {
    const row = await this.db.aiRun.findUnique({ where: { id: runId }, select: { status: true } });

    return row?.status === 'cancelled';
  }
}

function toView(row: ViewRow): AiRunView {
  return {
    id: row.id,
    status: row.status as AiRunStatus,
    provider: row.provider,
    modelId: row.modelId,
    output: (row.output as AiRunOutput | null) ?? null,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    jobId: row.jobId,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}
