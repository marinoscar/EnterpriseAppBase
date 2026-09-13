import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Readable } from 'node:stream';

import { PrismaService } from '../../prisma/prisma.service';
import { STORAGE_PROVIDER } from '../../storage/providers/storage-provider.interface';
import type { StorageProvider } from '../../storage/providers/storage-provider.interface';
import {
  isAvatarObjectFor,
  isUuid,
  normalizeProfileSettings,
} from '../../common/profile-image/profile-image';

export interface OpenedAvatar {
  stream: Readable;
  mimeType: string;
  size: bigint;
}

/**
 * Resolves a public avatar request to stored bytes (#367).
 *
 * The URL is public (an `<img>` cannot send a bearer token), so the rule for
 * serving is deliberately narrow: the object must be the avatar that user has
 * CURRENTLY selected. A previously uploaded, replaced, or deselected picture
 * is not served, and every miss — malformed id, unknown user, wrong source,
 * wrong object, missing bytes — is the same 404 so the endpoint is not an
 * oracle for which users or objects exist.
 */
@Injectable()
export class AvatarService {
  private readonly logger = new Logger(AvatarService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: StorageProvider,
  ) {}

  async open(userId: string, objectId: string): Promise<OpenedAvatar> {
    if (!isUuid(userId) || !isUuid(objectId)) {
      throw this.notFound();
    }

    const settings = await this.prisma.userSettings.findUnique({
      where: { userId },
      select: { value: true },
    });
    const profile = normalizeProfileSettings(
      (settings?.value as { profile?: unknown } | null | undefined)?.profile,
    );
    if (profile.imageSource !== 'upload' || profile.imageObjectId !== objectId) {
      throw this.notFound();
    }

    const object = await this.prisma.storageObject.findUnique({
      where: { id: objectId },
    });
    if (!object || !isAvatarObjectFor(object, userId)) {
      throw this.notFound();
    }

    try {
      const stream = await this.storageProvider.download(object.storageKey);
      return { stream, mimeType: object.mimeType, size: object.size };
    } catch (error) {
      this.logger.warn(
        `Avatar bytes unavailable for object ${objectId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw this.notFound();
    }
  }

  private notFound(): NotFoundException {
    return new NotFoundException('Not found');
  }
}
