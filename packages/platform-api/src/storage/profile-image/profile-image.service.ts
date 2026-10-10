import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import { STORAGE_PROVIDER } from '../providers/storage-provider.interface';
import type { StorageProvider } from '../providers/storage-provider.interface';
import { UserSettingsService } from '../../settings/index';
import {
  AVATAR_MAX_BYTES,
  AVATAR_PURPOSE,
  avatarKeyPrefix,
  detectImageType,
  resolveProfileImageUrl,
} from './profile-image';
import { PLATFORM_PRISMA } from '../../core/index';
import { STORAGE_SYSTEM_DATA, type StorageSystemData } from '../ports';
import type { StorageInputJsonValue, StoragePrisma } from '../data/storage-db';
import { storageForOrg } from '../data/storage-db';

type UserSettingsResponse = Awaited<
  ReturnType<UserSettingsService['getSettings']>
>;

/**
 * What an upload or a removal of the profile picture returns.
 *
 * @stability experimental
 */
export interface ProfileImageResult {
  /** The user's settings, after the change. */
  settings: UserSettingsResponse;
  /** The picture that now represents the user, or `null`. */
  profileImageUrl: string | null;
}

/**
 * Uploaded profile pictures (#367).
 *
 * WHY A DEDICATED SERVICE AND NOT A METHOD ON `ObjectsService`. The generic
 * storage path accepts any bytes under any client-declared MIME type and leaves
 * the row in `processing`; an avatar must be validated by content, stored under
 * a controlled key and be `ready` immediately. And `SettingsModule` cannot
 * import `StorageModule` (StorageModule, then JobsModule, then SettingsModule is a
 * cycle), so this lives in its own module that depends on both
 * `SettingsModule` and `StorageProvidersModule` — the same "provider module,
 * not StorageModule" choice `JobsModule` and `NodesModule` make.
 *
 * Request-scoped work bounded at 5 MB — not a queue job.
 *
 * @stability experimental
 */
@Injectable()
export class ProfileImageService {
  private readonly logger = new Logger(ProfileImageService.name);

  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: StoragePrisma,
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: StorageProvider,
    private readonly userSettings: UserSettingsService,
    // A profile picture is the USER's, and outlives an organization switch: the
    // row is created in the organization that is active at upload (scoped
    // client), but replacing or removing it later may happen with another
    // organization active, where the row is invisible. Removing the user's own
    // avatar therefore goes through the SYSTEM client, reason `purge`, behind
    // the same owner and key-prefix check as before (#725).
    @Inject(STORAGE_SYSTEM_DATA) private readonly system: StorageSystemData,
  ) {}

  /**
   * Store a validated avatar, select it, and delete the one it replaces.
   */
  async upload(userId: string, buffer: Buffer, orgId: string): Promise<ProfileImageResult> {
    // Defence in depth: the controller already enforces this via multipart
    // limits, but this method must be safe on its own.
    if (buffer.length > AVATAR_MAX_BYTES) {
      throw new PayloadTooLargeException(
        `Profile image exceeds the ${AVATAR_MAX_BYTES / (1024 * 1024)} MB limit`,
      );
    }

    const detected = detectImageType(buffer);
    if (!detected) {
      throw new BadRequestException(
        'Unsupported image type. Upload a JPEG, PNG, GIF or WebP image.',
      );
    }

    const before = await this.userSettings.getSettings(userId);
    const previousObjectId = before.profile.imageObjectId;

    const storageKey = `${avatarKeyPrefix(userId)}${randomUUID()}.${detected.extension}`;

    const uploaded = await this.storageProvider.upload(
      storageKey,
      Readable.from(buffer),
      {
        mimeType: detected.mimeType,
        contentLength: buffer.length,
        metadata: { purpose: AVATAR_PURPOSE },
      },
    );

    let objectId: string;
    try {
      const object = await storageForOrg(this.prisma, orgId, { userId }).storageObject.create({
        data: {
          orgId,
          name: `avatar.${detected.extension}`,
          size: BigInt(buffer.length),
          mimeType: detected.mimeType,
          storageKey,
          // The LIVE provider kind, not a literal — an avatar stored in R2 must
          // not be recorded as an S3 object. Read after the upload above, so
          // the pair on this row describes the configuration that just ran.
          storageProvider: this.storageProvider.kind,
          bucket: uploaded.bucket,
          status: 'ready',
          metadata: { purpose: AVATAR_PURPOSE } as StorageInputJsonValue,
          uploadedById: userId,
        },
      });
      objectId = object.id;
    } catch (error) {
      await this.deleteStoredBytes(storageKey);
      throw error;
    }

    let settings: UserSettingsResponse;
    try {
      settings = await this.userSettings.patchSettings(userId, {
        profile: { imageSource: 'upload', imageObjectId: objectId },
      });
    } catch (error) {
      await this.removeAvatarObject(userId, objectId, 'avatar_upload_failed');
      throw error;
    }

    await this.createAuditEvent(userId, 'user_settings:profile_image:upload', orgId, {
      objectId,
      size: buffer.length,
      mimeType: detected.mimeType,
      previousObjectId,
    });

    if (previousObjectId && previousObjectId !== objectId) {
      await this.removeAvatarObject(userId, previousObjectId, 'avatar_replaced');
    }

    this.logger.log(`Profile image uploaded for user ${userId}: ${objectId}`);

    return {
      settings,
      profileImageUrl: await this.resolveFor(userId, settings.profile),
    };
  }

  /**
   * Remove the uploaded avatar. `imageObjectId` becomes null and an `upload`
   * source falls back to `provider`. Idempotent: with no avatar stored it only
   * returns the current state.
   */
  async remove(userId: string): Promise<ProfileImageResult> {
    const before = await this.userSettings.getSettings(userId);
    const objectId = before.profile.imageObjectId;

    let settings: UserSettingsResponse = before;
    if (objectId || before.profile.imageSource === 'upload') {
      // Settings first, bytes second: a failure in between leaves an
      // unreferenced object, never a reference to a deleted one.
      settings = await this.userSettings.patchSettings(userId, {
        profile: {
          imageObjectId: null,
          ...(before.profile.imageSource === 'upload'
            ? { imageSource: 'provider' as const }
            : {}),
        },
      });
    }

    if (objectId) {
      const removedFrom = await this.removeAvatarObject(userId, objectId, 'avatar_removed');
      await this.createAuditEvent(userId, 'user_settings:profile_image:delete', removedFrom, {
        objectId,
      });
      this.logger.log(`Profile image removed for user ${userId}: ${objectId}`);
    }

    return {
      settings,
      profileImageUrl: await this.resolveFor(userId, settings.profile),
    };
  }

  private async resolveFor(
    userId: string,
    profile: UserSettingsResponse['profile'],
  ): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, providerProfileImageUrl: true },
    });
    return user ? resolveProfileImageUrl(user, profile) : null;
  }

  /**
   * Best-effort deletion of an avatar object (stored bytes, then row). Only
   * ever touches an object this user uploaded under their avatar prefix, so a
   * stale or tampered id can never delete anything else. Failures are logged,
   * never thrown: the user's request has already succeeded.
   *
   * If the bytes cannot be deleted the row is KEPT, so the object stays
   * visible (and deletable) through the storage API instead of becoming
   * invisible billable bytes.
   */
  private async removeAvatarObject(
    userId: string,
    objectId: string,
    reason: string,
  ): Promise<string | null> {
    try {
      const db = this.system.asSystem('purge');
      const object = await db.storageObject.findUnique({
        where: { id: objectId },
      });
      if (
        !object ||
        object.uploadedById !== userId ||
        !object.storageKey.startsWith(avatarKeyPrefix(userId))
      ) {
        return null;
      }

      if (!(await this.deleteStoredBytes(object.storageKey))) {
        return null;
      }

      await db.storageObject.delete({ where: { id: objectId } });

      await this.prisma.auditEvent.create({
        data: {
          actorUserId: userId,
          orgId: object.orgId,
          action: 'storage:object:delete',
          targetType: 'storage_object',
          targetId: objectId,
          meta: {
            name: object.name,
            size: object.size.toString(),
            mimeType: object.mimeType,
            reason,
          } as StorageInputJsonValue,
        },
      });

      return object.orgId;
    } catch (error) {
      this.logger.warn(
        `Failed to remove avatar object ${objectId} for user ${userId} (${reason}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private async deleteStoredBytes(storageKey: string): Promise<boolean> {
    try {
      await this.storageProvider.delete(storageKey);
      return true;
    } catch (error) {
      this.logger.warn(
        `Failed to delete stored avatar bytes at ${storageKey}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  private async createAuditEvent(
    userId: string,
    action: string,
    orgId: string | null,
    meta: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        orgId,
        action,
        targetType: 'user',
        targetId: userId,
        meta: meta as StorageInputJsonValue,
      },
    });
  }
}
