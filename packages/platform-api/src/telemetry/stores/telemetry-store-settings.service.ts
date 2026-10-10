// =============================================================================
// TelemetryStoreSettingsService: GET / PUT /api/admin/telemetry/store (PP-14.11)
// =============================================================================
//
// The admin surface of a store that is not the built-in GreptimeDB (whose
// connection is `TelemetryConnectionAdminService`). The selected store brings
// its own settings schema and secrets (the pluggable-kind shape), so this
// service is generic over them:
//
//   - the NON-SECRET settings are one entry, `{ [storeId]: settings }`, of the
//     `telemetry_store` system-settings row (its own `If-Match` version, like
//     `telemetry_connection`): validated with the store's schema on write,
//     dropped with a warning on read when the store is no longer registered;
//   - the SECRETS are in the credential store under the purpose
//     `telemetry_<storeId>`, one name per secret the store declares; they are
//     write-only, and the response carries presence only;
//   - a save refreshes the running store on THIS instance at once (every other
//     instance within `TELEMETRY_STORE_REFRESH_INTERVAL_MS`) and queues a
//     `telemetry.retention.apply` job through the settings service's side
//     effects (the store may just have become usable).
//
// ⚠ NEVER LOG OR AUDIT A SECRET. The audit row carries setting and secret NAMES.
// =============================================================================

import { BadRequestException, ConflictException, Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { PluggableSettingsError } from '../../core/index';
import { TELEMETRY_RETENTION_TYPE } from '../handlers/telemetry-retention.handler';
import {
  TELEMETRY_AUDIT_SINK,
  TELEMETRY_CREDENTIAL_STORE,
  TELEMETRY_JOBS,
  TELEMETRY_SETTINGS_STORE,
  type TelemetryAuditSink,
  type TelemetryCredentialStore,
  type TelemetryJobsPort,
  type TelemetrySettingsStore,
} from '../ports';
import { TelemetrySettingsService } from '../telemetry-settings.service';
import { isBlankSecret } from '../internal/blank-secret';
import { TELEMETRY_OPTIONS, type ResolvedTelemetryModuleOptions } from '../telemetry.options';
import {
  BUILTIN_TELEMETRY_STORE_ID,
  TELEMETRY_STORE,
  describeTelemetryStore,
  telemetryStoreCredentialPurpose,
  telemetryStoreKind,
  type TelemetryStore,
} from './telemetry-store';
import { TELEMETRY_STORE_SETTINGS_KEY, TelemetryStoreResolver } from './telemetry-store.resolver';
import type { TelemetryStoreResponse, TelemetryStoreSummary, UpdateTelemetryStoreInput } from './dto/telemetry-store.dto';

/** The audit action of a save. */
export const TELEMETRY_STORE_UPDATE_AUDIT_ACTION = 'telemetry:store_update';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The admin read and write of the selected store's settings and secrets.
 *
 * @stability experimental
 */
@Injectable()
export class TelemetryStoreSettingsService {
  private readonly logger = new Logger(TelemetryStoreSettingsService.name);
  private readonly id: string;

  constructor(
    @Inject(TELEMETRY_OPTIONS) options: Pick<ResolvedTelemetryModuleOptions, 'store'>,
    @Inject(TELEMETRY_SETTINGS_STORE) private readonly settingsStore: TelemetrySettingsStore,
    @Inject(TELEMETRY_CREDENTIAL_STORE) private readonly credentials: TelemetryCredentialStore,
    @Inject(TELEMETRY_AUDIT_SINK) private readonly auditSink: TelemetryAuditSink,
    @Inject(TELEMETRY_STORE) private readonly store: TelemetryStore,
    private readonly policy: TelemetrySettingsService,
    @Inject(TELEMETRY_JOBS) private readonly jobs: TelemetryJobsPort,
    @Optional() private readonly resolver?: TelemetryStoreResolver,
  ) {
    this.id = options.store;
  }

  /** `GET`: the active store, the registered ones, and (for a generated-form store) its descriptor and settings. */
  async describeForAdmin(): Promise<TelemetryStoreResponse> {
    const row = await this.settingsStore.readRow(TELEMETRY_STORE_SETTINGS_KEY);
    const builtin = this.id === BUILTIN_TELEMETRY_STORE_ID;
    const base = {
      active: this.summary(this.id),
      stores: telemetryStoreKind.ids().map((id) => this.summary(id)),
      version: row?.version ?? 0,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };

    if (builtin) {
      return { ...base, descriptor: null, settings: {}, ready: this.store.isConfigured(), error: null };
    }

    const record = telemetryStoreKind.readSettingsRecord(isRecord(row?.value) ? row.value : {}, (message) =>
      this.logger.warn(message),
    );
    const settings = record[this.id] ?? telemetryStoreKind.parseSettings(this.id, {});

    return {
      ...base,
      descriptor: describeTelemetryStore(this.id, { secrets: await this.secretPresence() }),
      settings,
      ready: this.store.isConfigured(),
      error: this.resolver?.lastError() ?? null,
    };
  }

  /**
   * `PUT`: merges `input.settings` over the stored ones (validated with the
   * store's schema) and stores `input.secrets`. See the header.
   *
   * @throws BadRequestException for the built-in store, an undeclared secret, or settings that do not parse.
   * @throws ConflictException when `expectedVersion` is stale.
   */
  async update(input: UpdateTelemetryStoreInput, userId: string, expectedVersion?: number): Promise<TelemetryStoreResponse> {
    if (this.id === BUILTIN_TELEMETRY_STORE_ID) {
      throw new BadRequestException(
        'The built-in GreptimeDB store is configured through /api/admin/telemetry/connection, not here.',
      );
    }

    const row = await this.settingsStore.readRow(TELEMETRY_STORE_SETTINGS_KEY);
    const currentVersion = row?.version ?? 0;
    if (expectedVersion !== undefined && currentVersion !== expectedVersion) {
      throw new ConflictException(
        `Telemetry store settings version mismatch. Expected ${expectedVersion}, found ${currentVersion}`,
      );
    }

    const definition = telemetryStoreKind.get(this.id);
    const declared = new Set((definition.secrets ?? []).map((secret) => secret.name));
    const secrets = input.secrets ?? {};
    const unknown = Object.keys(secrets).filter((name) => !declared.has(name));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `The telemetry store "${this.id}" declares no secret named ${unknown.map((name) => `"${name}"`).join(', ')}` +
          ` (declared: ${[...declared].join(', ') || 'none'}).`,
      );
    }

    // Everything is validated before anything is written.
    let merged: Record<string, Record<string, unknown>> | null = null;
    const changedSettings = Object.keys(input.settings ?? {});
    if (input.settings !== undefined) {
      try {
        const stored = isRecord(row?.value) ? row.value : {};
        merged = telemetryStoreKind.mergeSettingsRecord(stored, { [this.id]: input.settings });
      } catch (error) {
        if (error instanceof PluggableSettingsError) {
          throw new BadRequestException(
            `Invalid settings for the telemetry store "${this.id}": ` +
              error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; '),
          );
        }
        throw error;
      }
    }

    const purpose = telemetryStoreCredentialPurpose(this.id);
    const changedSecrets: Record<string, 'set' | 'cleared'> = {};
    for (const secret of definition.secrets ?? []) {
      if (!(secret.name in secrets)) continue;
      const value = secrets[secret.name];
      if (isBlankSecret(value)) {
        await this.credentials.deleteSecret(purpose, secret.name);
        changedSecrets[secret.name] = 'cleared';
      } else {
        await this.credentials.setSecret(purpose, secret.name, value, { label: secret.label, updatedByUserId: userId });
        changedSecrets[secret.name] = 'set';
      }
    }

    if (merged !== null) await this.settingsStore.writeRow(TELEMETRY_STORE_SETTINGS_KEY, merged, userId);

    await this.auditSink.record({
      actorUserId: userId,
      action: TELEMETRY_STORE_UPDATE_AUDIT_ACTION,
      targetType: 'system_settings',
      targetId: TELEMETRY_STORE_SETTINGS_KEY,
      meta: { store: this.id, changedSettings, changedSecrets },
    });

    await this.resolver?.refresh();
    await this.applySideEffects();

    return this.describeForAdmin();
  }

  /** The export gate and the retention job. Neither may fail a save that already committed. */
  private async applySideEffects(): Promise<void> {
    await this.policy.refreshGate();

    await this.jobs.enqueueHousekeepingJob({
      logger: this.logger,
      type: TELEMETRY_RETENTION_TYPE,
      what: 'telemetry retention',
    });
  }

  private summary(id: string): TelemetryStoreSummary {
    const impl = telemetryStoreKind.get(id);

    return { id, label: impl.label, ...(impl.description === undefined ? {} : { description: impl.description }) };
  }

  private async secretPresence(): Promise<Record<string, boolean>> {
    const purpose = telemetryStoreCredentialPurpose(this.id);
    const present: Record<string, boolean> = {};
    for (const secret of telemetryStoreKind.get(this.id).secrets ?? []) {
      present[secret.name] = (await this.credentials.describe(purpose, secret.name)) !== null;
    }

    return present;
  }
}
