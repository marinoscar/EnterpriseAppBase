import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ANDROID_APP_SETTINGS_KEY,
  ASSET_LINKS_RELATION,
  MAX_TRUSTED_ANDROID_APPS,
  androidAppSettingsValueSchema,
  normalizeSha256Fingerprint,
  trustedAndroidAppSchema,
  trustedAppKey,
  type AndroidAppResponse,
  type AndroidAppSettingsValue,
  type AndroidPushSubscriptionCounts,
  type AssetLinkStatement,
  type ReportedAndroidApp,
  type TrustedAndroidApp,
  type UpdateAndroidAppInput,
} from '@marinoscar/platform-contract/android-app';

import { PLATFORM_PRISMA } from '../core/index';
import { SystemSettingsRowStore } from '../settings/index';
import type { AndroidAppPrisma } from './data/android-app-db';
import { androidDeviceSourceRegistry, mergeReportedApps, type AndroidDeviceSourceRow } from './device-sources';

// =============================================================================
// AndroidAppService (#746; merged from EvoPath #279 and MemoriaHub)
// =============================================================================
//
// The trusted Android apps: the `android_app` row of `system_settings`
// (through the settings slice's row store, which validates and audits every
// write), the Digital Asset Links statements built from it, the apps paired
// devices report (every registered device source, merged), and the Web Push
// subscription counts by platform (EvoPath).
// =============================================================================

/** The audit action of a trusted-apps write (both apps' string). */
export const ANDROID_APP_TRUSTED_APPS_UPDATED_ACTION = 'android_app.trusted_apps.updated';

const EMPTY: AndroidAppSettingsValue = { trustedApps: [] };

/**
 * Builds the statement list `/.well-known/assetlinks.json` serves: one
 * statement per package, listing every trusted fingerprint of it.
 *
 * @param apps - the trusted pairs.
 * @returns the statements, in first-seen package order.
 *
 * @stability experimental
 */
export function buildAssetLinks(apps: readonly TrustedAndroidApp[]): AssetLinkStatement[] {
  const byPackage = new Map<string, string[]>();
  for (const app of apps) {
    const fingerprints = byPackage.get(app.packageName) ?? [];
    const sha256 = normalizeSha256Fingerprint(app.sha256);
    if (!fingerprints.includes(sha256)) fingerprints.push(sha256);
    byPackage.set(app.packageName, fingerprints);
  }
  return [...byPackage.entries()].map(([packageName, fingerprints]) => ({
    relation: [ASSET_LINKS_RELATION],
    target: { namespace: 'android_app' as const, package_name: packageName, sha256_cert_fingerprints: fingerprints },
  }));
}

/**
 * The trusted apps, the assetlinks statements, the reported apps and the
 * push counts. Injected by the controllers, the release service and the
 * doctor checks.
 *
 * @stability experimental
 */
@Injectable()
export class AndroidAppService {
  private readonly logger = new Logger(AndroidAppService.name);

  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: AndroidAppPrisma,
    private readonly rows: SystemSettingsRowStore,
  ) {}

  /**
   * The trusted list. A stored value that does not validate reads as empty
   * (logged), so a hand-edited row never breaks the public assetlinks route.
   *
   * @returns the trusted pairs.
   */
  async getTrustedApps(): Promise<TrustedAndroidApp[]> {
    const snapshot = await this.rows.read(ANDROID_APP_SETTINGS_KEY, androidAppSettingsValueSchema, EMPTY);
    return snapshot.value.trustedApps;
  }

  /**
   * The Digital Asset Links statements for the current list.
   *
   * @returns the statements (`[]` when nothing is trusted).
   */
  async getAssetLinks(): Promise<AssetLinkStatement[]> {
    return buildAssetLinks(await this.getTrustedApps());
  }

  /**
   * What every registered device source reports, merged and marked trusted
   * or not. A failing source is logged and skipped: one broken native
   * capability never hides the others.
   *
   * @param trusted - the trusted list (read when omitted).
   * @returns the merged list, most devices first.
   */
  async getReportedApps(trusted?: readonly TrustedAndroidApp[]): Promise<ReportedAndroidApp[]> {
    const list = trusted ?? (await this.getTrustedApps());
    const rows: AndroidDeviceSourceRow[] = [];
    for (const source of androidDeviceSourceRegistry.list()) {
      try {
        rows.push(...(await source.reportedApps()));
      } catch (error) {
        this.logger.warn(`Android device source "${source.id}" failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return mergeReportedApps(rows, list);
  }

  /**
   * Web Push subscription counts by platform (EvoPath).
   *
   * @returns the counts.
   */
  async getPushSubscriptionCounts(): Promise<AndroidPushSubscriptionCounts> {
    const [byPlatform, androidUsers] = await Promise.all([
      this.prisma.pushSubscription.groupBy({ by: ['platform'], _count: { _all: true } }),
      this.prisma.pushSubscription.groupBy({ by: ['userId'], where: { platform: 'android_app' } }),
    ]);
    let androidApp = 0;
    let browser = 0;
    for (const row of byPlatform) {
      const count = (row._count as { _all?: number } | undefined)?._all ?? 0;
      if (row.platform === 'android_app') androidApp += count;
      else browser += count;
    }
    return { androidApp, browser, androidAppUsers: androidUsers.length };
  }

  /**
   * The admin view.
   *
   * @returns trusted, reported, the statements and the push counts.
   */
  async describe(): Promise<AndroidAppResponse> {
    const trustedApps = await this.getTrustedApps();
    const [reportedApps, pushSubscriptions] = await Promise.all([
      this.getReportedApps(trustedApps),
      this.getPushSubscriptionCounts(),
    ]);
    return { trustedApps, reportedApps, assetLinks: buildAssetLinks(trustedApps), pushSubscriptions };
  }

  /**
   * Replaces the list (already validated and normalised by the pipe).
   *
   * @param input - the new list.
   * @param userId - the actor.
   * @returns the saved state.
   */
  async replace(input: UpdateAndroidAppInput, userId: string): Promise<AndroidAppResponse> {
    const before = await this.getTrustedApps();
    await this.save(before, input.trustedApps, userId);
    return this.describe();
  }

  /**
   * Adds one pair when absent (making a release current trusts its signing
   * key, both apps' rule). Never throws: returns whether it was added, false
   * when already trusted, invalid, or the list is full (logged).
   *
   * @param app - the pair.
   * @param userId - the actor.
   * @returns whether the pair was added.
   */
  async ensureTrusted(app: { packageName: string; sha256: string }, userId: string): Promise<boolean> {
    try {
      const parsed = trustedAndroidAppSchema.safeParse(app);
      if (!parsed.success) {
        this.logger.warn(`Not trusting ${String(app?.packageName)}: not a valid (packageName, sha256) pair.`);
        return false;
      }
      const before = await this.getTrustedApps();
      if (this.isTrusted(before, parsed.data)) return false;
      if (before.length >= MAX_TRUSTED_ANDROID_APPS) {
        this.logger.warn(
          `Not trusting ${parsed.data.packageName}: the trusted apps list is full (${MAX_TRUSTED_ANDROID_APPS}). Remove an entry first.`,
        );
        return false;
      }
      await this.save(before, [...before, parsed.data], userId);
      return true;
    } catch (error) {
      this.logger.error(`Could not trust ${String(app?.packageName)}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Whether a pair is in the list.
   *
   * @param list - the trusted list.
   * @param app - the pair, any fingerprint form.
   * @returns true when trusted.
   */
  isTrusted(list: readonly TrustedAndroidApp[], app: { packageName: string; sha256: string }): boolean {
    const key = trustedAppKey(app.packageName, app.sha256);
    return list.some((entry) => trustedAppKey(entry.packageName, entry.sha256) === key);
  }

  private async save(before: readonly TrustedAndroidApp[], next: readonly TrustedAndroidApp[], userId: string): Promise<void> {
    const beforeKeys = new Set(before.map((app) => trustedAppKey(app.packageName, app.sha256)));
    const nextKeys = new Set(next.map((app) => trustedAppKey(app.packageName, app.sha256)));
    await this.rows.write(
      ANDROID_APP_SETTINGS_KEY,
      { trustedApps: [...next] },
      {
        actorId: userId,
        schema: androidAppSettingsValueSchema,
        auditAction: ANDROID_APP_TRUSTED_APPS_UPDATED_ACTION,
        auditMeta: {
          count: next.length,
          added: next.filter((app) => !beforeKeys.has(trustedAppKey(app.packageName, app.sha256))),
          removed: before.filter((app) => !nextKeys.has(trustedAppKey(app.packageName, app.sha256))),
        },
      },
    );
    this.logger.log(`Trusted Android apps saved by user ${userId} (${next.length} app(s))`);
  }
}
