import { Injectable, Logger, Inject } from '@nestjs/common';

import { PLATFORM_PRISMA } from '../../core/index';
import type { StorageInputJsonValue, StoragePrisma } from '../data/storage-db';
import type { StorageDriverTestResult } from '../drivers/storage-driver';
import { STORAGE_PROBE_KEY_PREFIX } from '../drivers/s3/s3-connection-test';
import type {
  StorageConnectionCheck,
  StorageConnectionTestResult,
  TestStorageConfigInput,
} from './dto/storage-connection-test.dto';
import { StorageSubmissionService, type PreparedStorageSubmission } from './storage-submission.service';

export { STORAGE_PROBE_KEY_PREFIX };

// =============================================================================
// StorageConnectionTestService — "does this configuration actually work?" (#375)
// =============================================================================
//
// THIS IS A DIAGNOSTIC, AND EVERY DECISION BELOW FOLLOWS FROM THAT. It is the
// storage counterpart of `EmailTestSendService`, deliberately built to the same
// contract, and that file's header is worth reading first: it returns a RESULT
// rather than throwing, because a refused request is a successful diagnosis and
// this app's error envelope would discard the one fact worth having.
//
// -----------------------------------------------------------------------------
// IT TESTS THE SUBMITTED BODY, NOT THE SAVED ROW
// -----------------------------------------------------------------------------
//
// An operator moving to a new bucket must be able to prove a configuration
// BEFORE committing the deployment to it. A test that could only exercise what
// had already been saved would mean the only way to try a new bucket is to break
// the running one first — and then discover, with uploads already failing, that
// the new key lacks `s3:PutObject`.
//
// Nothing here writes a settings row or a credential. The ONE thing it writes is
// a throwaway object in the target bucket, which it then deletes; that is not a
// side effect to be avoided, it is the only way to learn whether the credential
// has the permissions an upload needs.
//
// -----------------------------------------------------------------------------
// WHY `:write` AND NOT `:read`
// -----------------------------------------------------------------------------
//
// Because it is side-effecting: it puts an object into a bucket and asks a
// third-party endpoint to do work at the caller's request. `:read` is held by
// anyone who may LOOK at the configuration, and looking is not writing —
// the identical argument `EmailSettingsController` makes for its test send.
//
// -----------------------------------------------------------------------------
// ⚠ THE SECRET, AND WHERE IT IS ALLOWED TO GO
// -----------------------------------------------------------------------------
//
// The driver legitimately holds the plaintext secret (an S3 client cannot sign
// without it); THIS service resolves it only when the driver asks, and obeys
// `CredentialsService.getSecret`'s contract literally — read at the moment of
// use, held in a local, never stored on an instance field, never logged, and
// never returned. Every string that leaves here goes through `redact` first, at
// a single exit point, because most of these messages are authored by an SDK
// rather than by this repository (the S3 driver also scrubs its own).
// =============================================================================

/**
 * The connection test of a configuration, saved or not, run by the DRIVER it names (the built-ins report four checks: credentials, bucket, round trip, presigned URL); never throws on a bad answer.
 *
 * @stability experimental
 */
@Injectable()
export class StorageConnectionTestService {
  private readonly logger = new Logger(StorageConnectionTestService.name);

  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: StoragePrisma,
    private readonly submission: StorageSubmissionService,
  ) {}

  /**
   * Run the driver's connection test against `input` and report it.
   *
   * NEVER THROWS for a configuration or connectivity problem: every such
   * outcome is `success: false` with a `message` (and, for the S3 family, a
   * check with `status: 'failed'`). A driver that throws anyway is turned into
   * `success: false` with the secret redacted out of its message. It can still
   * reject for a genuine fault (the database being down while writing the audit
   * row), which is a 500 and correctly so, and for a body naming a driver nobody
   * registered or settings it refuses, which is a 400.
   */
  async test(
    input: TestStorageConfigInput,
    actorUserId: string,
  ): Promise<StorageConnectionTestResult> {
    const attemptedAt = new Date();
    const prepared = await this.submission.prepare(input as unknown as { provider: string } & Record<string, unknown>);

    let outcome: StorageDriverTestResult;

    try {
      outcome = await prepared.driver.testConnection(prepared.ctx);
    } catch (error) {
      // The contract says a driver never throws. A driver that does is a bug
      // worth a log line, and the administrator still gets an answer.
      outcome = {
        ok: false,
        message: `The ${prepared.driver.label} driver failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`,
      };
      this.logger.warn(`Storage driver "${prepared.driver.id}" threw from testConnection: ${prepared.redact(outcome.message)}`);
    }

    return this.assemble(prepared, outcome, attemptedAt, actorUserId);
  }

  private async assemble(
    prepared: PreparedStorageSubmission,
    outcome: StorageDriverTestResult,
    attemptedAt: Date,
    actorUserId: string,
  ): Promise<StorageConnectionTestResult> {
    const { redact, location } = prepared;
    const checks: StorageConnectionCheck[] = (outcome.checks ?? []).map((entry) => ({
      ...entry,
      detail: redact(entry.detail),
      error: entry.error === null ? null : redact(entry.error),
    }));
    const details = outcome.details
      ? Object.fromEntries(Object.entries(outcome.details).map(([key, value]) => [key, typeof value === 'string' ? redact(value) : value]))
      : undefined;
    const success = outcome.ok && checks.every((entry) => entry.status === 'passed');

    const region = typeof details?.region === 'string' ? details.region : (location.region ?? '');
    const endpoint = typeof details?.effectiveEndpoint === 'string' ? details.effectiveEndpoint : (location.endpoint ?? null);

    const result: StorageConnectionTestResult = {
      success,
      provider: prepared.driver.id,
      bucket: location.bucket,
      region,
      effectiveEndpoint: endpoint,
      usedStoredSecret: prepared.usedStoredSecret,
      checks,
      message: redact(outcome.message),
      ...(details ? { details } : {}),
      attemptedAt: attemptedAt.toISOString(),
    };

    await this.prisma.auditEvent.create({
      data: {
        actorUserId,
        action: 'storage_config:test',
        targetType: 'system_settings',
        targetId: 'storage',
        // The verdict only: never a detail, never a message that could echo a value.
        meta: {
          provider: result.provider,
          bucket: result.bucket,
          success,
          usedStoredSecret: result.usedStoredSecret,
          checks: checks.map((entry) => ({
            id: entry.id,
            status: entry.status,
            code: entry.code,
          })),
        } as unknown as StorageInputJsonValue,
      },
    });

    if (!success) {
      this.logger.warn(
        `Storage connection test failed for user ${actorUserId} ` +
          `(provider=${result.provider} bucket=${result.bucket || '(none)'}): ` +
          (checks.some((entry) => entry.status !== 'passed')
            ? checks
                .filter((entry) => entry.status !== 'passed')
                .map((entry) => `${entry.id}=${entry.code}`)
                .join(' ')
            : result.message),
      );
    }

    return result;
  }
}
