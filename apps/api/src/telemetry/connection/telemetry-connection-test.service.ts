import { Injectable, Logger } from '@nestjs/common';
import { Client, type ClientConfig } from 'pg';

import { isBlankSecret } from '../../credentials/credential-internals';
import type {
  TelemetryConnectionProbe,
  TelemetryConnectionTestResult,
  TestTelemetryConnectionInput,
} from './dto/telemetry-connection.dto';
import { GREPTIME_CONNECT_TIMEOUT_MS, GREPTIME_PING_TIMEOUT_MS, quoteIdent } from '../greptime/greptime.client';
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

/** How long `end()` may take before a probe stops waiting for it. */
const PROBE_END_GRACE_MS = 1_000;

@Injectable()
export class TelemetryConnectionTestService {
  private readonly logger = new Logger(TelemetryConnectionTestService.name);

  constructor(private readonly connection: TelemetryConnectionService) {}

  async test(input: TestTelemetryConnectionInput, userId: string): Promise<TelemetryConnectionTestResult> {
    const readerPassword = await this.passwordFor('reader', input.readerPassword);

    const reader = readerPassword
      ? await this.probe('reader', input, input.readerUser, readerPassword, 'SELECT version()')
      : missingPassword('reader');

    let admin: TelemetryConnectionTestResult['admin'];

    if (input.adminUser === null) {
      admin = { skipped: true };
    } else {
      const adminPassword = await this.passwordFor('admin', input.adminPassword);

      admin = adminPassword
        ? await this.probe(
            'admin',
            input,
            input.adminUser,
            adminPassword,
            `SHOW CREATE DATABASE ${quoteIdent(input.database)}`,
          )
        : missingPassword('admin');
    }

    this.logger.log(
      `Telemetry connection test by user ${userId}: reader=${reader.success ? 'ok' : 'failed'} ` +
        `admin=${'skipped' in admin ? 'skipped' : admin.success ? 'ok' : 'failed'}`,
    );

    return { reader, admin };
  }

  /** Builds a client. A seam for tests; production code never overrides it. */
  protected createClient(config: ClientConfig): TelemetryProbeClient {
    return new Client(config) as unknown as TelemetryProbeClient;
  }

  // ---------------------------------------------------------------------------

  private async passwordFor(role: TelemetryConnectionRole, supplied: string | undefined): Promise<string | null> {
    if (!isBlankSecret(supplied)) return supplied;

    return this.connection.currentPassword(role);
  }

  private async probe(
    role: TelemetryConnectionRole,
    target: TestTelemetryConnectionInput,
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
      return {
        success: false,
        latencyMs: Date.now() - started,
        error: mask(error instanceof Error ? error.message : String(error), password),
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
