import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';

import {
  BadRequestException,
  ConflictException,
  GoneException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ANDROID_RELEASE_REASONS,
  APK_FILE_FIELD,
  APK_MIME_TYPE,
  DOWNLOAD_LINK_TTL_SECONDS,
  DOWNLOAD_ROUTE_PREFIX,
  MAX_APK_BYTES,
  releaseUploadFieldsSchema,
  type AdminRelease,
  type DownloadLink,
  type PublicRelease,
  type ReleaseUploadFields,
} from '@marinoscar/platform-contract/android-app';

import { AUDIT_SINK, PLATFORM_PRISMA, type AuditSink } from '../../core/index';
import { STORAGE_PROVIDER, StorageConfigService, type StorageProvider } from '../../storage/index';
import { androidReleaseKey } from '../android-app.key-prefixes';
import { ANDROID_APP_OPTIONS, type ResolvedAndroidAppModuleOptions } from '../android-app.options';
import { AndroidAppService } from '../android-app.service';
import { isUniqueViolation, type AndroidAppPrisma, type AndroidAppReleaseRow } from '../data/android-app-db';
import { ApkInspector } from './apk-inspector';
import { downloadTokenKey, signDownloadToken, verifyDownloadToken } from './download-token';

// =============================================================================
// AndroidReleaseService (#746; merged from EvoPath #285 and MemoriaHub)
// =============================================================================
//
// UPLOAD streams the multipart file through `ApkInspector` straight into
// object storage, never buffered; the text fields are parsed strictly and,
// when they arrive before the file, checked BEFORE a byte is stored. A
// refused upload deletes whatever it stored.
//
// TRUST (the merged rule). Both apps auto-trusted a release's signing key on
// make-current. The platform keeps that for the first release (an empty
// trusted list bootstraps), and otherwise refuses a (package, signing key)
// pair the list does not hold with 409 RELEASE_UNTRUSTED_APP, unless the
// upload sends `trust=true` (the CLI's `--trust`). A new signing key is never
// trusted by accident; the uploader already holds system_settings:write.
//
// MAKE-CURRENT is one transaction: clear the old flag, set the new one. The
// raw-SQL partial unique index android_app_releases_one_current_uniq_idx
// arbitrates concurrent calls (the loser's P2002 maps to 409
// RELEASE_CURRENT_CONFLICT). There is no findFirst pre-check of the rule.
//
// DELETE removes the object, then the row (object-before-row, as the backup
// retention does): a failed object delete leaves a row to retry from, never
// an orphaned object nobody can find.
// =============================================================================

/** The audit actions of the release routes (both apps' strings). */
export const ANDROID_RELEASE_AUDIT = Object.freeze({
  UPLOADED: 'android_app.release.uploaded',
  MADE_CURRENT: 'android_app.release.made_current',
  DELETED: 'android_app.release.deleted',
} as const);

/** The raw-SQL partial unique index that keeps one current release. */
export const ONE_CURRENT_RELEASE_INDEX = 'android_app_releases_one_current_uniq_idx';

const REQUIRED_FIELDS = ['packageName', 'versionName', 'versionCode', 'signingSha256'] as const;

const UPLOADER = { uploadedBy: { select: { id: true, email: true, displayName: true } } } as const;

type ReleaseWithUploader = AndroidAppReleaseRow & {
  uploadedBy?: { id: string; email: string; displayName: string | null } | null;
};

/**
 * One part of a multipart body, as `@fastify/multipart`'s `parts()` yields it
 * (structural: the package does not depend on the plugin's types).
 *
 * @stability experimental
 */
export type ReleaseUploadPart =
  | {
      /** A text field. */
      type: 'field';
      /** The field name. */
      fieldname: string;
      /** The value. */
      value: unknown;
    }
  | {
      /** A file. */
      type: 'file';
      /** The field name. */
      fieldname: string;
      /** The bytes; `truncated` once the plugin's size limit fired. */
      file: Readable & { truncated?: boolean };
    };

/**
 * An opened download.
 *
 * @stability experimental
 */
export interface OpenedDownload {
  /** The APK bytes. */
  stream: Readable;
  /** Their length. */
  sizeBytes: number;
  /** `<apkStem>-<versionName>.apk`. */
  fileName: string;
}

interface UploadTarget {
  provider: string;
  bucket: string;
}

interface StoredApk {
  sizeBytes: number;
  fileSha256: string;
}

/**
 * What any signed-in user sees.
 *
 * @param release - the row.
 * @returns the public view (`sizeBytes` as a decimal string).
 *
 * @stability experimental
 */
export function toPublicRelease(release: AndroidAppReleaseRow): PublicRelease {
  return {
    id: release.id,
    packageName: release.packageName,
    versionName: release.versionName,
    versionCode: release.versionCode,
    fileSha256: release.fileSha256,
    sizeBytes: release.sizeBytes.toString(),
    notes: release.notes,
    createdAt: release.createdAt.toISOString(),
  };
}

/**
 * What an administrator sees.
 *
 * @param release - the row, with its uploader.
 * @returns the admin view.
 *
 * @stability experimental
 */
export function toAdminRelease(release: ReleaseWithUploader): AdminRelease {
  return {
    ...toPublicRelease(release),
    signingSha256: release.signingSha256,
    isCurrent: release.isCurrent,
    storageProvider: release.storageProvider,
    uploadedBy: release.uploadedBy
      ? { id: release.uploadedBy.id, email: release.uploadedBy.email, displayName: release.uploadedBy.displayName }
      : null,
  };
}

/**
 * Whether making `next` current would not raise the current release's
 * versionCode for the same package (Android refuses downgrades).
 *
 * @param current - the current release, or null.
 * @param next - the candidate.
 * @param force - override.
 * @returns the refusal reason, or null when allowed.
 *
 * @stability experimental
 */
export function versionRuleRefusal(
  current: { packageName: string; versionCode: number } | null,
  next: { packageName: string; versionCode: number },
  force: boolean,
): typeof ANDROID_RELEASE_REASONS.VERSION_NOT_NEWER | null {
  if (force || !current || current.packageName !== next.packageName) return null;
  return current.versionCode >= next.versionCode ? ANDROID_RELEASE_REASONS.VERSION_NOT_NEWER : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function invalidUpload(message: string, extra: Record<string, unknown> = {}): BadRequestException {
  return new BadRequestException({ message, details: { reason: ANDROID_RELEASE_REASONS.INVALID_UPLOAD, ...extra } });
}

function notFound(): NotFoundException {
  return new NotFoundException({ message: 'Android release not found', details: { reason: ANDROID_RELEASE_REASONS.NOT_FOUND } });
}

function versionExists(fields: { packageName: string; versionCode: number }): ConflictException {
  return new ConflictException({
    message: `${fields.packageName} versionCode ${fields.versionCode} has already been uploaded.`,
    details: { reason: ANDROID_RELEASE_REASONS.VERSION_EXISTS, packageName: fields.packageName, versionCode: fields.versionCode },
  });
}

function currentConflict(): ConflictException {
  return new ConflictException({
    message: 'Another release was made current at the same time. Reload and try again.',
    details: { reason: ANDROID_RELEASE_REASONS.CURRENT_CONFLICT },
  });
}

/**
 * Maps a multipart plugin error to the typed client error.
 *
 * @param error - what the parts iterator or a stream threw.
 * @returns the error to throw.
 *
 * @stability experimental
 */
export function toClientUploadError(error: unknown): unknown {
  if (error instanceof HttpException) return error;
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'FST_REQ_FILE_TOO_LARGE') {
    return new PayloadTooLargeException({
      message: `The APK exceeds the ${MAX_APK_BYTES / (1024 * 1024)} MB limit.`,
      details: { reason: ANDROID_RELEASE_REASONS.TOO_LARGE, maxBytes: MAX_APK_BYTES },
    });
  }
  if (typeof code === 'string' && code.startsWith('FST_')) {
    return invalidUpload(
      `Invalid multipart body. Send multipart/form-data with the APK in the "${APK_FILE_FIELD}" field and the release fields as text fields.`,
    );
  }
  return error;
}

/**
 * The APK releases: upload, list, make current, delete, latest, signed
 * download links.
 *
 * @stability experimental
 */
@Injectable()
export class AndroidReleaseService {
  private readonly logger = new Logger(AndroidReleaseService.name);

  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: AndroidAppPrisma,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly storageConfig: StorageConfigService,
    private readonly androidApp: AndroidAppService,
    @Inject(AUDIT_SINK) private readonly audit: AuditSink,
    @Inject(ANDROID_APP_OPTIONS) private readonly options: ResolvedAndroidAppModuleOptions,
  ) {}

  /**
   * Where an upload would go now.
   *
   * @returns the active provider and bucket.
   * @throws ServiceUnavailableException 503 `STORAGE_NOT_CONFIGURED` when storage is not usable.
   */
  async resolveUploadTarget(): Promise<UploadTarget> {
    let resolution: Awaited<ReturnType<StorageConfigService['resolve']>>;
    try {
      resolution = await this.storageConfig.resolve();
    } catch (error) {
      this.logger.warn(`Cannot resolve the storage configuration: ${errorMessage(error)}`);
      throw this.storageNotConfigured('The storage configuration could not be read.');
    }
    if (!resolution.configured) {
      throw this.storageNotConfigured(`The ${resolution.provider} configuration is missing ${resolution.missing.join(', ')}.`);
    }
    return { provider: resolution.config.provider, bucket: resolution.config.bucket };
  }

  /**
   * Stores one APK release from a multipart body.
   *
   * @param parts - the multipart parts, in order.
   * @param userId - the uploader.
   * @param target - where to write (resolved when omitted).
   * @returns the stored release.
   */
  async upload(parts: AsyncIterable<ReleaseUploadPart>, userId: string, target?: UploadTarget): Promise<AdminRelease> {
    const destination = target ?? (await this.resolveUploadTarget());
    const id = randomUUID();
    const storageKey = androidReleaseKey(id);
    const raw: Record<string, string> = {};
    let file: StoredApk | null = null;

    try {
      for await (const part of parts) {
        if (part.type === 'field') {
          if (part.fieldname in raw) throw invalidUpload(`The field "${part.fieldname}" was sent twice.`);
          raw[part.fieldname] = typeof part.value === 'string' ? part.value : String(part.value);
          continue;
        }
        if (part.fieldname !== APK_FILE_FIELD || file) {
          part.file.resume();
          throw invalidUpload(`Send exactly one file, in the "${APK_FILE_FIELD}" field.`);
        }
        try {
          // Fields sent before the file are checked before a byte is stored.
          if (REQUIRED_FIELDS.every((name) => name in raw)) await this.assertUploadAllowed(this.parseFields(raw));
        } catch (error) {
          part.file.resume();
          throw error;
        }
        file = await this.storeApk(storageKey, part.file);
      }
    } catch (error) {
      if (file) await this.deleteStoredBytes(storageKey);
      throw toClientUploadError(error);
    }
    if (!file) throw invalidUpload(`No APK: send the file in the "${APK_FILE_FIELD}" field.`);

    let fields: ReleaseUploadFields;
    let release: ReleaseWithUploader;
    try {
      fields = this.parseFields(raw);
      await this.assertUploadAllowed(fields);
      release = await this.createRelease(id, storageKey, destination, fields, file, userId);
    } catch (error) {
      await this.deleteStoredBytes(storageKey);
      throw error;
    }

    const trustedAppAdded = release.isCurrent || fields.trust ? await this.trust(release, userId) : false;
    await this.record(userId, ANDROID_RELEASE_AUDIT.UPLOADED, release.id, {
      packageName: release.packageName,
      versionName: release.versionName,
      versionCode: release.versionCode,
      sizeBytes: release.sizeBytes.toString(),
      fileSha256: release.fileSha256,
      storageProvider: release.storageProvider,
      isCurrent: release.isCurrent,
      forced: fields.force,
      trustedAppAdded,
    });
    this.logger.log(
      `Android release ${release.packageName} ${release.versionName} (${release.versionCode}) uploaded by user ${userId}: ` +
        `${release.id}${release.isCurrent ? ' [current]' : ''}`,
    );
    return toAdminRelease(release);
  }

  /**
   * Every release, newest first.
   *
   * @returns the admin views.
   */
  async list(): Promise<AdminRelease[]> {
    const releases = (await this.prisma.androidAppRelease.findMany({
      include: UPLOADER,
      orderBy: [{ createdAt: 'desc' }, { versionCode: 'desc' }],
    })) as ReleaseWithUploader[];
    return releases.map(toAdminRelease);
  }

  /**
   * Makes a release the one users are offered. Any release may be made
   * current, a lower versionCode included (a rollback). Idempotent.
   *
   * @param id - the release.
   * @param userId - the actor.
   * @returns the release, now current.
   * @throws NotFoundException; ConflictException `RELEASE_CURRENT_CONFLICT` when a concurrent call won.
   */
  async makeCurrent(id: string, userId: string): Promise<AdminRelease> {
    const existing = (await this.prisma.androidAppRelease.findUnique({ where: { id }, include: UPLOADER })) as ReleaseWithUploader | null;
    if (!existing) throw notFound();
    let release: ReleaseWithUploader = existing;
    let previousId: string | null = null;
    if (!existing.isCurrent) {
      try {
        release = await this.prisma.$transaction(async (tx) => {
          // Read for the audit trail only (which release stopped being
          // current); the one-current rule is the index's, not this read's.
          const previous = await tx.androidAppRelease.findFirst({ where: { isCurrent: true }, select: { id: true } });
          previousId = previous?.id ?? null;
          await tx.androidAppRelease.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
          return (await tx.androidAppRelease.update({ where: { id }, data: { isCurrent: true }, include: UPLOADER })) as ReleaseWithUploader;
        });
      } catch (error) {
        if (isUniqueViolation(error, ONE_CURRENT_RELEASE_INDEX)) throw currentConflict();
        if ((error as { code?: unknown } | null)?.code === 'P2025') throw notFound();
        throw error;
      }
    }
    const trustedAppAdded = await this.trust(release, userId);
    if (!existing.isCurrent) {
      await this.record(userId, ANDROID_RELEASE_AUDIT.MADE_CURRENT, release.id, {
        packageName: release.packageName,
        versionName: release.versionName,
        versionCode: release.versionCode,
        previousReleaseId: previousId,
        trustedAppAdded,
      });
    }
    return toAdminRelease(release);
  }

  /**
   * Deletes a release: the object, then the row. The current release cannot
   * be deleted.
   *
   * @param id - the release.
   * @param userId - the actor.
   * @throws NotFoundException; ConflictException `RELEASE_IS_CURRENT`; 503 when storage is not configured (nothing deleted).
   */
  async remove(id: string, userId: string): Promise<void> {
    const release = await this.prisma.androidAppRelease.findUnique({ where: { id } });
    if (!release) throw notFound();
    if (release.isCurrent) {
      throw new ConflictException({
        message: 'The current release cannot be deleted. Make another release current first.',
        details: { reason: ANDROID_RELEASE_REASONS.IS_CURRENT },
      });
    }
    await this.storage.delete(release.storageKey);
    await this.prisma.androidAppRelease.deleteMany({ where: { id, isCurrent: false } });
    await this.record(userId, ANDROID_RELEASE_AUDIT.DELETED, release.id, {
      packageName: release.packageName,
      versionName: release.versionName,
      versionCode: release.versionCode,
    });
  }

  /**
   * The current release row.
   *
   * @returns it, or null.
   */
  async current(): Promise<AndroidAppReleaseRow | null> {
    return this.prisma.androidAppRelease.findFirst({ where: { isCurrent: true } });
  }

  /**
   * The current release, for any signed-in user.
   *
   * @returns the public view.
   * @throws NotFoundException `NO_RELEASE` when none is published.
   */
  async latest(): Promise<PublicRelease> {
    const release = await this.current();
    if (!release) {
      throw new NotFoundException({
        message: 'No Android release has been published on this server.',
        details: { reason: ANDROID_RELEASE_REASONS.NO_RELEASE },
      });
    }
    return toPublicRelease(release);
  }

  /**
   * A ten-minute signed link to download a release, bound to the caller.
   *
   * @param id - the release.
   * @param userId - the caller.
   * @param now - the clock.
   * @returns the same-origin URL and its expiry. Never log the URL.
   */
  async createDownloadLink(id: string, userId: string, now: Date = new Date()): Promise<DownloadLink> {
    const release = await this.prisma.androidAppRelease.findUnique({ where: { id }, select: { id: true } });
    if (!release) throw notFound();
    const expiresAt = Math.floor(now.getTime() / 1000) + DOWNLOAD_LINK_TTL_SECONDS;
    const token = signDownloadToken(downloadTokenKey(), { releaseId: release.id, userId, expiresAt });
    return { url: `${DOWNLOAD_ROUTE_PREFIX}${token}`, expiresAt: new Date(expiresAt * 1000).toISOString() };
  }

  /**
   * Opens the APK a signed token names.
   *
   * @param token - the token from the URL.
   * @param now - the clock.
   * @returns the stream, its size and the file name.
   * @throws GoneException `DOWNLOAD_LINK_EXPIRED`; NotFoundException `DOWNLOAD_LINK_INVALID` (tampered, deleted release, deactivated user).
   */
  async openDownload(token: string, now: Date = new Date()): Promise<OpenedDownload> {
    const verdict = verifyDownloadToken(downloadTokenKey(), token, Math.floor(now.getTime() / 1000));
    if (!verdict.ok && verdict.reason === 'expired') {
      throw new GoneException({
        message: 'This download link has expired. Request a new one.',
        details: { reason: ANDROID_RELEASE_REASONS.LINK_EXPIRED },
      });
    }
    const invalid = new NotFoundException({ message: 'Download link not found.', details: { reason: ANDROID_RELEASE_REASONS.LINK_INVALID } });
    if (!verdict.ok) throw invalid;
    const [release, user] = await Promise.all([
      this.prisma.androidAppRelease.findUnique({ where: { id: verdict.claims.releaseId } }),
      this.prisma.user.findUnique({ where: { id: verdict.claims.userId }, select: { isActive: true } }) as Promise<{ isActive: boolean } | null>,
    ]);
    if (!release || !user?.isActive) throw invalid;
    const stream = await this.storage.download(release.storageKey);
    return { stream, sizeBytes: Number(release.sizeBytes), fileName: `${this.options.apkStem}-${release.versionName}.apk` };
  }

  private storageNotConfigured(cause: string): ServiceUnavailableException {
    return new ServiceUnavailableException({
      message: 'Object storage is not configured. Configure it at /admin/settings/storage before uploading an APK.',
      details: { reason: ANDROID_RELEASE_REASONS.STORAGE_NOT_CONFIGURED, cause },
    });
  }

  private parseFields(raw: Record<string, string>): ReleaseUploadFields {
    const parsed = releaseUploadFieldsSchema.safeParse(raw);
    if (!parsed.success) {
      throw invalidUpload('The release fields are invalid.', {
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
    }
    return parsed.data;
  }

  private async assertUploadAllowed(fields: ReleaseUploadFields): Promise<void> {
    const existing = await this.prisma.androidAppRelease.findUnique({
      where: { packageName_versionCode: { packageName: fields.packageName, versionCode: fields.versionCode } },
      select: { id: true },
    });
    if (existing) throw versionExists(fields);
    const trusted = await this.androidApp.getTrustedApps();
    if (trusted.length > 0 && !fields.trust && !this.androidApp.isTrusted(trusted, { packageName: fields.packageName, sha256: fields.signingSha256 })) {
      throw new ConflictException({
        message:
          `${fields.packageName} signed with ${fields.signingSha256} is not a trusted Android app. Trust it on the Android app ` +
          'page first, or upload with trust=true (appctl android publish --trust).',
        details: { reason: ANDROID_RELEASE_REASONS.UNTRUSTED_APP, packageName: fields.packageName, signingSha256: fields.signingSha256 },
      });
    }
    if (fields.makeCurrent) this.assertNewer(await this.current(), fields);
  }

  private assertNewer(current: AndroidAppReleaseRow | null, fields: ReleaseUploadFields): void {
    if (current && versionRuleRefusal(current, fields, fields.force)) {
      throw new ConflictException({
        message:
          `versionCode ${fields.versionCode} is not newer than the current ${current.packageName} release (${current.versionCode}); ` +
          'Android refuses downgrades. Bump versionCode, upload without making it current, or force it.',
        details: { reason: ANDROID_RELEASE_REASONS.VERSION_NOT_NEWER, currentReleaseId: current.id, currentVersionCode: current.versionCode },
      });
    }
  }

  private async storeApk(storageKey: string, source: Readable & { truncated?: boolean }): Promise<StoredApk> {
    const inspector = new ApkInspector(MAX_APK_BYTES);
    source.on('limit', () => inspector.rejectTooLarge());
    source.on('error', (error) => inspector.destroy(error));
    source.pipe(inspector);
    try {
      await this.storage.upload(storageKey, inspector, { mimeType: APK_MIME_TYPE, metadata: { purpose: 'android-release' } });
    } catch (error) {
      source.resume();
      await this.deleteStoredBytes(storageKey);
      throw inspector.failure ?? error;
    }
    if (inspector.failure || source.truncated) {
      await this.deleteStoredBytes(storageKey);
      throw inspector.failure ?? toClientUploadError({ code: 'FST_REQ_FILE_TOO_LARGE' });
    }
    return { sizeBytes: inspector.sizeBytes, fileSha256: inspector.digest() };
  }

  private async createRelease(
    id: string,
    storageKey: string,
    destination: UploadTarget,
    fields: ReleaseUploadFields,
    file: StoredApk,
    userId: string,
  ): Promise<ReleaseWithUploader> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (fields.makeCurrent) {
          this.assertNewer(await tx.androidAppRelease.findFirst({ where: { isCurrent: true } }), fields);
          await tx.androidAppRelease.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
        }
        return (await tx.androidAppRelease.create({
          data: {
            id,
            packageName: fields.packageName,
            versionName: fields.versionName,
            versionCode: fields.versionCode,
            signingSha256: fields.signingSha256,
            fileSha256: file.fileSha256,
            sizeBytes: BigInt(file.sizeBytes),
            storageKey,
            storageProvider: destination.provider,
            bucket: destination.bucket,
            notes: fields.notes,
            isCurrent: fields.makeCurrent,
            uploadedById: userId,
          },
          include: UPLOADER,
        })) as ReleaseWithUploader;
      });
    } catch (error) {
      if (isUniqueViolation(error, ONE_CURRENT_RELEASE_INDEX)) throw currentConflict();
      if (isUniqueViolation(error)) throw versionExists(fields);
      throw error;
    }
  }

  private async trust(release: AndroidAppReleaseRow, userId: string): Promise<boolean> {
    try {
      return await this.androidApp.ensureTrusted({ packageName: release.packageName, sha256: release.signingSha256 }, userId);
    } catch (error) {
      this.logger.warn(`Could not trust ${release.packageName} for release ${release.id}: ${errorMessage(error)}`);
      return false;
    }
  }

  private async deleteStoredBytes(storageKey: string): Promise<void> {
    try {
      await this.storage.delete(storageKey);
    } catch (error) {
      this.logger.warn(`Failed to delete stored APK bytes at ${storageKey}: ${errorMessage(error)}`);
    }
  }

  private async record(userId: string, action: string, releaseId: string, meta: Record<string, string | number | boolean | null>): Promise<void> {
    try {
      await this.audit.record({ action, actorUserId: userId, targetType: 'android_app_release', targetId: releaseId, meta });
    } catch (error) {
      this.logger.warn(`Could not record audit event ${action}: ${errorMessage(error)}`);
    }
  }
}
