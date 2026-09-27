import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { isBlankSecret } from '../../credentials/credential-internals';
import { CredentialsService } from '../../credentials/credentials.service';
import type { CredentialInfo } from '../../credentials/interfaces/credential-info.interface';
import { enqueueHousekeepingJob } from '../../jobs/housekeeping.enqueue';
import { JobsService } from '../../jobs/jobs.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TELEMETRY_RETENTION_TYPE } from '../handlers/telemetry-retention.handler';
import { TelemetrySettingsService } from '../telemetry-settings.service';
import type {
  TelemetryConnectionResponse,
  UpdateTelemetryConnectionInput,
} from './dto/telemetry-connection.dto';
import {
  TELEMETRY_CONNECTION_SETTINGS_KEY,
  TELEMETRY_GREPTIME_CREDENTIAL_LABELS,
  TELEMETRY_GREPTIME_CREDENTIAL_PURPOSE,
  type TelemetryConnectionRole,
  type TelemetryConnectionValue,
} from './telemetry-connection.schema';
import { TelemetryConnectionService, type TelemetryConnectionState } from './telemetry-connection.service';

// =============================================================================
// TelemetryConnectionAdminService — GET/PUT/DELETE
// /api/admin/telemetry/connection (issue #558, epic #528)
// =============================================================================
//
// The write path of the stored GreptimeDB connection. Modelled on
// `StorageConfigAdminService.replace` and `EmailSettingsService.update`:
//
//   1. `If-Match` refused BEFORE anything is written (409) — against the
//      `telemetry_connection` row's own version;
//   2. a missing password refused (400) — "blank preserves" only works when
//      something is stored to preserve;
//   3. the passwords first (so the row never names a login whose password is
//      not stored yet), then the row;
//   4. the connection snapshot refreshed on THIS instance before anything else
//      (every other instance follows within `TELEMETRY_CONNECTION_REFRESH_MS`),
//      which is also what makes `GreptimeClient` rebuild its pools;
//   5. the audit row — changed field NAMES and which passwords were set or
//      cleared, never a value;
//   6. the export gate re-applied (a store may just have become available, or
//      gone away), and a `telemetry.retention.apply` job enqueued (the admin
//      login may just have become usable). Neither fails the save.
//
// ⚠ NEVER LOG OR AUDIT A PASSWORD. The passwords are named locals that go to
// `CredentialsService.setSecret` and nowhere else.
// =============================================================================

export const TELEMETRY_CONNECTION_UPDATE_AUDIT_ACTION = 'telemetry:connection_update';
export const TELEMETRY_CONNECTION_RESET_AUDIT_ACTION = 'telemetry:connection_reset';

const CONNECTION_FIELDS = ['host', 'pgPort', 'database', 'readerUser', 'adminUser'] as const;

type CredentialChange = 'set' | 'cleared' | 'unchanged';

@Injectable()
export class TelemetryConnectionAdminService {
  private readonly logger = new Logger(TelemetryConnectionAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialsService,
    private readonly connection: TelemetryConnectionService,
    private readonly settings: TelemetrySettingsService,
    private readonly jobs: JobsService,
  ) {}

  /** `GET` — read fresh (this also refreshes this instance's snapshot). */
  async describeForAdmin(): Promise<TelemetryConnectionResponse> {
    return toResponse(await this.connection.refresh(), this.connection);
  }

  /** `PUT` — full replace of the stored connection. See the header for the order. */
  async replace(
    input: UpdateTelemetryConnectionInput,
    userId: string,
    expectedVersion?: number,
  ): Promise<TelemetryConnectionResponse> {
    const before = await this.connection.refresh();
    this.assertVersion(before, expectedVersion);

    // Named locals, so the passwords never travel with the rest of the body.
    const { readerPassword, adminPassword, ...fields } = input;
    const next: TelemetryConnectionValue = {
      host: fields.host,
      pgPort: fields.pgPort,
      database: fields.database,
      readerUser: fields.readerUser,
      adminUser: fields.adminUser,
    };

    const readerSupplied = !isBlankSecret(readerPassword);
    const adminSupplied = next.adminUser !== null && !isBlankSecret(adminPassword);

    if (!readerSupplied && !before.credentials.reader) {
      throw new BadRequestException(
        'readerPassword is required: no GreptimeDB reader password is stored yet. ' +
          '(A blank password keeps the stored one; the deployment default\'s password is never copied.)',
      );
    }

    if (next.adminUser !== null && !adminSupplied && !before.credentials.admin) {
      throw new BadRequestException(
        'adminPassword is required when adminUser is set: no GreptimeDB admin password is stored yet. ' +
          'Send adminUser as null for no admin login.',
      );
    }

    const change: Record<TelemetryConnectionRole, CredentialChange> = {
      reader: 'unchanged',
      admin: 'unchanged',
    };

    if (readerSupplied) {
      await this.setPassword('reader', readerPassword as string, userId);
      change.reader = 'set';
    }

    if (adminSupplied) {
      await this.setPassword('admin', adminPassword as string, userId);
      change.admin = 'set';
    } else if (next.adminUser === null && before.credentials.admin) {
      await this.credentials.deleteSecret(TELEMETRY_GREPTIME_CREDENTIAL_PURPOSE, 'admin');
      change.admin = 'cleared';
    }

    await this.prisma.systemSettings.upsert({
      where: { key: TELEMETRY_CONNECTION_SETTINGS_KEY },
      update: {
        value: next as unknown as Prisma.InputJsonValue,
        updatedByUserId: userId,
        version: { increment: 1 },
      },
      create: {
        key: TELEMETRY_CONNECTION_SETTINGS_KEY,
        value: next as unknown as Prisma.InputJsonValue,
        updatedByUserId: userId,
      },
    });

    // Step 4 — nothing else awaits between the write and this.
    const after = await this.connection.refresh();
    const changedFields = diffConnectionFieldNames(before.stored, next);

    await this.audit(userId, TELEMETRY_CONNECTION_UPDATE_AUDIT_ACTION, {
      previousSource: before.snapshot.source,
      changedFields,
      credentials: change,
    });

    this.logger.log(
      `Telemetry connection saved by user ${userId} ` +
        `(previousSource=${before.snapshot.source} changed=${changedFields.join(',') || '(none)'} ` +
        `readerPassword=${change.reader} adminPassword=${change.admin})`,
    );

    await this.applySideEffects();

    return toResponse(after, this.connection);
  }

  /**
   * `DELETE` — forget the stored connection and both passwords, so the
   * deployment default (or none) applies again.
   */
  async reset(userId: string, expectedVersion?: number): Promise<TelemetryConnectionResponse> {
    const before = await this.connection.refresh();
    this.assertVersion(before, expectedVersion);

    await this.prisma.systemSettings.deleteMany({ where: { key: TELEMETRY_CONNECTION_SETTINGS_KEY } });

    const cleared: TelemetryConnectionRole[] = [];
    for (const role of ['reader', 'admin'] as const) {
      if (before.credentials[role]) {
        await this.credentials.deleteSecret(TELEMETRY_GREPTIME_CREDENTIAL_PURPOSE, role);
        cleared.push(role);
      }
    }

    const after = await this.connection.refresh();

    await this.audit(userId, TELEMETRY_CONNECTION_RESET_AUDIT_ACTION, {
      previousSource: before.snapshot.source,
      hadStoredConnection: before.row !== null,
      credentialsCleared: cleared,
      source: after.snapshot.source,
    });

    this.logger.log(
      `Telemetry connection reset by user ${userId} ` +
        `(previousSource=${before.snapshot.source} source=${after.snapshot.source})`,
    );

    await this.applySideEffects();

    return toResponse(after, this.connection);
  }

  // ---------------------------------------------------------------------------

  private assertVersion(state: TelemetryConnectionState, expectedVersion: number | undefined): void {
    const currentVersion = state.row?.version ?? 0;

    if (expectedVersion !== undefined && currentVersion !== expectedVersion) {
      throw new ConflictException(
        `Telemetry connection version mismatch. Expected ${expectedVersion}, found ${currentVersion}`,
      );
    }
  }

  private async setPassword(role: TelemetryConnectionRole, password: string, userId: string): Promise<void> {
    await this.credentials.setSecret(TELEMETRY_GREPTIME_CREDENTIAL_PURPOSE, role, password, {
      label: TELEMETRY_GREPTIME_CREDENTIAL_LABELS[role],
      updatedByUserId: userId,
    });
  }

  /** The gate and the retention job. Neither may fail a save that already committed. */
  private async applySideEffects(): Promise<void> {
    await this.settings.refreshGate();

    await enqueueHousekeepingJob({
      jobs: this.jobs,
      prisma: this.prisma,
      logger: this.logger,
      type: TELEMETRY_RETENTION_TYPE,
      what: 'telemetry retention',
    });
  }

  private async audit(userId: string, action: string, meta: Record<string, unknown>): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action,
        targetType: 'system_settings',
        targetId: TELEMETRY_CONNECTION_SETTINGS_KEY,
        meta: meta as Prisma.InputJsonValue,
      },
    });
  }
}

/**
 * The NAMES of the connection fields that differ — every field when nothing
 * was stored before. Never the values.
 */
export function diffConnectionFieldNames(
  before: TelemetryConnectionValue | null,
  after: TelemetryConnectionValue,
): string[] {
  if (!before) return [...CONNECTION_FIELDS];

  return CONNECTION_FIELDS.filter((field) => before[field] !== after[field]);
}

/** The admin view of a state. Non-secret by construction: it never sees a password. */
export function toResponse(
  state: TelemetryConnectionState,
  connection: Pick<TelemetryConnectionService, 'isConfigured' | 'isAdminConfigured'>,
): TelemetryConnectionResponse {
  const { snapshot } = state;

  const status = (role: TelemetryConnectionRole) => {
    const login = role === 'reader' ? snapshot.reader : snapshot.admin;

    if (snapshot.source === 'stored') {
      // A stored admin password with no admin user cannot exist (a save with
      // adminUser null deletes it), but say "not configured" if it ever does.
      const info: CredentialInfo | null = login ? state.credentials[role] : null;

      return {
        configured: info !== null,
        hint: info?.hint ?? null,
        updatedAt: info?.updatedAt.toISOString() ?? null,
        updatedByUserId: info?.updatedByUserId ?? null,
      };
    }

    return {
      configured: Boolean(login?.passwordSet),
      hint: null,
      updatedAt: null,
      updatedByUserId: null,
    };
  };

  return {
    source: snapshot.source,
    host: snapshot.host,
    pgPort: snapshot.pgPort,
    database: snapshot.database,
    readerUser: snapshot.reader.user,
    adminUser: snapshot.admin?.user || null,
    configured: connection.isConfigured(),
    adminConfigured: connection.isAdminConfigured(),
    credentials: { reader: status('reader'), admin: status('admin') },
    version: state.row?.version ?? 0,
    updatedAt: state.row?.updatedAt.toISOString() ?? null,
    updatedBy: state.row?.updatedByUser ?? null,
  };
}
