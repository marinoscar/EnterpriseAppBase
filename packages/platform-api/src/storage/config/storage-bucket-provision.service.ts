import { Injectable, Logger, Inject } from '@nestjs/common';

import { PLATFORM_PRISMA } from '../../core/index';
import type { StorageInputJsonValue, StoragePrisma } from '../data/storage-db';
import {
  STORAGE_BUCKET_STEP_LABELS,
  type StorageDriverProvisionResult,
} from '../drivers/storage-driver';
import { STORAGE_RUNBOOK_PATH } from '../drivers/s3/s3-provision';
import type {
  ProvisionStorageBucketInput,
  StorageBucketProvisionResult,
  StorageBucketStep,
  StorageBucketStepId,
} from './dto/storage-bucket-provision.dto';
import { StorageSubmissionService, type PreparedStorageSubmission } from './storage-submission.service';

export { STORAGE_RUNBOOK_PATH };

const STEP_IDS: readonly StorageBucketStepId[] = ['create', 'publicAccessBlock', 'encryption', 'cors'];

// =============================================================================
// StorageBucketProvisionService — create the bucket, correctly (#375, epic #372)
// =============================================================================
//
// The remedy the connection test's `bucket_missing` verdict points at, and the
// one place in this application that knows what a bucket has to LOOK LIKE for
// this product to work:
//
//   1. it exists, in the right region;
//   2. it is not public (AWS only — R2 buckets are private by default and there
//      is no equivalent API to call);
//   3. it encrypts at rest (AWS only — R2 does this unconditionally);
//   4. ⚠ its CORS rule lets the browser read `ETag` back.
//
// Step 4 is the one that is easy to get wrong and impossible to diagnose. The
// browser multipart path reads the `ETag` off each `UploadPart` response and
// posts the list to `POST /storage/objects/:id/upload/complete`
// (`objects.service.ts`), and a cross-origin `fetch` CANNOT READ a response
// header that is absent from `Access-Control-Expose-Headers`. A bucket whose
// CORS rule omits `ExposeHeaders: ['ETag']` therefore transfers every byte of a
// large upload successfully and then fails to complete it, with a browser-side
// error that mentions neither CORS nor the bucket. That is why this endpoint
// exists at all rather than a documentation page saying "create a bucket".
//
// -----------------------------------------------------------------------------
// ⚠ `guided` IS A 200 AND IS A DESIGNED-IN PATH, NOT A FALLBACK
// -----------------------------------------------------------------------------
//
// An application credential without `s3:CreateBucket` is the ORDINARY
// least-privilege configuration, and R2 API tokens are routinely minted with
// object permissions and no bucket admin at all. See the header of
// `dto/storage-bucket-provision.dto.ts` for the full argument; it is the same
// one `db-backup`'s `CREATEROLE` and `CREATEDB` gates make, and this service is
// deliberately consistent with them down to the shape of the guidance object.
//
// -----------------------------------------------------------------------------
// THE CORS ORIGIN COMES FROM `APP_URL`, NEVER FROM THE REQUEST
// -----------------------------------------------------------------------------
//
// A caller-supplied origin would make this a "grant any website write access to
// our bucket" button, reachable by anyone holding `storage_config:write`. The
// deployment already knows its own origin; there is nothing for a request to
// add, and a field for one is a field somebody will eventually fill in.
// =============================================================================


/**
 * Creates the bucket (or container) the submitted configuration names, through the DRIVER it names (the S3 family also hardens it: public access blocked, encryption on, the CORS rule browsers need); reports every step.
 *
 * @stability experimental
 */
@Injectable()
export class StorageBucketProvisionService {
  private readonly logger = new Logger(StorageBucketProvisionService.name);

  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: StoragePrisma,
    private readonly submission: StorageSubmissionService,
  ) {}

  /**
   * Create and harden the bucket the submitted configuration names.
   *
   * NEVER THROWS for a storage failure — see the DTO's header for why every
   * outcome, including `guided` and `failed`, travels as a 200 payload. A body
   * naming a driver nobody registered, or settings it refuses, is a 400.
   */
  async provision(
    input: ProvisionStorageBucketInput,
    actorUserId: string,
  ): Promise<StorageBucketProvisionResult> {
    const attemptedAt = new Date();
    const prepared = await this.submission.prepare(input as unknown as { provider: string } & Record<string, unknown>);
    const { driver } = prepared;

    // A backend with no bucket or container concept (a filesystem, a database
    // table) says so; that is an answer, not a fault.
    if (driver.provision === undefined) {
      const detail = `The ${driver.label} driver has no bucket or container to create.`;

      return this.record(
        this.result(prepared, attemptedAt, {
          created: false,
          message: detail,
          outcome: 'failed',
          steps: STEP_IDS.map((id) => this.step(id, 'skipped', detail)),
        }),
        actorUserId,
      );
    }

    let outcome: StorageDriverProvisionResult;

    try {
      outcome = await driver.provision(prepared.ctx);
    } catch (error) {
      // The contract says a driver reports a failure as a result. One that
      // throws anyway still gets an answer, with the secret redacted.
      const message = prepared.redact(`The ${driver.label} driver failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`);
      this.logger.warn(`Storage driver "${driver.id}" threw from provision: ${message}`);
      outcome = {
        created: false,
        message,
        outcome: 'failed',
        steps: [this.step('create', 'failed', message), ...STEP_IDS.slice(1).map((id) => this.blocked(id))],
      };
    }

    return this.record(this.result(prepared, attemptedAt, outcome), actorUserId);
  }

  private result(
    prepared: PreparedStorageSubmission,
    attemptedAt: Date,
    outcome: StorageDriverProvisionResult,
  ): StorageBucketProvisionResult {
    const { location, redact } = prepared;
    const steps: StorageBucketStep[] = outcome.steps
      ? outcome.steps.map((step) => ({ ...step, detail: redact(step.detail), error: step.error === null ? null : redact(step.error) }))
      : // A driver that reports no steps: one `create` step, the rest not applicable.
        [
          this.step('create', 'passed', redact(outcome.message)),
          ...STEP_IDS.slice(1).map((id) => this.step(id, 'skipped', 'Not applicable to this driver.')),
        ];
    const guidance = outcome.guidance
      ? { reason: redact(outcome.guidance.reason), commands: redact(outcome.guidance.commands), runbook: outcome.guidance.runbook }
      : null;

    return {
      outcome: outcome.outcome ?? (outcome.created ? 'created' : 'already_exists'),
      provider: prepared.driver.id,
      bucket: location.bucket,
      region: location.region ?? '',
      effectiveEndpoint: location.endpoint ?? null,
      steps,
      guidance,
      corsOrigin: outcome.corsOrigin ?? null,
      message: redact(outcome.message),
      attemptedAt: attemptedAt.toISOString(),
    };
  }

  private step(
    id: StorageBucketStepId,
    status: StorageBucketStep['status'],
    detail: string,
    error?: string,
  ): StorageBucketStep {
    return { id, label: STORAGE_BUCKET_STEP_LABELS[id], status, detail, error: error ?? null };
  }

  private blocked(id: StorageBucketStepId): StorageBucketStep {
    return this.step(
      id,
      'skipped',
      'Not attempted: there is no bucket to apply it to yet.',
    );
  }

  /**
   * Audit the attempt and log it. The audit row carries the verdict only: the
   * provider, the bucket, the outcome and each step's status; never a detail
   * or an error string.
   */
  private async record(
    result: StorageBucketProvisionResult,
    actorUserId: string,
  ): Promise<StorageBucketProvisionResult> {
    await this.prisma.auditEvent.create({
      data: {
        actorUserId,
        action: 'storage_config:provision_bucket',
        targetType: 'system_settings',
        targetId: 'storage',
        meta: {
          provider: result.provider,
          bucket: result.bucket,
          region: result.region,
          outcome: result.outcome,
          corsOrigin: result.corsOrigin,
          steps: result.steps.map((step) => ({ id: step.id, status: step.status })),
        } as unknown as StorageInputJsonValue,
      },
    });

    this.logger.log(
      `Bucket provisioning by user ${actorUserId}: ${result.outcome} ` +
        `(provider=${result.provider} bucket=${result.bucket || '(none)'})`,
    );

    return result;
  }
}
