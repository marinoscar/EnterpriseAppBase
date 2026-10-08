// =============================================================================
// ExportsService: the sources, request, list, status and download of exports
// (issue #744; EvoPath `HealthExportService`, H7 #191)
// =============================================================================
//
// The export id is the `export.run` job id; there is no export table. The
// request lives on the job payload, the outcome on `payload.result` (written
// by the handler with the file's `storage_objects` row, in one transaction).
//
// AUTHORIZATION. Every route is `@Auth()`; the source names the permission,
// checked here against the caller's effective permissions (system grants plus
// the active organization's role). An `org` source exports the caller's
// active organization; another organization needs the source's
// `crossOrgPermission` (a system administrator).
//
// VISIBILITY. An export is visible to the user who asked for it, a user export
// also to its subject (the same user), and an organization export to anyone
// who may export that organization now (its admins, a system admin). Anything
// else is a 404, never a 403: an export id is not a disclosure oracle.
//
// DOWNLOAD. Only `GET /exports/:id` mints a URL, only while `ready`: a signed
// GET valid for `downloadUrlTtlSeconds` with `Content-Disposition: attachment`
// naming the file. The URL is never logged and never stored.
// =============================================================================

import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EXPORT_FILE_NAME_PATTERN,
  EXPORT_LIST_LIMIT,
  type CreateExport,
  type ExportListResponse,
  type ExportSourceDescriptor,
  type ExportSourcesResponse,
  type ExportView,
} from '@marinoscar/platform-contract/exports';

import { PLATFORM_PRISMA } from '../core/index';
import { JobsService, type JobsInputJsonValue } from '../jobs/index';
import { STORAGE_PROVIDER, type StorageProvider } from '../storage/index';
import { exportJobPayloadSchema, readExportResult, toExportView, type ExportJobPayload, type ExportJobRow } from './export-job';
import { exportSourceRegistry, writersFor } from './export.registries';
import type { ExportSource } from './export.types';
import { EXPORT_ORG_SUBJECT_TYPE, EXPORT_RUN_JOB_TYPE, EXPORT_USER_SUBJECT_TYPE } from './exports.constants';
import { EXPORTS_OPTIONS, type ResolvedExportsModuleOptions } from './exports.options';
import { EXPORTS_SYSTEM_DATA, type ExportsSystemData } from './ports';
import { requestFieldsOf } from './request-fields';

/**
 * Who is asking: the authenticated principal, as the routes pass it.
 *
 * @stability experimental
 */
export interface ExportPrincipal {
  /** The user id. */
  readonly id: string;
  /** Effective permissions (system grants plus the active organization's role). */
  readonly permissions: readonly string[];
  /** The active organization, when the credential has one. */
  readonly activeOrgId?: string | null;
}

/**
 * The 404 message: the same for "does not exist" and "not yours".
 *
 * @stability experimental
 */
export const EXPORT_NOT_FOUND = 'Export not found';

/**
 * The jobs table, as the service reads it.
 *
 * @stability experimental
 */
export interface ExportsJobsPrisma {
  /** `jobs`. */
  job: {
    count(args: unknown): Promise<number>;
    findMany(args: unknown): Promise<ExportJobRow[]>;
    findFirst(args: unknown): Promise<(ExportJobRow & { subjectType: string | null; subjectId: string | null }) | null>;
  };
}

const JOB_SELECT = { id: true, status: true, payload: true, createdAt: true, finishedAt: true } as const;

/**
 * The export routes' logic.
 *
 * @stability experimental
 */
@Injectable()
export class ExportsService {
  private readonly logger = new Logger(ExportsService.name);

  /** Overridable clock, for tests. */
  now: () => Date = () => new Date();

  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: ExportsJobsPrisma,
    private readonly jobs: JobsService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(EXPORTS_SYSTEM_DATA) private readonly system: ExportsSystemData,
    @Inject(EXPORTS_OPTIONS) private readonly options: ResolvedExportsModuleOptions,
  ) {}

  /**
   * The sources and formats the caller may use.
   *
   * @param principal - the caller.
   * @returns the sources, in registry order.
   */
  sources(principal: ExportPrincipal): ExportSourcesResponse {
    const items: ExportSourceDescriptor[] = [];
    for (const source of exportSourceRegistry.list()) {
      if (!this.mayUse(principal, source)) continue;
      const formats = writersFor(source).map((writer) => ({
        id: writer.id,
        label: writer.label,
        extension: writer.extension,
        mimeType: writer.mimeType,
      }));
      if (formats.length === 0) continue;
      items.push({
        id: source.id,
        scope: source.scope,
        label: source.label,
        ...(source.description ? { description: source.description } : {}),
        formats,
        fields: [...(source.fields ?? requestFieldsOf(source.requestSchema))],
        crossOrg: source.scope === 'org' && this.has(principal, source.crossOrgPermission),
      });
    }
    return { items };
  }

  /**
   * Queues an export.
   *
   * @param principal - the caller.
   * @param body - the parsed `POST /exports` body.
   * @returns the export, `pending`.
   * @throws BadRequestException for an unknown source or format, or a request the source refuses.
   * @throws ForbiddenException without the source's permission (or the cross-organization one).
   * @throws NotFoundException for an unknown organization.
   * @throws HttpException 429 over the in-flight cap.
   */
  async create(principal: ExportPrincipal, body: CreateExport): Promise<ExportView> {
    const source = exportSourceRegistry.get(body.source);
    if (!source) throw new BadRequestException(`Unknown export source "${body.source}"`);
    const writer = writersFor(source).find((candidate) => candidate.id === body.format);
    if (!writer) {
      throw new BadRequestException(
        `Export source "${source.id}" has no format "${body.format}"; formats: ${writersFor(source).map((w) => w.id).join(', ')}`,
      );
    }
    if (!this.mayUse(principal, source)) {
      throw new ForbiddenException(`Exporting "${source.id}" requires the ${source.permission} permission`);
    }

    const parsed = source.requestSchema.safeParse(body.request ?? {});
    if (!parsed.success) {
      throw new BadRequestException({
        message: `Invalid request for export source "${source.id}"`,
        errors: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
    }

    const activeOrgId = principal.activeOrgId ?? null;
    let subjectId: string;
    let orgId: string;
    if (source.scope === 'user') {
      if (!activeOrgId) throw new ForbiddenException('This credential has no active organization');
      subjectId = principal.id;
      orgId = activeOrgId;
    } else {
      const target = body.orgId ?? activeOrgId;
      if (!target) throw new ForbiddenException('This credential has no active organization');
      if (target !== activeOrgId) {
        if (!this.has(principal, source.crossOrgPermission)) {
          throw new ForbiddenException(`Exporting another organization requires the ${source.crossOrgPermission ?? 'cross-organization'} permission`);
        }
        const org = await this.system.asSystem('export').organization?.findUnique({ where: { id: target }, select: { id: true } });
        if (!org) throw new NotFoundException('Organization not found');
      } else if (!this.has(principal, source.permission) && !this.has(principal, source.crossOrgPermission)) {
        throw new ForbiddenException(`Exporting "${source.id}" requires the ${source.permission} permission`);
      }
      subjectId = target;
      orgId = target;
    }

    const subjectType = source.scope === 'user' ? EXPORT_USER_SUBJECT_TYPE : EXPORT_ORG_SUBJECT_TYPE;
    const inFlight = await this.prisma.job.count({
      where: { type: EXPORT_RUN_JOB_TYPE, subjectType, subjectId, status: { in: ['pending', 'running'] } },
    });
    if (inFlight >= this.options.maxInFlightPerSubject) {
      throw new HttpException(
        `There are already ${this.options.maxInFlightPerSubject} exports in progress for this ${source.scope === 'user' ? 'account' : 'organization'}; wait for one to finish`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const payload: ExportJobPayload = {
      source: source.id,
      format: writer.id,
      request: parsed.data,
      requestedById: principal.id,
      scope: source.scope,
      subjectId,
      orgId,
    };
    // Distinct requests are distinct work: two exports of different formats
    // must not collapse onto one job.
    const job = await this.jobs.enqueue({
      type: EXPORT_RUN_JOB_TYPE,
      reason: 'rerun',
      subjectType,
      subjectId,
      payload: payload as unknown as JobsInputJsonValue,
      skipDedup: true,
      orgId,
    });
    this.logger.log(`Export ${job.id} (${source.id}, ${writer.id}) queued`);
    return (await this.toViews([job as unknown as ExportJobRow]))[0]!;
  }

  /**
   * The caller's most recent exports, newest first, without download URLs.
   *
   * @param principal - the caller.
   * @returns at most `EXPORT_LIST_LIMIT`.
   */
  async list(principal: ExportPrincipal): Promise<ExportListResponse> {
    const jobs = await this.prisma.job.findMany({
      where: {
        type: EXPORT_RUN_JOB_TYPE,
        OR: [
          { subjectType: EXPORT_USER_SUBJECT_TYPE, subjectId: principal.id },
          { payload: { path: ['requestedById'], equals: principal.id } },
        ],
      },
      select: JOB_SELECT,
      orderBy: { createdAt: 'desc' },
      take: EXPORT_LIST_LIMIT,
    });
    return { items: await this.toViews(jobs) };
  }

  /**
   * One export, with a fresh download URL while it is ready.
   *
   * @param principal - the caller.
   * @param exportId - the export (job) id.
   * @returns the export.
   * @throws NotFoundException unless the caller may see it.
   */
  async get(principal: ExportPrincipal, exportId: string): Promise<ExportView> {
    const job = await this.prisma.job.findFirst({
      where: { id: exportId, type: EXPORT_RUN_JOB_TYPE },
      select: { ...JOB_SELECT, subjectType: true, subjectId: true },
    });
    const parsed = job ? exportJobPayloadSchema.safeParse(job.payload) : null;
    if (!job || !parsed?.success || !this.maySee(principal, parsed.data)) throw new NotFoundException(EXPORT_NOT_FOUND);

    const [view] = await this.toViews([job]);
    if (!view || view.status !== 'ready' || !view.fileName) return view ?? notFound();

    const result = readExportResult(job.payload)!;
    const object = await this.system
      .asSystem('export')
      .storageObject.findFirst({ where: { id: result.storageObjectId, status: 'ready' }, select: { storageKey: true } });
    if (!object) return { ...view, status: 'expired' };

    if (!EXPORT_FILE_NAME_PATTERN.test(view.fileName)) {
      // Never put an unchecked name in a header.
      throw new Error(`Export ${job.id} has an unexpected file name`);
    }
    const ttl = this.options.downloadUrlTtlSeconds;
    const url = await this.storage.getSignedDownloadUrl(object.storageKey as string, {
      expiresIn: ttl,
      responseContentDisposition: `attachment; filename="${view.fileName}"`,
    });
    return { ...view, download: { url, expiresAt: new Date(this.now().getTime() + ttl * 1000).toISOString() } };
  }

  /** The views of `jobs`; one query for the files the committed ones name. */
  private async toViews(jobs: readonly ExportJobRow[]): Promise<ExportView[]> {
    const ids = jobs.flatMap((job) => {
      const result = readExportResult(job.payload);
      return result ? [result.storageObjectId] : [];
    });
    const existing =
      ids.length === 0
        ? new Set<string>()
        : new Set(
            (
              (await this.system
                .asSystem('export')
                .storageObject.findMany({ where: { id: { in: ids }, status: 'ready' }, select: { id: true } })) as Array<{ id: string }>
            ).map((row) => row.id),
          );
    const now = this.now();
    return jobs.flatMap((job) => {
      const result = readExportResult(job.payload);
      const view = toExportView(job, result ? existing.has(result.storageObjectId) : false, now);
      return view ? [view] : [];
    });
  }

  private has(principal: ExportPrincipal, permission: string | undefined): boolean {
    return permission !== undefined && principal.permissions.includes(permission);
  }

  /** Whether the caller may use the source at all (for the active organization or, cross-org, any). */
  private mayUse(principal: ExportPrincipal, source: ExportSource): boolean {
    return this.has(principal, source.permission) || this.has(principal, source.crossOrgPermission);
  }

  /** See the file header, "Visibility". */
  private maySee(principal: ExportPrincipal, payload: ExportJobPayload): boolean {
    if (payload.requestedById === principal.id) return true;
    if (payload.scope === 'user') return payload.subjectId === principal.id;
    const source = exportSourceRegistry.get(payload.source);
    if (!source) return false;
    if (this.has(principal, source.crossOrgPermission)) return true;
    return payload.subjectId === principal.activeOrgId && this.has(principal, source.permission);
  }
}

function notFound(): never {
  throw new NotFoundException(EXPORT_NOT_FOUND);
}
