// =============================================================================
// `ai.image.generate` job handler — one image generation or edit
// (issue #437, epic #420; docs/specs/ai-platform.md §5.2, §9)
// =============================================================================
//
// Payload `{ runId }`, subjectType `'ai_run'`. Enqueued by
// `AiUserClient.generateImage`/`editImage` in the same transaction that
// creates the run row; `request.operation` says which of the two it is.
//
// SERVER-ONLY, PERMANENTLY — no `nodeResultSchema`/`persistNodeResult`, for
// the reason every `ai.*` type gives (CLAUDE.md AI rule 3): the call spends a
// user's own key, or the org key, and neither may reach a worker node.
//
// PROFILE `{ maxRuntimeMs: 10 min, maxAttempts: 1 }`. An image call is billed
// per image and is not idempotent: an automatic retry is a second charge. A
// provider throttle still DEFERS the job (its own budget) instead.
//
// ORDER, and why:
//
//   1. the gates (inside `executeImageRun`)   a switched-off platform, a
//                                             revoked key, an input that is no
//                                             longer the user's: no call
//   2. `AiOutputWriter.assertWritable()`       no storage -> no call: images
//                                             that cannot be kept are never
//                                             paid for (AI_STORAGE_UNAVAILABLE)
//   3. the provider call (one usage row, `units: { images: n }`)
//   4. write every image as a storage object the user owns, under
//      `ai-outputs/<userId>/<runId>/`, then `complete` the run with
//      `{ type: 'images', storageObjectIds, images, … }`
//
// OUTCOMES follow `ai.response.run` exactly (`AI_RUN_TERMINAL_CODES`: an
// expected refusal fails the run and the job returns; anything else fails the
// run and the job throws), plus two storage cases:
//
//   - storage unconfigured / unwritable    run `failed` AI_STORAGE_UNAVAILABLE,
//                                          job THROWS — an operator must act
//   - an input deleted or no longer the    run `failed` AI_INVALID_REQUEST,
//     user's since the run was queued       job returns (the user's own doing)
//
// CANCELLATION. The owner cancels through `AiRunsService.cancel` (same as a
// responses run): a pending run is never started; a running one has its
// provider call aborted (this process at once, another replica on its next
// poll). Images that were already written when the cancel won are discarded,
// so a cancelled run leaves no objects behind.
// =============================================================================

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Job } from '@prisma/client';
import { z } from 'zod';

import { JOB_SETTLED_EVENT, JobSettledEvent } from '../../jobs/events/job-settled.event';
import { JobExecutionProfile } from '../../jobs/job-execution-profile';
import { JobHandler } from '../../jobs/job-handler.interface';
import { JobHandlerRegistry } from '../../jobs/job-handler.registry';
import { AiError } from '../core/ai-error';
import type { AiImageResult } from '../core/types/media.types';
import { AiOutputWriter, type AiStoredOutput } from '../storage/ai-output-writer';
import { aiErrorFromStorage } from '../storage/ai-storage-errors';
import { AiService } from './ai.service';
import { AI_IMAGE_OPERATIONS, type AiImageOperation, parseStoredImageRunRequest } from './ai-image-run-request';
import { aiRunOperation } from './ai-run-operation';
import { AI_RUN_CANCEL_POLL_MS, AI_RUN_TERMINAL_CODES } from './ai-response-run.handler';
import { AI_IMAGE_GENERATE_TYPE, AI_RUN_SUBJECT_TYPE, AiRunsService } from './ai-runs.service';
import type { AiImageRunOutput } from './ai-runtime.types';

export const aiImageGeneratePayloadSchema = z.object({
  runId: z.string().uuid(),
});

const MAX_RUNTIME_MS = 10 * 60_000;

/** The run's own deadline: a little inside the job's, so the run records it cleanly. */
const RUN_DEADLINE_MS = MAX_RUNTIME_MS - 15_000;

@Injectable()
export class AiImageGenerateHandler implements JobHandler, OnModuleInit {
  private readonly logger = new Logger(AiImageGenerateHandler.name);

  readonly type = AI_IMAGE_GENERATE_TYPE;

  readonly profile: JobExecutionProfile = { maxRuntimeMs: MAX_RUNTIME_MS, maxAttempts: 1 };

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly ai: AiService,
    private readonly runs: AiRunsService,
    private readonly outputs: AiOutputWriter,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async process(job: Job): Promise<void> {
    const parsed = aiImageGeneratePayloadSchema.safeParse(job.payload);

    if (!parsed.success) {
      throw new Error(`Invalid ${AI_IMAGE_GENERATE_TYPE} payload: expected { runId }`);
    }

    const { runId } = parsed.data;
    const run = await this.runs.load(runId);

    if (!run) {
      this.logger.warn(`AI image run ${runId} no longer exists; job ${job.id} is a no-op`);
      return;
    }

    if (run.status !== 'pending') {
      this.logger.log(`AI image run ${runId} is ${run.status}; job ${job.id} is a no-op`);
      return;
    }

    if (!run.userId) {
      await this.runs.fail(runId, 'AI_KEY_REQUIRED', 'The user who started this run no longer exists.');
      return;
    }

    if (!AI_IMAGE_OPERATIONS.includes(aiRunOperation(run.request) as AiImageOperation)) {
      await this.runs.fail(runId, 'AI_INVALID_REQUEST', 'This run is not an image run.');
      return;
    }

    if (!(await this.runs.claim(runId, job.id))) {
      this.logger.log(`AI image run ${runId} changed state before it could start; job ${job.id} is a no-op`);
      return;
    }

    const userId = run.userId;
    const controller = new AbortController();
    const detach = this.runs.attach(runId, controller);
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error('AI image run timed out'));
    }, RUN_DEADLINE_MS);
    const poll = setInterval(() => {
      void this.runs
        .isCancelled(runId)
        .then((cancelled) => {
          if (cancelled) controller.abort(new Error('AI run cancelled'));
        })
        .catch(() => undefined);
    }, AI_RUN_CANCEL_POLL_MS);

    deadline.unref?.();
    poll.unref?.();

    try {
      const stored = parseStoredImageRunRequest(run.request);

      let result: AiImageResult;

      try {
        result = await this.ai.executeImageRun(userId, stored, {
          jobId: job.id,
          signal: controller.signal,
          beforeCall: () => this.outputs.assertWritable(),
        });
      } catch (err) {
        throw aiErrorFromStorage(err) ?? err;
      }

      if (controller.signal.aborted && !timedOut && (await this.runs.isCancelled(runId))) {
        this.logger.log(`AI image run ${runId} was cancelled while it ran; its images are not stored`);
        return;
      }

      const files = await this.store(userId, runId, result);
      const output = toRunOutput(result, files);

      if (!(await this.runs.complete(runId, output))) {
        this.logger.log(`AI image run ${runId} was cancelled while it ran; its images are discarded`);
        await this.outputs.discard(output.storageObjectIds);
      }
    } catch (err) {
      await this.settleFailure(runId, job.id, err, controller.signal.aborted, timedOut);
    } finally {
      clearTimeout(deadline);
      clearInterval(poll);
      detach();
    }
  }

  /**
   * The safety net `ai.response.run` has too: a job that settled FAILED while
   * its run is still active (the worker's own timeout, a rate-limit budget
   * exhausted, a crash) must not leave the run `pending`/`running` forever.
   */
  @OnEvent(JOB_SETTLED_EVENT)
  async onJobSettled(event: JobSettledEvent): Promise<void> {
    if (event.type !== AI_IMAGE_GENERATE_TYPE || event.succeeded) return;
    if (event.subjectType !== AI_RUN_SUBJECT_TYPE || !event.subjectId) return;

    try {
      await this.runs.fail(
        event.subjectId,
        'AI_PROVIDER_UNAVAILABLE',
        'The background job ended before the image run completed.',
      );
    } catch (error) {
      this.logger.warn(
        `Could not mark AI image run ${event.subjectId} failed after job ${event.jobId} settled: ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  /** Every image as a storage object the user owns. Any failure here is a storage outcome. */
  private async store(userId: string, runId: string, result: AiImageResult): Promise<AiStoredOutput[]> {
    try {
      return await this.outputs.write({
        userId,
        runId,
        files: result.images.map((image) => ({ data: image.data, mimeType: image.mimeType })),
        namePrefix: 'ai-image',
        metadata: { provider: result.provider, model: result.model },
      });
    } catch (err) {
      throw (
        aiErrorFromStorage(err) ??
        new AiError('AI_STORAGE_UNAVAILABLE', 'The generated images could not be stored.', { cause: err })
      );
    }
  }

  private async settleFailure(
    runId: string,
    jobId: string,
    err: unknown,
    aborted: boolean,
    timedOut: boolean,
  ): Promise<void> {
    if (aborted && !timedOut && (await this.runs.isCancelled(runId))) {
      this.logger.log(`AI image run ${runId} cancelled by its owner (job ${jobId})`);
      return;
    }

    if (timedOut) {
      await this.runs.fail(runId, 'AI_PROVIDER_UNAVAILABLE', 'The AI image run timed out.');
      throw new Error(`AI image run ${runId} exceeded its ${RUN_DEADLINE_MS}ms deadline`);
    }

    const error = AiError.wrap(err);
    const rateLimit = error.toRateLimitError();

    if (rateLimit) {
      await this.runs.release(runId);
      throw rateLimit;
    }

    await this.runs.fail(runId, error.code, error.message);

    if (AI_RUN_TERMINAL_CODES.has(error.code)) {
      this.logger.log(`AI image run ${runId} ended with ${error.code} (job ${jobId})`);
      return;
    }

    // The error that says what really happened, for the job's `lastError`.
    throw err;
  }
}

function toRunOutput(result: AiImageResult, stored: AiStoredOutput[]): AiImageRunOutput {
  return {
    type: 'images',
    provider: result.provider,
    model: result.model,
    storageObjectIds: stored.map((file) => file.storageObjectId),
    images: stored.map((file, index) => ({
      storageObjectId: file.storageObjectId,
      mimeType: file.mimeType,
      size: file.size,
      ...(result.images[index]?.revisedPrompt ? { revisedPrompt: result.images[index].revisedPrompt } : {}),
    })),
    usage: result.usage,
  };
}
