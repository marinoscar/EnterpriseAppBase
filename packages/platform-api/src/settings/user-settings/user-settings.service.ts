import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { ThemePreference, UserProfileSettingsValue } from '@marinoscar/platform-contract/settings';

import { PLATFORM_PRISMA } from '../../core/index';
import { PrincipalCache } from '../../identity/index';
import type { SettingsPrisma, SettingsUserSettingsRow } from '../data/settings-db';
import { SETTINGS_PROFILE_IMAGES, type NormalizedProfileSettings, type SettingsProfileImages } from '../ports';
import {
  currentUserSettingsSchema,
  type ComposedPatchUserBody,
  type ComposedUpdateUserBody,
} from '../registry/compose';
import {
  userSettingsNamespaceRegistry,
  type UserSettingsNamespace,
  type UserSettingsNamespacesValue,
} from '../registry/user-settings-namespace';

/**
 * A user's stored settings document: the core fields `theme` and `profile`,
 * then every optional namespace the user stored something for.
 *
 * @stability stable
 */
export interface UserSettingsValue extends UserSettingsNamespacesValue {
  /** The theme preference. */
  theme: ThemePreference;
  /** The profile preferences (`imageSource`, `imageObjectId`, `displayName`). */
  profile: UserProfileSettingsValue;
}

/**
 * What `GET`, `PUT` and `PATCH /api/user-settings` return (inside the
 * `{ data }` envelope): the core fields, every namespace the user stored
 * something for (an absent one means "apply the built-in defaults"), and the
 * row version for `If-Match`.
 *
 * @stability stable
 */
export type UserSettingsResponse = UserSettingsNamespacesValue & {
  /** The theme preference. */
  theme: ThemePreference;
  /** The normalised profile (`imageObjectId` always present). */
  profile: NormalizedProfileSettings;
  /** When the row last changed. */
  updatedAt: Date;
  /** The row version. */
  version: number;
};

/**
 * The value a user's settings row starts with: the core fields only. The
 * optional namespaces are deliberately absent (absent means "use the built-in
 * defaults"; seeding one would freeze a user at today's defaults).
 *
 * @stability stable
 */
export const DEFAULT_USER_SETTINGS: UserSettingsValue = {
  theme: 'system',
  profile: {
    imageSource: 'provider',
    imageObjectId: null,
  },
};

/**
 * The registered optional user settings namespaces, as they are NOW (#677).
 * Read per call, not captured at load, so a namespace a test adds with
 * `withTemporaryEntries` is merged, capped, validated and returned like any
 * platform one. The registry is frozen at bootstrap in production.
 */
function namespaces(): readonly UserSettingsNamespace[] {
  return userSettingsNamespaceRegistry.list();
}

/**
 * A user's own settings (`user_settings`, one row per user): `GET`, `PUT` and
 * `PATCH /api/user-settings`. The optional namespaces come from the user
 * namespace registry; an absent namespace resolves to the client's built-in
 * defaults. Moved unchanged from the reference app by #733; the profile-image
 * reference check reaches the app's object storage through
 * `SETTINGS_PROFILE_IMAGES`.
 *
 * @stability stable
 */
@Injectable()
export class UserSettingsService {
  private readonly logger = new Logger(UserSettingsService.name);

  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: SettingsPrisma,
    // PP-1.12 (#683): `syncDisplayName` writes a column the cached principal carries.
    private readonly principalCache: PrincipalCache,
    // Validating the selected profile image reads the user's OWN avatar row
    // (object storage, the app's): the host port answers, through the app's
    // system client and re-checked against the owner (#725).
    @Inject(SETTINGS_PROFILE_IMAGES) private readonly profileImages: SettingsProfileImages,
  ) {}

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
  ): UserSettingsResponse {
    return {
      theme: value.theme,
      // Normalised on every read: rows written before #367 carry the legacy
      // `useProviderImage` flag instead of `imageSource`.
      profile: this.profileImages.normalize(value.profile),
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
  async getSettings(userId: string): Promise<UserSettingsResponse> {
    let settings = await this.prisma.userSettings.findUnique<SettingsUserSettingsRow>({
      where: { userId },
    });

    // Create default settings if not found
    if (!settings) {
      settings = await this.prisma.userSettings.create<SettingsUserSettingsRow>({
        data: {
          userId,
          value: DEFAULT_USER_SETTINGS as never,
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
  async replaceSettings(userId: string, dto: ComposedUpdateUserBody): Promise<UserSettingsResponse> {
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
    const previousProfile = this.profileImages.normalize(
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
        value: validated as never,
        version: { increment: 1 },
      },
      create: {
        userId,
        value: validated as never,
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
    dto: ComposedPatchUserBody,
    expectedVersion?: number,
  ): Promise<UserSettingsResponse> {
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
        value: validated as never,
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

  /** One registered namespace's own merge, by key (the per-namespace helpers below). */
  private mergeNamespace(key: string, current: unknown, patch: unknown): unknown {
    return userSettingsNamespaceRegistry.require(key).merge(current, patch);
  }

  /** One registered namespace's own cap check, by key. */
  private assertNamespaceLimit(key: string, value: unknown): void {
    userSettingsNamespaceRegistry.require(key).assertLimits?.(value);
  }

  private mergeDataTables(current: unknown, patch: unknown): unknown {
    return this.mergeNamespace('dataTables', current, patch);
  }

  private mergeNavigation(current: unknown, patch: unknown): unknown {
    return this.mergeNamespace('navigation', current, patch);
  }

  private mergeAi(current: unknown, patch: unknown): unknown {
    return this.mergeNamespace('ai', current, patch);
  }

  private mergeNotifications(current: unknown, patch: unknown): unknown {
    return this.mergeNamespace('notifications', current, patch);
  }

  private assertNotificationLimit(notifications: unknown): void {
    this.assertNamespaceLimit('notifications', notifications);
  }

  private assertDataTableLimit(dataTables: unknown): void {
    this.assertNamespaceLimit('dataTables', dataTables);
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

    if (!(await this.profileImages.isUploadedAvatar(userId, nextObjectId))) {
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
    // Principal cache (PP-1.12, #683): the cached row carries `displayName`.
    this.principalCache.invalidate({ userId });
  }

  /**
   * Update theme preference
   */
  async updateTheme(userId: string, theme: ThemePreference): Promise<UserSettingsResponse> {
    return this.patchSettings(userId, { theme });
  }
}
