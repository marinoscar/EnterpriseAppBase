import { Injectable, Logger, Inject } from '@nestjs/common';
import { STORAGE_PROVIDER, StorageProvider } from '../providers';
import type { ObjectProcessor } from './object-processor.interface';
import { ObjectProcessorRegistry } from './object-processor.registry';
import { buildProcessedMetadata } from './processing-metadata';
import { PLATFORM_PRISMA } from '../../core/index';
import type { StorageObject, StoragePrisma } from '../data/storage-db';
import { storageForOrg } from '../data/storage-db';

/**
 * How one processing run ended, as written to the object's row.
 *
 * @stability experimental
 */
export type ObjectProcessingOutcome = 'ready' | 'failed';

// =============================================================================
// ObjectProcessingService — the processor registry and runner (issue #520)
// =============================================================================
//
// Until #520 this service was an `@OnEvent('storage.object.uploaded', { async:
// true })` listener that downloaded the object and ran every applicable
// processor inside the event dispatch: no worker slot, no timeout, no retry,
// no row in the admin Jobs page, and an object left `processing` forever if the
// process died half way. CLAUDE.md's "every long-running activity is a queue
// job" forbids exactly that shape.
//
// It is now two plain methods with two callers, and NOTHING here listens to an
// event:
//
//   * `appliesTo(object)` — asked synchronously by `ObjectsService` when an
//     upload completes. No applicable processor means the object is marked
//     `ready` right there (a bounded single-row write, so readiness stays
//     instant and works with `JOBS_WORKER_MODE=off`); otherwise the upload
//     enqueues a `storage.object.process` job.
//   * `run(object)` — called by `StorageObjectProcessHandler` on a worker slot.
//     The processing loop itself is unchanged from the listener it replaces.
//
// Processors stay in-process DI classes (`ObjectProcessorRegistry`), which is why the
// job type is server-only: a worker node cannot construct them.
// =============================================================================

/**
 * Decides whether an upload needs post-upload processing and runs the
 * registered processors for the `storage.object.process` job. Reads the
 * processors from {@link ObjectProcessorRegistry}.
 *
 * @internal
 *
 * @stability experimental
 */
@Injectable()
export class ObjectProcessingService {
  private readonly logger = new Logger(ObjectProcessingService.name);

  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: StoragePrisma,
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: StorageProvider,
    // #736: processors self-register here from their own `onModuleInit`
    // (the optional `OBJECT_PROCESSOR` injection is gone).
    private readonly registry: ObjectProcessorRegistry,
  ) {}

  /** The registered processors that want `object`, in priority order. */
  applicableProcessors(object: StorageObject): ObjectProcessor[] {
    return this.registry.list().filter((p) => p.canProcess(object));
  }

  /**
   * Whether any registered processor wants `object` — that is, whether an
   * upload of it needs a processing job at all.
   *
   * Synchronous and I/O-free: `canProcess` is a predicate over the row.
   */
  appliesTo(object: StorageObject): boolean {
    return this.applicableProcessors(object).length > 0;
  }

  /**
   * Runs every applicable processor against `object` and writes the outcome to
   * its row: `ready` with the merged processor metadata, or `failed` when any
   * processor reported failure or threw.
   *
   * A processor's failure is recorded, not thrown, exactly as before #520: one
   * processor must not stop the others, and the row says which one failed.
   * What DOES throw is anything outside the processors — reading or writing
   * the row — and the processing job lets that propagate so the queue retries.
   */
  async run(object: StorageObject): Promise<ObjectProcessingOutcome> {
    this.logger.log(`Processing object: ${object.id} (${object.name})`);

    const applicableProcessors = this.applicableProcessors(object);

    if (applicableProcessors.length === 0) {
      this.logger.debug(`No processors applicable for object ${object.id}`);
      await this.markReady(object.id, object.orgId, {});
      return 'ready';
    }

    this.logger.debug(
      `Running ${applicableProcessors.length} processors for object ${object.id}`,
    );

    const allMetadata: Record<string, unknown> = {};
    let hasError = false;

    for (const processor of applicableProcessors) {
      try {
        this.logger.debug(`Running processor: ${processor.name}`);

        const result = await processor.process(
          object,
          () => this.storageProvider.download(object.storageKey),
        );

        if (result.success && result.metadata) {
          allMetadata[processor.name] = result.metadata;
          this.logger.debug(`Processor ${processor.name} completed successfully`);
        } else if (!result.success) {
          this.logger.warn(
            `Processor ${processor.name} failed: ${result.error}`,
          );
          allMetadata[`${processor.name}_error`] = result.error;
          hasError = true;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(
          `Processor ${processor.name} threw exception: ${errorMessage}`,
        );
        allMetadata[`${processor.name}_error`] = errorMessage;
        hasError = true;
      }
    }

    if (hasError) {
      await this.markFailed(object.id, object.orgId, allMetadata);
      return 'failed';
    }

    await this.markReady(object.id, object.orgId, allMetadata);
    return 'ready';
  }

  /**
   * Fails an object whose processing job gave up — spent its attempt budget,
   * timed out, or was reaped after its executor died — so it never reads
   * `processing` forever.
   *
   * CONDITIONAL ON `processing`: a row a processor run already settled
   * (`ready` or `failed`) is left alone, and so is a row deleted in the
   * meantime. Resolves `true` when this call made the transition.
   *
   * ONE bounded row: a read for the metadata merge and a compare-and-swap
   * write. That is what lets it run from a `job.settled` listener.
   *
   * `orgId` is the object's organization (the job payload's `orgId`): the
   * object is invisible outside it (row-level security, issue #725).
   */
  async markAbandoned(objectId: string, reason: string, orgId: string): Promise<boolean> {
    const db = storageForOrg(this.prisma, orgId);
    const existing = await db.storageObject.findUnique({
      where: { id: objectId },
      select: { status: true, metadata: true },
    });

    if (!existing || existing.status !== 'processing') return false;

    const result = await db.storageObject.updateMany({
      where: { id: objectId, status: 'processing' },
      data: {
        status: 'failed',
        metadata: buildProcessedMetadata(existing.metadata, {}, {
          failed: true,
          error: reason,
        }),
      },
    });

    if (result.count > 0) {
      this.logger.warn(`Object ${objectId} marked as failed: ${reason}`);
      return true;
    }

    return false;
  }

  private async markReady(
    objectId: string,
    orgId: string,
    processingMetadata: Record<string, unknown>,
  ): Promise<void> {
    const db = storageForOrg(this.prisma, orgId);
    const existing = await db.storageObject.findUnique({
      where: { id: objectId },
      select: { metadata: true },
    });

    await db.storageObject.update({
      where: { id: objectId },
      data: {
        status: 'ready',
        metadata: buildProcessedMetadata(existing?.metadata, processingMetadata),
      },
    });

    this.logger.log(`Object ${objectId} marked as ready`);
  }

  private async markFailed(
    objectId: string,
    orgId: string,
    processingMetadata: Record<string, unknown>,
  ): Promise<void> {
    const db = storageForOrg(this.prisma, orgId);
    const existing = await db.storageObject.findUnique({
      where: { id: objectId },
      select: { metadata: true },
    });

    await db.storageObject.update({
      where: { id: objectId },
      data: {
        status: 'failed',
        metadata: buildProcessedMetadata(existing?.metadata, processingMetadata, {
          failed: true,
        }),
      },
    });

    this.logger.warn(`Object ${objectId} marked as failed`);
  }
}
