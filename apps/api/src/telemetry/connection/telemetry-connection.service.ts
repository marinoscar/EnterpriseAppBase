import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CredentialsService } from '../../credentials/credentials.service';
import type { CredentialInfo } from '../../credentials/interfaces/credential-info.interface';
import { PrismaService } from '../../prisma/prisma.service';
import {
  TELEMETRY_CONNECTION_SETTINGS_KEY,
  TELEMETRY_DEFAULT_DATABASE,
  TELEMETRY_DEFAULT_PG_PORT,
  TELEMETRY_GREPTIME_CREDENTIAL_PURPOSE,
  telemetryDeploymentHost,
  telemetryConnectionValueSchema,
  type TelemetryConnectionRole,
  type TelemetryConnectionValue,
} from './telemetry-connection.schema';

// =============================================================================
// TelemetryConnectionService — THE resolver of the GreptimeDB connection
// (issue #558, epic #528)
// =============================================================================
//
// ONE PRECEDENCE RULE, NO PER-FIELD MERGE:
//
//   1. a connection is STORED (the `telemetry_connection` row exists)
//        → it is the connection, wholly: host, port, database, both users,
//          and the two passwords from the credential store. Nothing is
//          borrowed from the environment, field by field or otherwise —
//          with ONE deliberate exception: a stored `host: null` is AUTOMATIC
//          and resolves, at every refresh, to the DEPLOYMENT HOST
//          (`GREPTIME_HOST` when non-blank, else `TELEMETRY_DEFAULT_HOST`,
//          the compose service name; issue #562). That is where GreptimeDB
//          is in every supported deployment, so an operator need not know
//          or type it, and the connection follows the deployment if it
//          moves. The fingerprint carries the EFFECTIVE host, so such a move
//          rebuilds the pools.
//   2. otherwise the DEPLOYMENT DEFAULT, derived from `GREPTIME_*` (the
//      `greptime` block of `config/configuration.ts`), when it names a host;
//   3. otherwise none — telemetry is not available.
//
// WHY THE ENVIRONMENT IS STILL A SOURCE AT ALL. The `GREPTIME_*` variables
// cannot go away: the telemetry overlay provisions the GreptimeDB container's
// users and the OTel collector's writer login from them. Ignoring them here
// would make every operator type the same credentials a second time, and
// would silently switch telemetry off on every existing deployment at
// upgrade. So they remain the default; the admin page overrides them.
// A per-field merge was rejected: "host from the form, password from the
// environment" is a connection nobody configured, and it is impossible to
// explain on a status page.
//
// WHAT IS CACHED, AND WHAT IS NOT
// -----------------------------------------------------------------------------
//
// `GreptimeClient.isConfigured()` and friends are SYNCHRONOUS (the export
// gate, the explorer's preconditions and the retention job all ask them
// without awaiting), so this service keeps a SNAPSHOT: the non-secret half of
// the resolved connection, plus, per login, whether a password is present and
// a version marker (the credential's `updatedAt` when stored; a constant for
// the environment). The snapshot is refreshed once at boot (awaited, errors
// swallowed — boot never fails on it), every `TELEMETRY_CONNECTION_REFRESH_MS`
// on an unref'd interval, and immediately after an admin save on this
// instance. So a save reaches every instance within one interval, no restart.
//
// ⚠ PASSWORDS ARE NEVER CACHED HERE. `resolveCredentials` reads the password
// from the credential store at the moment a pool is built and hands it
// straight to `pg` — the `CredentialsService.getSecret` contract, and the same
// trade `StorageConfigService` documents. The refresh itself only calls
// `CredentialsService.describe`, which cannot decrypt anything.
//
// A FAILED REFRESH KEEPS THE LAST SNAPSHOT (and logs once per outage), for the
// reason `TelemetrySettingsService` keeps the gate: flipping to "not
// configured" on a database blip would drop telemetry exactly when an
// operator needs it most.
//
// ⚠ NEVER LOG A CREDENTIAL. Nothing here logs a password or a connection
// string; the snapshot does not hold one.
// =============================================================================

/** How often every instance re-reads the stored connection. */
export const TELEMETRY_CONNECTION_REFRESH_MS = 5_000;

/** Version marker of an environment-supplied password: it cannot change without a restart. */
const ENVIRONMENT_CREDENTIAL_VERSION = 'environment';

const DEFAULT_PG_PORT = TELEMETRY_DEFAULT_PG_PORT;
const DEFAULT_DATABASE = TELEMETRY_DEFAULT_DATABASE;

/** `auto`: the host is the deployment host, resolved at refresh. `custom`: a literal someone chose. */
export type TelemetryHostMode = 'auto' | 'custom';

/** Where the resolved connection came from. */
export type TelemetryConnectionSource = 'stored' | 'environment' | 'none';

/** The `greptime` block of `config/configuration.ts` — the deployment default. */
export interface GreptimeEnvironmentConfig {
  host: string;
  pgPort: number;
  database: string;
  readerUser: string;
  readerPassword: string;
  adminUser: string;
  adminPassword: string;
  available: boolean;
}

interface LoginSnapshot {
  user: string;
  passwordSet: boolean;
  /** Changes whenever the password does. Part of the pool fingerprint. */
  version: string | null;
}

/** The resolved connection, minus every secret. */
export interface TelemetryConnectionSnapshot {
  source: TelemetryConnectionSource;
  /** The EFFECTIVE host — what a pool connects to. Empty when there is none (source `none`, or an unusable row). */
  host: string;
  /**
   * `auto` when the host is the deployment host by default (a stored
   * `host: null`, or no connection at all), `custom` when it is a literal —
   * a stored override, or `GREPTIME_HOST` for the environment source.
   */
  hostMode: TelemetryHostMode;
  pgPort: number;
  database: string;
  reader: LoginSnapshot;
  /** Null when no admin login is configured. */
  admin: LoginSnapshot | null;
}

/** What a pool is built from. Holds a plaintext password: use it and drop it. */
export interface TelemetryConnectionCredentials {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  /** Identifies this exact connection; a pool built from it is stale once it differs. */
  fingerprint: string;
}

/** A fresh read of everything the admin page shows. Non-secret. */
export interface TelemetryConnectionState {
  snapshot: TelemetryConnectionSnapshot;
  /** The stored value, or null when nothing is stored (or it does not parse). */
  stored: TelemetryConnectionValue | null;
  /** The stored row's provenance, or null when there is no row. */
  row: { version: number; updatedAt: Date; updatedByUser: { id: string; email: string } | null } | null;
  /** The credential store's view of both passwords (whatever the source). */
  credentials: Record<TelemetryConnectionRole, CredentialInfo | null>;
}

@Injectable()
export class TelemetryConnectionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelemetryConnectionService.name);
  private readonly environment: GreptimeEnvironmentConfig;

  /**
   * Seeded from the environment so the sync accessors have an answer before
   * the first refresh (and so a unit test can build a client with no
   * database). `onModuleInit` replaces it with the real resolution.
   */
  private snapshot: TelemetryConnectionSnapshot;
  private refreshTimer: NodeJS.Timeout | null = null;
  private refreshFailing = false;
  private lastInvalidRowWarned = false;

  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialsService,
  ) {
    const raw = configService.get<Partial<GreptimeEnvironmentConfig>>('greptime') ?? {};

    this.environment = {
      host: (raw.host ?? '').trim(),
      pgPort: raw.pgPort ?? DEFAULT_PG_PORT,
      database: raw.database || DEFAULT_DATABASE,
      readerUser: raw.readerUser ?? '',
      readerPassword: raw.readerPassword ?? '',
      adminUser: raw.adminUser ?? '',
      adminPassword: raw.adminPassword ?? '',
      available: raw.available ?? false,
    };
    this.snapshot = this.environmentSnapshot();
  }

  /** One awaited refresh (never throws), then the interval. */
  async onModuleInit(): Promise<void> {
    await this.refreshSafely();

    this.refreshTimer = setInterval(() => {
      void this.refreshSafely();
    }, TELEMETRY_CONNECTION_REFRESH_MS);
    // Never the reason a process (or a test run) stays alive.
    this.refreshTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Synchronous accessors, answered from the snapshot
  // ---------------------------------------------------------------------------

  /** Where the connection in force came from. */
  get source(): TelemetryConnectionSource {
    return this.snapshot.source;
  }

  /**
   * Where GreptimeDB is in this deployment: `GREPTIME_HOST` when non-blank,
   * else `TELEMETRY_DEFAULT_HOST`. What an automatic (null) host resolves to.
   */
  get deploymentHost(): string {
    return telemetryDeploymentHost(this.environment.host);
  }

  /** The GreptimeDB database telemetry is written to. */
  get database(): string {
    return this.snapshot.database;
  }

  /** A host, a reader login and its password — i.e. telemetry can be read. */
  isConfigured(): boolean {
    const { source, host, reader } = this.snapshot;

    return source !== 'none' && Boolean(host && reader.user && reader.passwordSet);
  }

  /** The admin login (retention, `SHOW CREATE DATABASE`) is usable as well. */
  isAdminConfigured(): boolean {
    const { admin } = this.snapshot;

    return this.isConfigured() && Boolean(admin && admin.user && admin.passwordSet);
  }

  /**
   * An opaque identity of the connection a login would use right now, or
   * null when that login is not configured. `GreptimeClient` keys its pools by
   * it: a different answer means the pool it holds is stale.
   */
  fingerprint(role: TelemetryConnectionRole): string | null {
    if (role === 'reader' ? !this.isConfigured() : !this.isAdminConfigured()) {
      return null;
    }

    return fingerprintOf(this.snapshot, role);
  }

  /** A copy of the snapshot. Non-secret. */
  describeSnapshot(): TelemetryConnectionSnapshot {
    return structuredClone(this.snapshot);
  }

  // ---------------------------------------------------------------------------
  // Credentials, at the moment of use
  // ---------------------------------------------------------------------------

  /**
   * The full connection for one login, password included, or null when that
   * login is not configured (or its stored password has since gone).
   *
   * ⚠ Holds a plaintext password. Call it when building a pool and let the
   * result go out of scope; never cache it, never log it.
   */
  async resolveCredentials(role: TelemetryConnectionRole): Promise<TelemetryConnectionCredentials | null> {
    const snapshot = this.snapshot;
    const fingerprint = this.fingerprint(role);
    const login = role === 'reader' ? snapshot.reader : snapshot.admin;

    if (!fingerprint || !login) return null;

    const password = await this.currentPassword(role, snapshot.source);
    if (!password) return null;

    return {
      host: snapshot.host,
      port: snapshot.pgPort,
      database: snapshot.database,
      user: login.user,
      password,
      fingerprint,
    };
  }

  /**
   * The password the connection IN FORCE would use for this login — stored
   * when the source is stored, the environment's when it is the environment.
   * For the connection test's "blank means the current one".
   *
   * ⚠ Plaintext. Same rules as `resolveCredentials`.
   */
  async currentPassword(
    role: TelemetryConnectionRole,
    source: TelemetryConnectionSource = this.snapshot.source,
  ): Promise<string | null> {
    if (source === 'environment') {
      const value = role === 'reader' ? this.environment.readerPassword : this.environment.adminPassword;
      return value || null;
    }

    return this.credentials.getSecret(TELEMETRY_GREPTIME_CREDENTIAL_PURPOSE, role);
  }

  // ---------------------------------------------------------------------------
  // Refresh
  // ---------------------------------------------------------------------------

  /**
   * Re-reads the stored row and the credentials' metadata, replaces the
   * snapshot, and returns the full (non-secret) state. THROWS on a failed
   * read, leaving the snapshot as it was — for a caller that must know (an
   * admin read or write). The background refresh uses `refreshSafely`.
   */
  async refresh(): Promise<TelemetryConnectionState> {
    const [row, reader, admin] = await Promise.all([
      this.prisma.systemSettings.findUnique({
        where: { key: TELEMETRY_CONNECTION_SETTINGS_KEY },
        select: {
          value: true,
          version: true,
          updatedAt: true,
          updatedByUser: { select: { id: true, email: true } },
        },
      }),
      this.credentials.describe(TELEMETRY_GREPTIME_CREDENTIAL_PURPOSE, 'reader'),
      this.credentials.describe(TELEMETRY_GREPTIME_CREDENTIAL_PURPOSE, 'admin'),
    ]);

    const credentials = { reader, admin };
    let stored: TelemetryConnectionValue | null = null;
    let snapshot: TelemetryConnectionSnapshot;

    if (!row) {
      snapshot = this.environmentSnapshot();
      this.lastInvalidRowWarned = false;
    } else {
      const parsed = telemetryConnectionValueSchema.safeParse(row.value);

      if (parsed.success) {
        stored = parsed.data;
        snapshot = storedSnapshot(parsed.data, credentials, this.deploymentHost);
        this.lastInvalidRowWarned = false;
      } else {
        // A row exists but does not validate (hand-edited). It is still "the
        // stored connection" — silently falling back to the environment would
        // put telemetry on a connection nobody chose — so it resolves as
        // stored-and-unusable until an administrator saves or resets it.
        if (!this.lastInvalidRowWarned) {
          this.lastInvalidRowWarned = true;
          this.logger.warn(
            'The stored telemetry connection does not validate ' +
              `(${parsed.error.issues.map((issue) => issue.path.join('.') || '(root)').join(', ')}); ` +
              'telemetry is unavailable until it is saved again or reset at /admin/settings/telemetry.',
          );
        }
        snapshot = unusableStoredSnapshot();
      }
    }

    const before = this.snapshot;
    this.snapshot = snapshot;

    if (before.source !== snapshot.source) {
      this.logger.log(`Telemetry connection source is now "${snapshot.source}"`);
    }

    return {
      snapshot: structuredClone(snapshot),
      stored,
      row: row ? { version: row.version, updatedAt: row.updatedAt, updatedByUser: row.updatedByUser } : null,
      credentials,
    };
  }

  /** `refresh`, but never throws: a failure keeps the last snapshot and logs once per outage. */
  async refreshSafely(): Promise<boolean> {
    try {
      await this.refresh();

      if (this.refreshFailing) {
        this.refreshFailing = false;
        this.logger.log('Telemetry connection readable again');
      }

      return true;
    } catch (error) {
      if (!this.refreshFailing) {
        this.refreshFailing = true;
        this.logger.warn(
          `Could not read the telemetry connection; keeping the last known one (source "${this.snapshot.source}"): ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return false;
    }
  }

  /** The deployment default, as a snapshot (source `none` when it names no host). */
  environmentSnapshot(): TelemetryConnectionSnapshot {
    const env = this.environment;

    if (!env.host) {
      return {
        source: 'none',
        host: '',
        hostMode: 'auto',
        pgPort: env.pgPort,
        database: env.database,
        reader: { user: '', passwordSet: false, version: null },
        admin: null,
      };
    }

    return {
      source: 'environment',
      host: env.host,
      hostMode: 'custom',
      pgPort: env.pgPort,
      database: env.database,
      reader: {
        user: env.readerUser,
        passwordSet: Boolean(env.readerPassword),
        version: env.readerPassword ? ENVIRONMENT_CREDENTIAL_VERSION : null,
      },
      admin: env.adminUser
        ? {
            user: env.adminUser,
            passwordSet: Boolean(env.adminPassword),
            version: env.adminPassword ? ENVIRONMENT_CREDENTIAL_VERSION : null,
          }
        : null,
    };
  }
}

function storedSnapshot(
  value: TelemetryConnectionValue,
  credentials: Record<TelemetryConnectionRole, CredentialInfo | null>,
  deploymentHost: string,
): TelemetryConnectionSnapshot {
  const login = (user: string, info: CredentialInfo | null): LoginSnapshot => ({
    user,
    passwordSet: info !== null,
    version: info ? info.updatedAt.toISOString() : null,
  });

  return {
    source: 'stored',
    // Null = automatic: resolved here, at every refresh, never stored as a literal.
    host: value.host ?? deploymentHost,
    hostMode: value.host === null ? 'auto' : 'custom',
    pgPort: value.pgPort,
    database: value.database,
    reader: login(value.readerUser, credentials.reader),
    admin: value.adminUser ? login(value.adminUser, credentials.admin) : null,
  };
}

function unusableStoredSnapshot(): TelemetryConnectionSnapshot {
  return {
    source: 'stored',
    host: '',
    hostMode: 'auto',
    pgPort: DEFAULT_PG_PORT,
    database: DEFAULT_DATABASE,
    reader: { user: '', passwordSet: false, version: null },
    admin: null,
  };
}

function fingerprintOf(snapshot: TelemetryConnectionSnapshot, role: TelemetryConnectionRole): string {
  const login = role === 'reader' ? snapshot.reader : snapshot.admin;

  return JSON.stringify([
    snapshot.source,
    // The EFFECTIVE host, so an automatic host whose deployment host changed
    // yields a new fingerprint (and new pools).
    snapshot.host,
    snapshot.pgPort,
    snapshot.database,
    login?.user ?? '',
    login?.version ?? '',
  ]);
}
