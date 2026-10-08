import { DynamicModule, Module } from '@nestjs/common';

import { StorageProvidersModule } from '../providers/storage-providers.module';
import { AvatarController } from './avatar.controller';
import { AvatarService } from './avatar.service';
import { createProfileImageController } from './profile-image.controller';
import { ProfileImageService } from './profile-image.service';

/**
 * Uploaded profile pictures (#367): `GET`/`POST`/`DELETE
 * /api/user-settings/profile-image` (`user_settings:read|write`) and the
 * public `GET /api/users/:userId/avatar/:objectId`.
 *
 * Separate from the settings slice because it needs the storage provider, and
 * the settings slice must stay below storage in the slice graph. The picture
 * is the `profile` field of the user settings document, which the settings
 * slice owns and validates through its `SETTINGS_PROFILE_IMAGES` port (the
 * reference app binds that port to the helpers exported here:
 * `normalizeProfileSettings`, `isAvatarObjectFor`).
 *
 * Needs, from the app: `SettingsModule.forRoot()` (global), the
 * `PLATFORM_PRISMA` and `STORAGE_SYSTEM_DATA` ports, and every user-settings
 * namespace registered before `forRoot()` runs (the upload response embeds
 * the composed user-settings schema).
 *
 * @stability experimental
 */
@Module({})
export class ProfileImageModule {
  /**
   * The module for one app. Builds the controller now, so call it after the
   * user-settings namespaces are registered.
   *
   * @returns the dynamic module. It exports `ProfileImageService` and `AvatarService`.
   *
   * @example
   * ```ts
   * import '../../settings/registry'; // the app's namespace manifests
   * export const ProfileImageModule = PlatformProfileImageModule.forRoot();
   * ```
   *
   * @extensionPoint option
   * @stability experimental
   */
  static forRoot(): DynamicModule {
    return {
      module: ProfileImageModule,
      imports: [StorageProvidersModule],
      controllers: [createProfileImageController(), AvatarController],
      providers: [ProfileImageService, AvatarService],
      exports: [ProfileImageService, AvatarService],
    };
  }
}
