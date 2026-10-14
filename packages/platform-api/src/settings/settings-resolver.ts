// =============================================================================
// SettingsResolver: system, then org, then user (issue #733, PP-8.1)
// =============================================================================
//
// The ONE read every slice should use for "what is this setting, here?":
//
//   resolveSystem(key, { orgId })  the deployment-wide value of a system
//                                  namespace, with the organization's
//                                  overrides applied when the namespace
//                                  declares an `org` block and the
//                                  organization stored some
//   resolveUser(key, userId)       one user's value of a user namespace (or
//                                  a core field: `theme`, `profile`)
//
// Neither creates a row (a read path never writes), and both degrade a
// damaged stored value exactly as the services do: the system document field
// by field to the namespace defaults, an org override field by field (a field
// that no longer validates is ignored), a user namespace to absent.
//
// SINGLE-ORG MODE. With `orgLayer: 'auto'` (the default) the org layer applies
// wherever an organization has a row. A single-org deployment that never wrote
// one resolves exactly to `SystemSettingsService`'s output (pinned by the
// parity test of the slice's conformance suite).
//
// NO CACHE: one read per call, as before the move. A cache would have to be
// invalidated on every write across replicas (the event bus); add one only
// with a test that shows a regression.
// =============================================================================

import { Inject, Injectable } from '@nestjs/common';

import { PLATFORM_PRISMA } from '../core/index';
import type { SettingsPrisma } from './data/settings-db';
import { OrgSettingsService } from './org-settings/org-settings.service';
import { applyOrgLayer, asPlainObject } from './org-settings/org-layer';
import { systemSettingsNamespaceRegistry } from './registry/system-settings-namespace';
import { userSettingsNamespaceRegistry } from './registry/user-settings-namespace';
import { SystemSettingsService } from './system-settings/system-settings.service';
import { DEFAULT_USER_SETTINGS } from './user-settings/user-settings.service';

/**
 * Resolves a setting through the layers: system, then organization, then
 * user. Injected from `SettingsModule` (exported).
 *
 * @example
 * ```ts
 * const ai = await this.settings.resolveSystem<SystemAiValue>('ai', { orgId: principal.activeOrgId });
 * const tables = await this.settings.resolveUser<DataTablesValue>('dataTables', userId);
 * ```
 *
 * @extensionPoint token
 * @stability stable
 */
@Injectable()
export class SettingsResolver {
  constructor(
    private readonly systemSettings: SystemSettingsService,
    private readonly orgSettings: OrgSettingsService,
    @Inject(PLATFORM_PRISMA) private readonly prisma: SettingsPrisma,
  ) {}

  /**
   * The value of a system namespace, merged with the organization layer when
   * the namespace declares one and `scope.orgId` is set.
   *
   * @param key - a registered system namespace key.
   * @param scope - the organization, when the caller acts inside one.
   * @returns the effective value.
   * @throws Error when `key` is not a registered system namespace.
   */
  async resolveSystem<T>(key: string, scope: { orgId?: string } = {}): Promise<T> {
    const ns = systemSettingsNamespaceRegistry.require(key);
    const system = (await this.systemSettings.readNamespaceValue(key)) as T;
    if (!ns.org || !scope.orgId || !this.orgSettings.isEnabled()) return system;
    const orgFields = await this.orgSettings.getNamespace(scope.orgId, key);
    return applyOrgLayer(ns, system, orgFields).value;
  }

  /**
   * One user's value of a user namespace (or of a core field, `theme` or
   * `profile`). An absent namespace resolves to `undefined`, which means
   * "apply the built-in defaults", exactly as `GET /api/user-settings` omits
   * it; a stored value that no longer validates resolves to `undefined` too.
   * A missing row resolves the core fields to their defaults.
   *
   * @param key - a registered user namespace key, `theme` or `profile`.
   * @param userId - the user.
   * @returns the stored value, or `undefined`.
   * @throws Error when `key` is neither a core field nor a registered user namespace.
   */
  async resolveUser<T>(key: string, userId: string): Promise<T | undefined> {
    const isCore = key === 'theme' || key === 'profile';
    const ns = isCore ? undefined : userSettingsNamespaceRegistry.require(key);
    const row = await this.prisma.userSettings.findUnique<{ value: unknown }>({
      where: { userId },
      select: { value: true },
    });
    const stored = asPlainObject(row?.value)?.[key];
    if (isCore) {
      return (stored ?? (DEFAULT_USER_SETTINGS as unknown as Record<string, unknown>)[key]) as T;
    }
    if (stored === undefined) return undefined;
    const parsed = ns!.schema.safeParse(stored);
    return parsed.success ? (parsed.data as T) : undefined;
  }
}
