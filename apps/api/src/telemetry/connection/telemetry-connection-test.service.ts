import { Injectable, Logger } from '@nestjs/common';
import { Client, type ClientConfig } from 'pg';

import { isBlankSecret } from '../../credentials/credential-internals';
import type {
  TelemetryConnectionProbe,
  TelemetryConnectionTestResult,
  TestTelemetryConnectionInput,
} from './dto/telemetry-connection.dto';
import { GREPTIME_CONNECT_TIMEOUT_MS, GREPTIME_PING_TIMEOUT_MS, quoteIdent } from '../greptime/greptime.client';
import { checkHostResolves, hostNotFoundMessage, isDnsError, type HostCheckOptions } from '../greptime/greptime-host';
import type { TelemetryConnectionRole } from './telemetry-connection.schema';
import { TelemetryConnectionService } from './telemetry-connection.service';

// =============================================================================
// TelemetryConnectionTestService — POST /api/admin/telemetry/connection/test
// (issue #558, epic #528)
// =============================================================================
//
// Proves a CANDIDATE connection before (or without) saving it, one check per
// login:
//
//   reader  `SELECT version()`                      — can it log in at all?
//   admin   `SHOW CREATE DATABASE <database>`       — can the DDL-capable
//                                                     login see the database
//                                                     retention will alter?
//
// A THROWAWAY `pg.Client` PER CHECK, never `GreptimeClient`'s pools: a pool is
// keyed to the connection IN FORCE, and a candidate that has not been saved
// must not become one, nor evict the one that is serving the explorer.
//
// BOUNDED AND INLINE, like `POST /api/admin/storage-config/test`, not a queue
// job: at most two connections, each capped at `GREPTIME_CONNECT_TIMEOUT_MS`
// to connect and `GREPTIME_PING_TIMEOUT_MS` to answer.
//
// ALWAYS ANSWERS. A refused login or an unreachable host is a successful
// diagnosis reported in `success`/`error`, never an HTTP error.
//
// A HOST THAT DOES NOT EXIST IS SAID SO (issue #564). The target host is
// resolved ONCE, before any probe, under `GREPTIME_DNS_TIMEOUT_MS` (longer
// than Docker's ~5 s EAI_AGAIN window, which otherwise loses the race to the
// connect timeout and surfaces as a bare "timed out"). When it does not
// resolve, both probes report that without a client ever being created; the
// message differs for an automatic host (GreptimeDB is not running with this
// deployment yet: start it with "Deploy GreptimeDB" on the same page, #567) and a custom
// one (check or clear the host). A DNS error that still reaches a probe is
// reported the same way.
//
// A BLANK HOST means the deployment host (`GREPTIME_HOST`, else the compose
// service `greptimedb`) — exactly what an automatic host resolves to once
// saved (issue #562). The host actually probed is returned as `host`, so the
// form can say what "automatic" meant.
//
// A BLANK PASSWORD means "the password the connection in force uses for that
// login" — the stored one, or the environment's while the deployment default
// is in force — so an administrator can test a changed host without retyping
// a secret they may not have. That password is sent only to the host the
// administrator (who holds `telemetry:write`) typed, exactly as the storage
// test does with its stored secret key.
//
// ⚠ ERROR TEXT IS THE DRIVER'S OR SERVER'S MESSAGE ONLY — never the password,
// never a connection string. As belt and braces, a password that somehow
// appears in a message is masked before it is returned.
// =============================================================================

/** The subset of `pg.Client` a probe uses — what a test substitutes. */
export interface TelemetryProbeClient {
  connect(): Promise<unknown>;
  query(config: { text: string; rowMode: 'array' }): Promise<{ rows: unknown[][] }>;
  end(): Promise<void>;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

/** Where a probe connects — the candidate, with an automatic host already resolved. */
interface ProbeTarget {
  host: string;
  /** The form left the host blank: `host` is the deployment host. */
  automatic: boolean;
  pgPort: number;
  database: string;
}

/** How long `end()` may take before a probe stops waiting for it. */
const PROBE_END_GRACE_MS = 1_000;

@Injectable()
export class TelemetryConnectionTestService {
  private readonly logger = new Logger(TelemetryConnectionTestService.name);

  constructor(private readonly connection: TelemetryConnectionService) {}

  async test(input: TestTelemetryConnectionInput, userId: string): Promise<TelemetryConnectionTestResult> {
    const target: ProbeTarget = {
      host: input.host ?? this.connection.deploymentHost,
      automatic: input.host === null || input.host === undefined,
      pgPort: input.pgPort,
      database: input.database,
    };
    const resolveStarted = Date.now();
    const hostNotFound = await this.resolveHost(target.host, { automatic: target.automatic });
    const hostFailure = (message: string): TelemetryConnectionProbe => ({
      success: false,
      latencyMs: Date.now() - resolveStarted,
      error: message,
    });

    const readerPassword = await this.passwordFor('reader', input.readerPassword);

    const reader = !readerPassword
      ? missingPassword('reader')
      : hostNotFound
        ? hostFailure(hostNotFound)
        : await this.probe('reader', target, input.readerUser, readerPassword, 'SELECT version()');

    let admin: TelemetryConnectionTestResult['admin'];

    if (input.adminUser === null) {
      admin = { skipped: true };
    } else {
      const adminPassword = await this.passwordFor('admin', input.adminPassword);

      admin = !adminPassword
        ? missingPassword('admin')
        : hostNotFound
          ? hostFailure(hostNotFound)
          : await this.probe(
              'admin',
              target,
              input.adminUser,
              adminPassword,
              `SHOW CREATE DATABASE ${quoteIdent(input.database)}`,
            );
    }

    this.logger.log(
      `Telemetry connection test by user ${userId} (host=${target.host}): reader=${reader.success ? 'ok' : 'failed'} ` +
        `admin=${'skipped' in admin ? 'skipped' : admin.success ? 'ok' : 'failed'}`,
    );

    return { host: target.host, reader, admin };
  }

  /** Builds a client. A seam for tests; production code never overrides it. */
  protected createClient(config: ClientConfig): TelemetryProbeClient {
    return new Client(config) as unknown as TelemetryProbeClient;
  }

  /**
   * `null` when `host` resolves (or the check is inconclusive), else why it
   * does not. A seam for tests; production code never overrides it.
   */
  protected resolveHost(host: string, options: HostCheckOptions): Promise<string | null> {
    return checkHostResolves(host, undefined, undefined, options);
  }

  // ---------------------------------------------------------------------------

  private async passwordFor(role: TelemetryConnectionRole, supplied: string | undefined): Promise<string | null> {
    if (!isBlankSecret(supplied)) return supplied;

    return this.connection.currentPassword(role);
  }

  private async probe(
    role: TelemetryConnectionRole,
    target: ProbeTarget,
    user: string,
    password: string,
    sql: string,
  ): Promise<TelemetryConnectionProbe> {
    const started = Date.now();
    const client = this.createClient({
      host: target.host,
      port: target.pgPort,
      database: target.database,
      user,
      password,
      application_name: `api-telemetry-${role}-test`,
      connectionTimeoutMillis: GREPTIME_CONNECT_TIMEOUT_MS,
      query_timeout: GREPTIME_PING_TIMEOUT_MS,
    });

    // A socket dying after connect emits `error` on the client; unhandled,
    // that is an uncaught exception.
    client.on('error', () => undefined);

    try {
      await withTimeout(client.connect(), GREPTIME_CONNECT_TIMEOUT_MS, 'Connecting to GreptimeDB timed out');

      const result = await withTimeout(
        client.query({ text: sql, rowMode: 'array' }),
        GREPTIME_PING_TIMEOUT_MS,
        'GreptimeDB did not answer in time',
      );

      const first = result.rows?.[0]?.[0];

      return {
        success: true,
        latencyMs: Date.now() - started,
        ...(role === 'reader' && typeof first === 'string' ? { version: first } : {}),
      };
    } catch (error) {
      const message = isDnsError(error)
        ? hostNotFoundMessage(target.host, error, { automatic: target.automatic })
        : error instanceof Error
          ? error.message
          : String(error);

      return {
        success: false,
        latencyMs: Date.now() - started,
        error: mask(message, password),
      };
    } finally {
      await withTimeout(client.end(), PROBE_END_GRACE_MS, 'end').catch(() => undefined);
    }
  }
}

function missingPassword(role: TelemetryConnectionRole): TelemetryConnectionProbe {
  return {
    success: false,
    latencyMs: 0,
    error: `No ${role} password was supplied and none is configured for the current connection.`,
  };
}

function mask(message: string, password: string): string {
  return password ? message.split(password).join('••••') : message;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
    timer.unref?.();
  });

  // The loser of the race must not become an unhandled rejection.
  promise.catch(() => undefined);

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
