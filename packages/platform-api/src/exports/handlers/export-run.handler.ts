// =============================================================================
// `export.run`: one export, as a file in object storage (issue #744; EvoPath
// `health.export`, H7 #191)
// =============================================================================
//
// Enqueued by `ExportsService.create` with the subject (`user:<id>` or
// `organization:<id>`) and the request on the payload. The export id IS the
// job id: there is no export table. One attempt:
//
//   1. parse the payload and re-validate the request with the source's schema
//      (the subject is authoritative: it must equal the payload's);
//   2. collect the source's datasets: read-only, paged, lazy;
//   3. stream the writer's output to `exports/users/<userId>/<jobId>.<ext>` or
//      `exports/orgs/<orgId>/<jobId>.<ext>`, counting the bytes on the way
//      (the file is never buffered whole);
//   4. in ONE transaction (the file's organization scope): upsert the
//      `storage_objects` row (uploaded by the requester, `metadata.source:
//      'export'`, so the user-data reset deletes it with the user's files) and
//      write `payload.result` on the job;
//   5. after commit: audit `export:create` (source, format, row counts, size;
//      never a value, a file name or a URL), record the metrics, notify
//      `export.ready`.
//
// IDEMPOTENT. The key is derived from the job id, so a retry overwrites the
// same object and upserts the same row. A failure deletes whatever bytes were
// written (best effort) and rethrows for the queue; on the LAST attempt the
// requester is told it failed.
//
// SERVER-ONLY (no `nodeResultSchema` / `persistNodeResult`), deliberately: it
// reads several tables mid-computation, through the bypass client, and its
// input is a user's or an organization's whole record, which a worker node
// must never receive (CLAUDE.md queue rule 2).
//
// ⚠ Never log a value, a file name or a URL: ids, formats and counts only.
// =============================================================================

import { Transform } from 'node:stream';

import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { trace } from '@opentelemetry/api';

import { AUDIT_SINK, PLATFORM_PRISMA, type AuditSink } from '../../core/index';
import { JobHandlerRegistry, type Job, type JobHandler, type JobExecutionProfile } from '../../jobs/index';
import { MetricsHostService } from '../../otel-core/index';
import {
  STORAGE_PROVIDER,
  buildObjectKey,
  storageRunInOrg,
  type StoragePrisma,
  type StorageProvider,
} from '../../storage/index';
import { exportJobPayloadSchema, type ExportJobPayload, type ExportResult } from '../export-job';
import { exportSourceRegistry, exportWriterRegistry } from '../export.registries';
import type { ExportContext, ExportSource, ExportWriter } from '../export.types';
import {
  EXPORT_AUDIT_ACTION,
  EXPORT_AUDIT_TARGET,
  EXPORT_OBJECT_SOURCE,
  EXPORT_RUN_JOB_TYPE,
} from '../exports.constants';
import { EXPORT_DURATION_METRIC, EXPORT_SIZE_METRIC, EXPORTS_RUNS_METRIC, type ExportOutcome } from '../exports.metrics';
import { EXPORT_FAILED_EVENT, EXPORT_READY_EVENT } from '../exports.notifications';
import { EXPORTS_OPTIONS, type ResolvedExportsModuleOptions } from '../exports.options';
import { EXPORTS_NOTIFIER, EXPORTS_SYSTEM_DATA, type ExportsNotifier, type ExportsSystemData } from '../ports';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The server-only `export.run` job. See the file header.
 *
 * @stability experimental
 */
@Injectable()
export class ExportRunHandler implements JobHandler, OnModuleInit {
  private readonly logger = new Logger(ExportRunHandler.name);

  /** PERMANENT once jobs of this type exist. */
  readonly type = EXPORT_RUN_JOB_TYPE;

  /** Its name in the jobs console. */
  readonly label = 'Data export';

  /** `ExportsModule.forRoot({ jobProfile })`; default 15 minutes, 2 attempts. */
  readonly profile: JobExecutionProfile;

  /** Overridable clock, for tests. */
  now: () => Date = () => new Date();

  constructor(
    private readonly registry: JobHandlerRegistry,
    @Inject(EXPORTS_OPTIONS) private readonly options: ResolvedExportsModuleOptions,
    @Inject(PLATFORM_PRISMA) private readonly prisma: StoragePrisma,
    @Inject(EXPORTS_SYSTEM_DATA) private readonly system: ExportsSystemData,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(AUDIT_SINK) private readonly audit: AuditSink,
    @Optional() @Inject(EXPORTS_NOTIFIER) private readonly notifier?: ExportsNotifier,
    @Optional() private readonly metrics?: MetricsHostService,
  ) {
    this.profile = options.jobProfile;
  }

  /** Self-registration, plus one alias per legacy `run` type (`legacyJobTypes`). */
  onModuleInit(): void {
    this.registry.register(this);
    for (const legacy of this.options.legacyJobTypes) {
      if (legacy.handles !== 'run') continue;
      const alias: JobHandler = {
        type: legacy.type,
        label: legacy.label ?? this.label,
        profile: this.profile,
        process: (job) => this.process(legacy.toPayload ? { ...job, payload: legacy.toPayload(job.payload) as Job['payload'] } : job),
      };
      this.registry.register(alias);
    }
  }

  /**
   * Runs one attempt. See the file header.
   *
   * @param job - the claimed job.
   */
  async process(job: Job): Promise<void> {
    const startedAt = Date.now();
    const payload = this.parse(job);
    const span = trace.getActiveSpan();
    span?.setAttributes({ 'export.source': payload.source, 'export.format': payload.format });

    if (payload.result) {
      // An earlier attempt committed the file but the job did not settle.
      this.logger.log(`Export ${job.id} already produced; nothing to do`);
      return;
    }

    let result: ExportResult;
    let sourceLabel = payload.source;
    try {
      const source = exportSourceRegistry.get(payload.source);
      const writer = exportWriterRegistry.get(payload.format);
      if (!source) throw new Error(`Export ${job.id}: source "${payload.source}" is not registered`);
      if (!writer) throw new Error(`Export ${job.id}: format "${payload.format}" is not registered`);
      sourceLabel = source.label;
      result = await this.produce(job, payload, source, writer);
    } catch (error) {
      this.record(payload, 'failed', Date.now() - startedAt);
      this.logger.error(
        `Export ${job.id} (${payload.source}, ${payload.format}) failed on attempt ${job.attempts}: ` +
          (error instanceof Error ? error.message : String(error)),
      );
      if (job.attempts >= this.profile.maxAttempts) this.notify(EXPORT_FAILED_EVENT.key, payload, job.id, sourceLabel);
      throw error;
    }

    const durationMs = Date.now() - startedAt;
    span?.setAttribute('export.size_bytes', result.sizeBytes);
    this.record(payload, 'completed', durationMs, result.sizeBytes);
    await this.auditCreate(payload, job.id, result);
    this.notify(EXPORT_READY_EVENT.key, payload, job.id, sourceLabel);
    const rows = Object.values(result.rowCounts).reduce((sum, n) => sum + n, 0);
    this.logger.log(`Export ${job.id} (${payload.source}, ${payload.format}) ready: ${result.sizeBytes} byte(s), ${rows} row(s) in ${durationMs} ms`);
  }

  /** Steps 2 to 4. Returns the committed result. */
  private async produce(job: Job, payload: ExportJobPayload, source: ExportSource, writer: ExportWriter): Promise<ExportResult> {
    const now = this.now();
    const request = source.requestSchema.parse(payload.request ?? {});
    const ctx: ExportContext = {
      exportId: job.id,
      scope: payload.scope,
      subjectId: payload.subjectId,
      requestedById: payload.requestedById,
      db: this.system.asSystem('export'),
      datamodel: this.options.datamodel,
      pageSize: this.options.pageSize,
      now,
    };
    const fileName = source.fileName
      ? source.fileName(ctx, request, writer.extension)
      : `${this.options.appSlug()}-${source.id}-${now.toISOString().slice(0, 10)}.${writer.extension}`;
    const storageKey =
      payload.scope === 'user'
        ? buildObjectKey('exports-users', { userId: payload.subjectId }, `${job.id}.${writer.extension}`)
        : buildObjectKey('exports-orgs', { orgId: payload.subjectId }, `${job.id}.${writer.extension}`);

    let sizeBytes = 0;
    let rowCounts: Readonly<Record<string, number>>;
    let bucket: string;
    try {
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          sizeBytes += chunk.length;
          callback(null, chunk);
        },
      });
      const uploaded = this.storage.upload(storageKey, counter, { mimeType: writer.mimeType }).catch((error: unknown) => {
        // The provider gave up: stop the producer instead of letting it stall.
        counter.destroy(error instanceof Error ? error : new Error(String(error)));
        throw error;
      });
      // A source that throws before yielding, or a writer that rejects
      // without destroying its output, must still end the upload.
      const written = Promise.resolve()
        .then(() => writer.write(source.collect(ctx, request), counter, { source: source.id, exportedAt: now, appSlug: this.options.appSlug() }))
        .catch((error: unknown) => {
          if (!counter.destroyed) counter.destroy(error instanceof Error ? error : new Error(String(error)));
          throw error;
        });
      const [writeResult, uploadResult] = await Promise.all([written, uploaded]);
      rowCounts = writeResult.rowCounts;
      bucket = uploadResult.bucket;
    } catch (error) {
      await this.deleteQuietly(storageKey);
      throw error;
    }

    const expiresAt = new Date(now.getTime() + this.options.retentionDays * DAY_MS);
    const storageProvider = this.storage.kind;
    try {
      return await storageRunInOrg(this.prisma, payload.orgId, async (tx) => {
        const object = await tx.storageObject.upsert({
          where: { storageKey },
          create: {
            name: fileName,
            size: BigInt(sizeBytes),
            mimeType: writer.mimeType,
            storageKey,
            storageProvider,
            bucket,
            status: 'ready',
            uploadedById: payload.requestedById,
            orgId: payload.orgId,
            metadata: { source: EXPORT_OBJECT_SOURCE, exportId: job.id, exportSource: payload.source, format: payload.format },
          },
          update: { size: BigInt(sizeBytes), status: 'ready', bucket, storageProvider, name: fileName },
          select: { id: true },
        });
        const result: ExportResult = {
          storageObjectId: object.id as string,
          fileName,
          mimeType: writer.mimeType,
          sizeBytes,
          rowCounts: { ...rowCounts },
          completedAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
        };
        await tx.job.update({ where: { id: job.id }, data: { payload: { ...stripResult(job.payload), result } } });
        return result;
      });
    } catch (error) {
      await this.deleteQuietly(storageKey);
      throw error;
    }
  }

  private parse(job: Job): ExportJobPayload {
    const payload = exportJobPayloadSchema.parse(job.payload);
    if (job.subjectId !== payload.subjectId) {
      throw new Error(`Invalid ${EXPORT_RUN_JOB_TYPE} job ${job.id}: payload subject does not match the job's subject`);
    }
    return payload;
  }

  private async deleteQuietly(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (error) {
      this.logger.warn(`Could not delete a partial export object: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Best effort: the file is committed; an audit failure must not fail it. */
  private async auditCreate(payload: ExportJobPayload, exportId: string, result: ExportResult): Promise<void> {
    try {
      await this.audit.record({
        action: EXPORT_AUDIT_ACTION,
        actorUserId: payload.requestedById,
        targetType: EXPORT_AUDIT_TARGET,
        targetId: exportId,
        meta: {
          source: payload.source,
          format: payload.format,
          scope: payload.scope,
          sizeBytes: result.sizeBytes,
          datasets: Object.keys(result.rowCounts).length,
          rows: Object.values(result.rowCounts).reduce((sum, n) => sum + n, 0),
          rowCounts: JSON.stringify(result.rowCounts),
        },
      });
    } catch (error) {
      this.logger.error(`Could not audit ${EXPORT_AUDIT_ACTION} for export ${exportId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Detached and never rejects; outside any transaction (after the commit). */
  private notify(eventKey: string, payload: ExportJobPayload, exportId: string, sourceLabel: string): void {
    if (!this.notifier) return;
    const data = { exportId, source: payload.source, sourceLabel, format: payload.format };
    Promise.resolve()
      .then(() => this.notifier!.notify(eventKey, payload.requestedById, data))
      .catch((error: unknown) => {
        this.logger.warn(`Could not send ${eventKey} for export ${exportId}: ${error instanceof Error ? error.message : String(error)}`);
      });
  }

  private record(payload: ExportJobPayload, outcome: ExportOutcome, durationMs: number, sizeBytes?: number): void {
    const attributes = { source: payload.source, format: payload.format, outcome };
    this.metrics?.add(EXPORTS_RUNS_METRIC, 1, attributes);
    this.metrics?.record(EXPORT_DURATION_METRIC, durationMs / 1000, attributes);
    if (sizeBytes !== undefined) this.metrics?.record(EXPORT_SIZE_METRIC, sizeBytes, { source: payload.source, format: payload.format });
  }
}

/** The payload without an earlier `result` (a stale one never survives a rewrite). */
function stripResult(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const { result: _result, ...rest } = payload as Record<string, unknown>;
  return rest;
}
