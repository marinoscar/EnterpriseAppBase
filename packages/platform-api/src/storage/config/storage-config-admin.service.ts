import { ConflictException, Injectable, Logger, Inject } from '@nestjs/common';

import { CredentialsService } from '../../credentials/index';
import { SystemSettingsService } from '../../settings/index';
import type { SystemStorageValue } from '@marinoscar/platform-contract/storage';
import {
  describeStorageDrivers,
  getStorageDriver,
  missingStorageFields,
  storageDriverIds,
  storageLocationOf,
  storageSecretAddress,
  type StorageDriverDefinition,
} from '../drivers/storage-driver';
import { StorageConfigService } from './storage-config.service';
import type { StorageConfigResponse } from './dto/storage-config-response.dto';
import {
  STORAGE_SWITCH_CONFIRMATION,
  type UpdateStorageConfigInput,
} from './dto/update-storage-config.dto';
import { mergeStorageSettings } from './storage.system-settings';
import { submittedSecretValues, unknownDriverRejection } from './storage-settings-compat';
import { PLATFORM_PRISMA } from '../../core/index';
import { STORAGE_SYSTEM_DATA, type StorageSystemData } from '../ports';
import { StorageObjectStatus } from '../data/storage-db';
import type { StorageInputJsonValue, StoragePrisma } from '../data/storage-db';

// =============================================================================
// StorageConfigAdminService — read and write the storage configuration (#375)
// =============================================================================
//
// The two halves of a storage configuration, joined for an ADMINISTRATOR rather
// than for a client that is about to move bytes:
//
//     system_settings.global -> `storage` namespace   (provider + every driver's non-secret settings)
//   + the active driver's credentials                 (masked, never decrypted)
//   -> what `GET /api/admin/storage-config` renders
//
// `StorageConfigService` is the other consumer of the same two halves, and the
// split is deliberate: THAT service exists to hand a plaintext secret to an S3
// client on a hot path and caches accordingly; THIS one exists to render a form
// and must never see the secret at all. Nothing in this file calls
// `CredentialsService.getSecret`; it calls `describe`, which returns
// `CredentialInfo`, a type with no field capable of carrying secret material.
// `test/settings/email-settings.integration.spec.ts` asserts the equivalent
// property for SMTP and `storage-config.integration.spec.ts` asserts it here.
//
// -----------------------------------------------------------------------------
// WHY THE WRITE GOES THROUGH `SystemSettingsService.patchSettings`
// -----------------------------------------------------------------------------
//
// Because `storage` is a NAMESPACE INSIDE the single `global` settings row, not
// a row of its own like `email` or `webPush`. That row also carries
// `notifications`, `jobs`, `nodes`, `databaseBackup`, `maintenance` and any key
// a fork has added and this build does not know about — and #130's whole
// argument is that a write which does not carry those forward silently destroys
// them. `patchSettings` already implements the namespace-by-namespace merge, the
// unknown-key preservation, the degrade-a-damaged-row rule and the `If-Match`
// check. A second, hand-rolled upsert here would be a second chance to get every
// one of those wrong, on the row that configures the whole deployment.
//
// ⚠ THE CONSEQUENCE, STATED PLAINLY: `version` IS THE VERSION OF THE WHOLE
// `global` ROW. An `If-Match` sent by this page can therefore lose to somebody
// saving an unrelated system setting. That is honest rather than over-broad —
// they really did both write the same row, and the loser's remedy (reload, look
// at what is there now, save again) is the right one. The alternative, a version
// scoped to the `storage` key, does not exist in the data model and inventing one
// would mean two writers to one row believing they had independent tokens.
//
// -----------------------------------------------------------------------------
// WHY A CREDENTIAL ROTATION IS NOT A `$transaction` WITH THE SETTINGS WRITE
// -----------------------------------------------------------------------------
//
// It cannot be: the settings row and the credential row are written by two
// services through two code paths, and `CredentialsService` deliberately owns
// its own encryption and its own upsert. So there is an ordering to choose, and
// unlike push/SMTP — where an orphaned credential is inert — NEITHER ORDER IS
// SAFE here, because the access key id lives in the settings half and its secret
// in the credential half. A half-applied save leaves a key id from one pair
// beside a secret from another, whichever way round it is done.
//
// What is available instead is making the FAILURE THAT ACTUALLY HAPPENS happen
// first. The realistic failure is not a crashed process; it is an `If-Match`
// conflict, and that one is knowable before anything is written. So the version
// is checked HERE, up front, before the credential is touched — and then again
// inside `patchSettings`, against the same row. Without the first check a losing
// racer would already have rotated the deployment's secret out from under the
// winner by the time it learned it had lost.
// =============================================================================

/**
 * What the switch gate counts, and reports in its 409.
 *
 * @stability experimental
 */
export interface StorageLocationUsage {
  /** Rows in `storage_objects` that still name the old location. */
  storageObjects: number;
  /** Rows in `database_backup_runs` that still name the old location. */
  databaseBackupRuns: number;
  /** Convenience: `storageObjects + databaseBackupRuns`. */
  total: number;
}

/** Where objects live, for the switch gate: the driver id, its bucket and its endpoint. */
interface StorageLocation {
  provider: string;
  bucket: string;
  endpoint: string | null;
}

/**
 * The admin view and the save of the storage configuration (the masked secret status, never the secret), with the provider-switch gate's stranded-object count.
 *
 * @stability experimental
 */
@Injectable()
export class StorageConfigAdminService {
  private readonly logger = new Logger(StorageConfigAdminService.name);

  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: StoragePrisma,
    private readonly systemSettings: SystemSettingsService,
    // `describe` and `setSecret` ONLY. `getSecret` — the plaintext one — is
    // never called from this file. See the class header.
    private readonly credentials: CredentialsService,
    // For `invalidateCache()` after a write, and for nothing else. This service
    // does not resolve configurations; that is what the other one is for.
    private readonly storageConfig: StorageConfigService,
    // The usage count spans every organization (row-level security, #725), so
    // it reads `storage_objects` through the SYSTEM client, reason
    // `admin-aggregate`. Nothing else in this class uses it.
    @Inject(STORAGE_SYSTEM_DATA) private readonly system: StorageSystemData,
  ) {}

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  /**
   * Everything `GET /api/admin/storage-config` renders.
   *
   * DOES NOT THROW ON A DAMAGED ROW, matching
   * `PushConfigService.describeForAdmin` and for the same reason: this is the repair path, and a
   * 500 here would take down the one screen capable of fixing the row.
   * `getStoragePolicy` already degrades field by field to the drivers'
   * defaults — the unconfigured state — so a corrupt `region` still renders the
   * bucket an operator typed.
   */
  async describeForAdmin(): Promise<StorageConfigResponse> {
    const [policy, row] = await Promise.all([
      // `fresh` is irrelevant here — `getStoragePolicy` is the uncached
      // accessor — but the row read below is what carries `version`, and the
      // two must describe the same write. See `readRow`.
      this.systemSettings.getStoragePolicy(),
      this.readRow(),
    ]);

    // One masked status per declared secret of every registered driver: the
    // descriptors say whether each is stored, the response says it for the
    // active driver's primary secret with its hint and provenance.
    const infos = await this.describeSecrets(storageDriverIds());

    return this.toResponse(policy, row, infos);
  }

  // ---------------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------------

  /**
   * `PUT /api/admin/storage-config` — the active driver, its settings and an
   * optional secret rotation.
   *
   * Order of operations, and every step is load-bearing:
   *
   *   1. Read the current row. One read, used for the version check, the switch
   *      gate and nothing else — so the version that is checked and the location
   *      that is compared can never come from two different reads.
   *   2. `If-Match`. Refuse BEFORE anything is written. See the class header for
   *      why this check exists here as well as inside `patchSettings`.
   *   3. The switch gate. A `409` naming the row counts, unless the body carries
   *      the typed confirmation.
   *   4. The credential(s), if the body carried any. Blank preserves.
   *   5. The settings namespace, through `patchSettings`.
   *   6. ⚠ `invalidateCache()`, SYNCHRONOUSLY, before the audit write.
   *   7. The audit row.
   *
   * Step 6's placement is the same rule `MaintenanceModeService.setMaintenance`
   * follows, for the same reason: between the settings write committing and that
   * call, this instance would still answer storage questions from a value it
   * read up to five seconds ago, and an administrator who saved a corrected
   * bucket and immediately retried an upload would watch it fail against the old
   * one. Anything that awaits in between widens that window for no benefit.
   *
   * @throws BadRequestException (400) for an unregistered driver, settings the driver refuses, or a flat alias contradicting `drivers`.
   * @throws ConflictException (409) for a stale `If-Match`, or a relocation that strands objects without the `SWITCH` confirmation.
   */
  async replace(
    input: UpdateStorageConfigInput,
    userId: string,
    expectedVersion?: number,
  ): Promise<StorageConfigResponse> {
    const row = await this.readRow();
    const current = await this.systemSettings.getStoragePolicy();
    const currentVersion = row?.version ?? 0;

    if (expectedVersion !== undefined && currentVersion !== expectedVersion) {
      throw new ConflictException(
        `Storage settings version mismatch. Expected ${expectedVersion}, found ${currentVersion}`,
      );
    }

    const driver = this.requireDriver(input.provider);

    // The same merge a PATCH of the namespace performs: it validates the driver
    // id and every named driver's settings (400), folds the legacy flat aliases
    // into the driver they belong to and refuses a contradiction.
    const patch = {
      provider: input.provider,
      ...(input.drivers === undefined ? {} : { drivers: input.drivers }),
      ...(input.bucket === undefined ? {} : { bucket: input.bucket }),
      ...(input.region === undefined ? {} : { region: input.region }),
      ...(input.endpoint === undefined ? {} : { endpoint: input.endpoint }),
      ...(input.accountId === undefined ? {} : { accountId: input.accountId }),
      ...(input.accessKeyId === undefined ? {} : { accessKeyId: input.accessKeyId }),
      ...(input.forcePathStyle === undefined ? {} : { forcePathStyle: input.forcePathStyle }),
    };
    const next = mergeStorageSettings(current, patch);

    await this.assertSwitchAcknowledged(current, next, input.confirmation);

    // Blank preserves: only a typed, non-empty secret is written.
    const typed = submittedSecretValues(driver.id, input as unknown as Record<string, unknown>);
    const rotated = Object.keys(typed);

    for (const name of rotated) {
      const address = storageSecretAddress(driver, name);
      const spec = (driver.secrets ?? []).find((candidate) => candidate.name === name);

      await this.credentials.setSecret(address.purpose, address.name, typed[name], {
        label: address.label ?? spec?.label ?? `${driver.label} ${name}`,
        updatedByUserId: userId,
      });
    }

    await this.systemSettings.patchSettings(
      { storage: patch },
      userId,
      expectedVersion,
    );

    // SYNCHRONOUS, and BEFORE the audit write. See step 6 above.
    this.storageConfig.invalidateCache();

    await this.audit(userId, 'storage_config:replace', {
      settings: this.auditableSettings(next),
      secretRotated: rotated.length > 0,
      ...(rotated.length > 0 ? { secretsRotated: rotated } : {}),
      switchConfirmed: input.confirmation === STORAGE_SWITCH_CONFIRMATION,
    });

    const location = this.locationOf(next);

    this.logger.log(
      `Storage configuration replaced by user ${userId} ` +
        `(provider=${next.provider} bucket=${location.bucket || '(none)'} ` +
        `secretRotated=${rotated.length > 0})`,
    );

    return this.describeForAdmin();
  }

  // ---------------------------------------------------------------------------
  // The switch gate
  // ---------------------------------------------------------------------------

  /**
   * Refuses (409) a save that would repoint a deployment still holding objects.
   *
   * Compares the LOCATION the stored settings point at with the one the new
   * settings will: the driver, its bucket (container, directory) and its
   * endpoint. Changing a field that does not move the bytes (a region
   * correction, a rotated key) is not a relocation. A deployment that never had
   * a bucket has nothing to strand and sails through.
   *
   * ⚠ IT ACKNOWLEDGES, IT DOES NOT MIGRATE. See `STORAGE_SWITCH_CONFIRMATION`.
   */
  private async assertSwitchAcknowledged(
    current: SystemStorageValue,
    next: SystemStorageValue,
    confirmation: string | undefined,
  ): Promise<void> {
    if (confirmation === STORAGE_SWITCH_CONFIRMATION) return;

    const from = this.locationOf(current);
    if (!from.bucket) return;

    const to = this.locationOf(next);
    const relocated = from.provider !== to.provider || from.bucket !== to.bucket || from.endpoint !== to.endpoint;

    if (!relocated) return;

    const usage = await this.countLocationUsage(current);

    if (usage.total === 0) return;

    throw new ConflictException({
      code: 'STORAGE_LOCATION_IN_USE',
      message:
        `${usage.storageObjects} stored object(s) and ${usage.databaseBackupRuns} database ` +
        `backup(s) still point at ${describeLocation(from)}. Changing the provider, ` +
        `bucket or endpoint does NOT copy them — they will remain where they are and this ` +
        `deployment will no longer be able to read them. Re-send with ` +
        `{"confirmation":"${STORAGE_SWITCH_CONFIRMATION}"} to save anyway.`,
      details: {
        confirmation: STORAGE_SWITCH_CONFIRMATION,
        from: { provider: from.provider, bucket: from.bucket, endpoint: from.endpoint },
        to: { provider: to.provider, bucket: to.bucket, endpoint: to.endpoint },
        storageObjects: usage.storageObjects,
        databaseBackupRuns: usage.databaseBackupRuns,
      },
    });
  }

  /**
   * How many rows still point at `location`.
   *
   * `storage_objects` rows with no recorded bucket (`null`) count: they predate
   * the column and can only have been written to the then-only location. Failed
   * uploads do not: nothing was stored. Backups count only while they are real
   * (`pending`, `running`, `completed`).
   */
  async countLocationUsage(location: SystemStorageValue): Promise<StorageLocationUsage> {
    const where = this.locationOf(location);

    const [storageObjects, databaseBackupRuns] = await Promise.all([
      this.system.asSystem('admin-aggregate').storageObject.count({
        where: {
          storageProvider: where.provider,
          OR: [{ bucket: where.bucket }, { bucket: null }],
          status: { not: StorageObjectStatus.failed },
        },
      }),
      this.prisma.databaseBackupRun.count({
        where: {
          storageProvider: where.provider,
          bucket: where.bucket,
          status: { in: ['pending', 'running', 'completed'] },
        },
      }),
    ]);

    return {
      storageObjects,
      databaseBackupRuns,
      total: storageObjects + databaseBackupRuns,
    };
  }

  // ---------------------------------------------------------------------------
  // Plumbing
  // ---------------------------------------------------------------------------

  /** The driver, or a 400 naming the registered ids. */
  private requireDriver(id: string): StorageDriverDefinition<any> {
    const driver = getStorageDriver(id);

    return driver ?? unknownDriverRejection(id);
  }

  /** Where the settings point: the driver, its bucket and its endpoint (`null` for the SDK's own host). */
  private locationOf(policy: SystemStorageValue): StorageLocation {
    const driver = getStorageDriver(policy.provider);

    if (!driver) return { provider: policy.provider, bucket: '', endpoint: null };

    const location = storageLocationOf(driver, policy.drivers[policy.provider] ?? {});

    return { provider: policy.provider, bucket: location.bucket, endpoint: location.endpoint ?? null };
  }

  /**
   * The masked status of every declared secret of the given drivers.
   *
   * `describe` only: it returns `CredentialInfo`, a type with no field capable
   * of carrying secret material. The plaintext is never read here.
   */
  private async describeSecrets(
    ids: readonly string[],
  ): Promise<Map<string, Map<string, { hint: string | null; updatedAt: Date; updatedByUserId: string | null }>>> {
    const result = new Map<string, Map<string, { hint: string | null; updatedAt: Date; updatedByUserId: string | null }>>();

    await Promise.all(
      ids.map(async (id) => {
        const driver = getStorageDriver(id);
        const byName = new Map<string, { hint: string | null; updatedAt: Date; updatedByUserId: string | null }>();

        for (const spec of driver?.secrets ?? []) {
          const address = storageSecretAddress(driver as StorageDriverDefinition<any>, spec.name);
          const info = await this.credentials.describe(address.purpose, address.name);
          if (info) byName.set(spec.name, info);
        }

        result.set(id, byName);
      }),
    );

    return result;
  }

  /** The settings for the audit row: every driver's, which hold no secret by construction. */
  private auditableSettings(next: SystemStorageValue): Record<string, unknown> {
    return { provider: next.provider, drivers: next.drivers };
  }

  /**
   * The `system_settings.global` row's provenance, for `version`/`updatedAt`/`updatedBy`.
   *
   * A direct, narrow read: `SystemSettingsService.getSettings()` would CREATE
   * the row as a side effect of rendering a form, and this read must never
   * write.
   */
  private async readRow() {
    return this.prisma.systemSettings.findUnique({
      where: { key: 'global' },
      select: {
        version: true,
        updatedAt: true,
        updatedByUser: { select: { id: true, email: true } },
      },
    });
  }

  private toResponse(
    policy: SystemStorageValue,
    row: {
      version: number;
      updatedAt: Date;
      updatedByUser: { id: string; email: string } | null;
    } | null,
    infos: Map<string, Map<string, { hint: string | null; updatedAt: Date; updatedByUserId: string | null }>>,
  ): StorageConfigResponse {
    const driver = getStorageDriver(policy.provider);
    const settings = policy.drivers[policy.provider] ?? {};
    const declared = driver?.secrets ?? [];
    const present = Object.fromEntries(declared.map((secret) => [secret.name, infos.get(policy.provider)?.has(secret.name) === true]));

    // The driver's own verdict, from presence flags: this path never decrypts.
    const missing = driver ? missingStorageFields(driver, settings, present) : ['driver'];
    const location = driver ? storageLocationOf(driver, settings) : { bucket: '', endpoint: null };
    const primary = declared.length > 0 ? infos.get(policy.provider)?.get(declared[0].name) : undefined;

    return {
      provider: policy.provider,
      drivers: policy.drivers,
      // The deprecated flat view of the active built-in (`getStoragePolicy`
      // publishes it); empty when the active driver declares none of the fields.
      bucket: policy.bucket ?? '',
      region: policy.region ?? '',
      endpoint: policy.endpoint ?? '',
      accountId: policy.accountId ?? '',
      accessKeyId: policy.accessKeyId ?? '',
      forcePathStyle: policy.forcePathStyle ?? null,
      descriptors: describeStorageDrivers((id) => ({
        secrets: Object.fromEntries((getStorageDriver(id)?.secrets ?? []).map((secret) => [secret.name, infos.get(id)?.has(secret.name) === true])),
      })),
      effectiveEndpoint: location.endpoint ?? null,
      configured: missing.length === 0,
      missing,
      secretStatus: {
        configured: primary !== undefined,
        hint: primary?.hint ?? null,
        updatedAt: primary?.updatedAt.toISOString() ?? null,
        updatedByUserId: primary?.updatedByUserId ?? null,
      },
      version: row?.version ?? 0,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBy: row?.updatedByUser ?? null,
    };
  }

  private async audit(
    userId: string,
    action: string,
    meta: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action,
        targetType: 'system_settings',
        targetId: 'storage',
        meta: meta as unknown as StorageInputJsonValue,
      },
    });
  }
}

function describeLocation(location: StorageLocation): string {
  return (
    `${location.provider} bucket "${location.bucket}"` +
    (location.endpoint ? ` (${location.endpoint})` : '')
  );
}
