// =============================================================================
// The built-in `greptime` telemetry store, registered (PP-14.11)
// =============================================================================
//
// GreptimeDB over its PostgreSQL wire protocol is the store the platform ships.
// It registers through `registerTelemetryStore`, the same function an app uses,
// at import time: whatever resolves a store by id imports this file first, so
// `greptime` is always there regardless of which entry point loaded the slice.
//
// ITS SETTINGS ARE NOT A SETTINGS RECORD. The connection (host, port,
// database, logins) is runtime configuration an administrator edits at
// /admin/settings/telemetry: the `telemetry_connection` row plus two passwords
// in the credential purpose `telemetry_greptime`, resolved by
// `TelemetryConnectionService` (with the `GREPTIME_*` deployment default). The
// definition therefore declares no settings and no secrets, and `build` takes
// the connection resolver from the build context. Unchanged by the store port.
//
// IDEMPOTENT ACROSS DUPLICATE MODULE INSTANCES: a store already registered is
// skipped, so two copies of this file (a bundler, a test double) cannot make
// the second registration throw `DUPLICATE_ID`.
// =============================================================================

import { z } from 'zod';

import type { TelemetryConnectionService } from '../../connection/telemetry-connection.service';
import {
  BUILTIN_TELEMETRY_STORE_ID,
  registerTelemetryStore,
  telemetryStoreKind,
  type TelemetryStoreBuildInput,
  type TelemetryStoreDefinition,
} from '../telemetry-store';
import { GreptimeClient } from './greptime.client';
import { GREPTIME_SQL_DIALECT } from './greptime.dialect';

/**
 * The built-in store's definition.
 *
 * @stability experimental
 */
export const GREPTIME_TELEMETRY_STORE: TelemetryStoreDefinition = Object.freeze({
  id: BUILTIN_TELEMETRY_STORE_ID,
  label: 'GreptimeDB',
  description: 'GreptimeDB over the PostgreSQL wire protocol. Configured at /admin/settings/telemetry.',
  settingsSchema: z.object({}),
  defaults: {},
  build: ({ connection }: TelemetryStoreBuildInput) => ({
    store: new GreptimeClient(connection as TelemetryConnectionService),
    dialect: GREPTIME_SQL_DIALECT,
  }),
});

if (!telemetryStoreKind.has(GREPTIME_TELEMETRY_STORE.id)) registerTelemetryStore(GREPTIME_TELEMETRY_STORE);
