import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateUserSettingsDto } from '../dto/update-user-settings.dto';
import { PatchUserSettingsDto } from '../dto/update-user-settings.dto';
import {
  DEFAULT_USER_SETTINGS,
  UserSettingsValue,
} from '../../common/types/settings.types';
import type {
  DataTablesPatchValue,
  DataTablesValue,
  NavigationPatchValue,
  NavigationValue,
  NotificationsPatchValue,
  NotificationsValue,
} from '../../common/schemas/user-settings-namespaces.schema';
import type {
  UserAiSettingsPatchValue,
  UserAiSettingsValue,
} from '../../common/schemas/settings.schema';
import { currentUserSettingsSchema } from '../registry/compose';
import {
  userSettingsNamespaceRegistry,
  type UserSettingsNamespace,
  type UserSettingsNamespacesValue,
} from '../registry/user-settings-namespace';
import { AI_USER_SETTINGS } from '../../ai/ai.user-settings';
import { NOTIFICATIONS_USER_SETTINGS } from '../../notifications/notifications.user-settings';
import { DATA_TABLES_USER_SETTINGS, NAVIGATION_USER_SETTINGS } from './core.user-settings';
import {
  isAvatarObjectFor,
  normalizeProfileSettings,
  type NormalizedProfileSettings,
} from '../../common/profile-image/profile-image';

/**
 * The registered optional user settings namespaces, as they are NOW (#677).
 * Read per call, not captured at load, so a namespace a test adds with
 * `withTemporaryEntries` is merged, capped, validated and returned like any
 * platform one. The registry is frozen at bootstrap in production.
 */
function namespaces(): readonly UserSettingsNamespace[] {
  return userSettingsNamespaceRegistry.list();
}

@Injectable()
export class UserSettingsService {
  private readonly logger = new Logger(UserSettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Build the API response projection for a stored settings value.
   *
   * Optional namespaces are emitted ONLY when present — we never put
   * `dataTables: undefined` in the body, because an absent namespace is the
   * signal to the client that it should apply its own built-in defaults.
   */
  private toResponse(
    value: UserSettingsValue,
    updatedAt: Date,
    version: number,
  ) {
    return {
      theme: value.theme,
      // Normalised on every read: rows written before #367 carry the legacy
      // `useProviderImage` flag instead of `imageSource`.
      profile: normalizeProfileSettings(value.profile),
      // Every registered namespace, in registration order, and only when
      // present (#677).
      ...this.presentNamespaces(value),
      updatedAt,
      version,
    };
  }

  /**
   * The namespaces `value` actually holds, in registration order. A namespace
   * that is `undefined` is left out entirely, never emitted as a key.
   */
  private presentNamespaces(value: UserSettingsValue): UserSettingsNamespacesValue {
    const stored = value as unknown as Record<string, unknown>;
    const present: Record<string, unknown> = {};
    for (const ns of namespaces()) {
      if (stored[ns.key] !== undefined) present[ns.key] = stored[ns.key];
    }
    return present as UserSettingsNamespacesValue;
  }

  /**
   * Run every namespace's cap check (`assertLimits`) over a value about to be
   * stored. Caps are enforced here rather than in zod — see the
   * `assertLimits` of `core.user-settings.ts` for why.
   */
  private assertNamespaceLimits(value: UserSettingsValue): void {
    const stored = value as unknown as Record<string, unknown>;
    for (const ns of namespaces()) {
      ns.assertLimits?.(stored[ns.key]);
    }
  }

  /**
   * Get user settings for current user
   * Creates default settings if none exist
   */
  async getSettings(userId: string) {
    let settings = await this.prisma.userSettings.findUnique({
      where: { userId },
    });

    // Create default settings if not found
    if (!settings) {
      settings = await this.prisma.userSettings.create({
        data: {
          userId,
          value: DEFAULT_USER_SETTINGS as any,
        },
      });
      this.logger.log(`Created default settings for user: ${userId}`);
    }

    const value = settings.value as unknown as UserSettingsValue;

    return this.toResponse(value, settings.updatedAt, settings.version);
  }

  /**
   * Replace user settings (PUT)
   */
  async replaceSettings(userId: string, dto: UpdateUserSettingsDto) {
    // Validate against schema.
    //
    // WARNING: this line silently STRIPS any key the schema does not know
    // about. A namespace is known when it is registered in the user settings
    // namespace registry (#677): `userSettingsSchema` is composed from it, so
    // declaring the namespace once (`*.user-settings.ts`, listed in
    // `settings/registry/user-settings.manifest.ts`) is the whole change.
    const validated = currentUserSettingsSchema().parse(dto);

    // Caps enforced here rather than in zod — see each namespace's assertLimits.
    this.assertNamespaceLimits(validated);

    // Profile image (#367). An omitted `imageObjectId` keeps the stored one
    // rather than silently orphaning an uploaded avatar; `null` clears it.
    const stored = await this.prisma.userSettings.findUnique({
      where: { userId },
    });
    const previousProfile = normalizeProfileSettings(
      (stored?.value as unknown as UserSettingsValue | undefined)?.profile,
    );
    const nextProfile: NormalizedProfileSettings = {
      ...validated.profile,
      imageObjectId:
        validated.profile.imageObjectId !== undefined
          ? validated.profile.imageObjectId
          : previousProfile.imageObjectId,
    };
    await this.assertProfileImageReference(userId, previousProfile, nextProfile);
    validated.profile = nextProfile;

    const settings = await this.prisma.userSettings.upsert({
      where: { userId },
      update: {
        value: validated as any,
        version: { increment: 1 },
      },
      create: {
        userId,
        value: validated as any,
      },
    });

    // Sync display name to user table if provided
    if (validated.profile.displayName !== undefined) {
      await this.syncDisplayName(userId, validated.profile.displayName);
    }

    this.logger.log(`Settings replaced for user: ${userId}`);

    const value = settings.value as unknown as UserSettingsValue;

    return this.toResponse(value, settings.updatedAt, settings.version);
  }

  /**
   * Partial update user settings (PATCH)
   * Uses JSON Merge Patch semantics
   */
  async patchSettings(
    userId: string,
    dto: PatchUserSettingsDto,
    expectedVersion?: number,
  ) {
    // Get current settings
    const current = await this.getSettings(userId);

    // Optimistic concurrency check
    if (expectedVersion !== undefined && current.version !== expectedVersion) {
      throw new ConflictException(
        `Settings version mismatch. Expected ${expectedVersion}, found ${current.version}`,
      );
    }

    // Merge with existing settings
    const merged: UserSettingsValue = {
      theme: dto.theme ?? current.theme,
      profile: {
        displayName:
          dto.profile?.displayName !== undefined
            ? dto.profile.displayName
            : current.profile.displayName,
        imageSource:
          dto.profile?.imageSource !== undefined
            ? dto.profile.imageSource
            : current.profile.imageSource,
        // `!== undefined`, never `??`: an explicit `null` clears the reference.
        imageObjectId:
          dto.profile?.imageObjectId !== undefined
            ? dto.profile.imageObjectId
            : current.profile.imageObjectId,
      },
    };

    // `current.profile` is already normalised (getSettings -> toResponse).
    await this.assertProfileImageReference(
      userId,
      current.profile,
      merged.profile as NormalizedProfileSettings,
    );

    // Optional namespaces: only set the key when the merge produced something,
    // so an emptied namespace collapses back to absent instead of being stored
    // as `{}` (absent means "use built-in defaults", `{}` would not). Each
    // namespace's own `merge`, in registration order (#677).
    const currentNamespaces = current as unknown as Record<string, unknown>;
    const body = dto as unknown as Record<string, unknown>;
    const mergedNamespaces = merged as unknown as Record<string, unknown>;
    for (const ns of namespaces()) {
      const mergedNamespace = ns.merge(currentNamespaces[ns.key], body[ns.key]);
      if (mergedNamespace !== undefined) {
        mergedNamespaces[ns.key] = mergedNamespace;
      }
    }

    // Enforce the caps AFTER the merge — see each namespace's assertLimits.
    this.assertNamespaceLimits(merged);

    // Validate merged result.
    //
    // WARNING: as in replaceSettings, this call silently strips unknown keys.
    // A namespace that is not registered disappears right here and never
    // round-trips through GET. See the note in replaceSettings.
    const validated = currentUserSettingsSchema().parse(merged);

    const settings = await this.prisma.userSettings.update({
      where: { userId },
      data: {
        value: validated as any,
        version: { increment: 1 },
      },
    });

    // Sync display name to user table if changed
    if (dto.profile?.displayName !== undefined) {
      await this.syncDisplayName(userId, dto.profile.displayName);
    }

    this.logger.log(`Settings patched for user: ${userId}`);

    const value = settings.value as unknown as UserSettingsValue;

    return this.toResponse(value, settings.updatedAt, settings.version);
  }

  // ---------------------------------------------------------------------------
  // Per-namespace merges and caps (#677)
  // ---------------------------------------------------------------------------
  //
  // The bodies moved, verbatim, into the namespaces' declaration files
  // (`core.user-settings.ts`, `notifications/notifications.user-settings.ts`,
  // `ai/ai.user-settings.ts`), which carry their semantics and rationale. These
  // delegates keep the service's long-standing seams (its unit spec drives
  // them directly); the write paths above loop the registry instead.

  private mergeDataTables(
    current: DataTablesValue | undefined,
    patch: DataTablesPatchValue | null | undefined,
  ): DataTablesValue | undefined {
    return DATA_TABLES_USER_SETTINGS.merge(current, patch);
  }

  private mergeNavigation(
    current: NavigationValue | undefined,
    patch: NavigationPatchValue | null | undefined,
  ): NavigationValue | undefined {
    return NAVIGATION_USER_SETTINGS.merge(current, patch);
  }

  private mergeAi(
    current: UserAiSettingsValue | undefined,
    patch: UserAiSettingsPatchValue | null | undefined,
  ): UserAiSettingsValue | undefined {
    return AI_USER_SETTINGS.merge(current, patch);
  }

  private mergeNotifications(
    current: NotificationsValue | undefined,
    patch: NotificationsPatchValue | null | undefined,
  ): NotificationsValue | undefined {
    return NOTIFICATIONS_USER_SETTINGS.merge(current, patch);
  }

  private assertNotificationLimit(notifications: NotificationsValue | undefined): void {
    NOTIFICATIONS_USER_SETTINGS.assertLimits(notifications);
  }

  private assertDataTableLimit(dataTables: DataTablesValue | undefined): void {
    DATA_TABLES_USER_SETTINGS.assertLimits(dataTables);
  }

  /**
   * Validate the profile image reference a write would store (#367).
   *
   * - `imageSource: 'upload'` without an `imageObjectId` is always a 400.
   * - When the image fields CHANGE, the resulting `imageObjectId` must name an
   *   avatar the caller uploaded through `POST /api/user-settings/profile-image`
   *   (owned, `avatars/<userId>/` key, `purpose: 'avatar'`, `ready`, validated
   *   image type) whenever it is being newly set or `upload` is being selected.
   *   That is what stops a client pointing its public avatar URL at an
   *   arbitrary object — its own generic uploads included, whose MIME type is
   *   whatever the uploader claimed.
   * - When they are UNCHANGED the check is skipped, so an unrelated write
   *   (a theme toggle) never fails because a stored avatar object was since
   *   removed through the generic storage API.
   * - Switching to `none`/`provider` keeps the stored id without re-checking it.
   *
   * A BadRequestException, not a ZodError, so the client gets a 400.
   */
  private async assertProfileImageReference(
    userId: string,
    previous: NormalizedProfileSettings,
    next: NormalizedProfileSettings,
  ): Promise<void> {
    const nextObjectId = next.imageObjectId ?? null;

    if (next.imageSource === 'upload' && !nextObjectId) {
      throw new BadRequestException(
        'profile.imageSource "upload" requires profile.imageObjectId. Upload a picture with POST /api/user-settings/profile-image first.',
      );
    }

    const changed =
      previous.imageSource !== next.imageSource ||
      previous.imageObjectId !== nextObjectId;
    if (!changed || !nextObjectId) {
      return;
    }

    const needsCheck =
      nextObjectId !== previous.imageObjectId || next.imageSource === 'upload';
    if (!needsCheck) {
      return;
    }

    const object = await this.prisma.storageObject.findUnique({
      where: { id: nextObjectId },
      select: {
        uploadedById: true,
        storageKey: true,
        status: true,
        mimeType: true,
        metadata: true,
      },
    });

    if (!isAvatarObjectFor(object, userId)) {
      throw new BadRequestException(
        'profile.imageObjectId must reference a profile image you uploaded with POST /api/user-settings/profile-image.',
      );
    }
  }

  /**
   * Sync display name from settings to user table
   */
  private async syncDisplayName(
    userId: string,
    displayName: string | undefined,
  ) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { displayName: displayName || null },
    });
  }

  /**
   * Update theme preference
   */
  async updateTheme(userId: string, theme: 'light' | 'dark' | 'system') {
    return this.patchSettings(userId, { theme });
  }
}
