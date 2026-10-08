// =============================================================================
// The settings slice's SETTINGS_PROFILE_IMAGES port, bound to the reference
// app (#733)
// =============================================================================
//
// The profile picture lives in object storage, which the settings slice does
// not own (it moves with the storage slice, #736). Normalising a stored
// `profile` and checking that an `imageObjectId` names the caller's own
// uploaded avatar stay here, unchanged:
//
//   - `normalize` is `normalizeProfileSettings` (legacy shapes rewritten on read).
//   - `isUploadedAvatar` reads the user's OWN avatar row, which may belong to an
//     organization other than the active one (a picture outlives an org
//     switch): one lookup by id through the SYSTEM client, reason
//     `admin-aggregate`, re-checked against the owner by `isAvatarObjectFor`
//     (#725).
// =============================================================================

import { Injectable } from '@nestjs/common';
import type { NormalizedProfileSettings, SettingsProfileImages } from '@marinoscar/platform-api/settings';

import { isAvatarObjectFor, normalizeProfileSettings } from '../../common/profile-image/profile-image';
import { PrismaSystemService } from '../../prisma/prisma-system.service';

@Injectable()
export class AppSettingsProfileImages implements SettingsProfileImages {
  constructor(private readonly system: PrismaSystemService) {}

  normalize(stored: unknown): NormalizedProfileSettings {
    return normalizeProfileSettings(stored);
  }

  async isUploadedAvatar(userId: string, objectId: string): Promise<boolean> {
    const object = await this.system.asSystem('admin-aggregate').storageObject.findUnique({
      where: { id: objectId },
      select: {
        uploadedById: true,
        storageKey: true,
        status: true,
        mimeType: true,
        metadata: true,
      },
    });

    return isAvatarObjectFor(object, userId);
  }
}
