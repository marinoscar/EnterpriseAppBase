// =============================================================================
// Stub host ports for the telemetry slice (PP-4.6)
// =============================================================================
//
// The six host ports (`../ports.ts`) as in-memory fakes, for a TEST that has to
// boot `TelemetryModule.forRoot` without an app: the conformance suite, and an
// app's own boot test. Never import it from production code.
//
// What is seedable is what a test needs to prove: the credential store can hold
// KNOWN passwords (so a test can assert none reaches a response), and the
// settings store can hold a `telemetry_connection` row. Everything else is the
// smallest stub that satisfies the port: audit rows are collected, jobs are
// recorded, AI is off.
// =============================================================================

import { Module, type Type } from '@nestjs/common';

import {
  TELEMETRY_AI,
  TELEMETRY_APP_INFO,
  TELEMETRY_AUDIT_SINK,
  TELEMETRY_CREDENTIAL_STORE,
  TELEMETRY_JOBS,
  TELEMETRY_SETTINGS_STORE,
  type TelemetryAuditEvent,
  type TelemetryCredentialInfo,
} from '../ports';
import { TELEMETRY_SETTINGS_DEFAULTS } from '../telemetry.settings';

/**
 * What the stub ports hold.
 *
 * @stability experimental
 */
export interface StubTelemetryPortsOptions {
  /** Passwords the credential store holds, by credential name (`reader`, `admin`), under purpose `telemetry_greptime`. */
  credentials?: Readonly<Record<string, string>>;
  /** Keyed system-settings rows the settings store holds, by key (`telemetry_connection`); the value is the row's stored JSON. */
  rows?: Readonly<Record<string, unknown>>;
}

/**
 * The stub ports' observable state, so a test can look at what the slice did.
 *
 * @stability experimental
 */
export interface StubTelemetryPortsState {
  /** Every audit event recorded, in order. */
  readonly audit: TelemetryAuditEvent[];
  /** The job types the slice registered handlers for. */
  readonly handlers: string[];
}

/**
 * A Nest module exporting one in-memory provider per telemetry host port, with
 * its state. Pass the module in `TelemetryModule.forRoot({ imports: [module] })`.
 *
 * @param options - what the credential and settings stores hold.
 * @returns the module class and the state its stubs write to.
 *
 * @example
 * ```ts
 * const { module, state } = createStubTelemetryPorts({ credentials: { reader: 'known-password' } });
 * TelemetryModule.forRoot({ host: createTestPlatformHost(), imports: [module] });
 * ```
 *
 * @stability experimental
 */
export function createStubTelemetryPorts(options: StubTelemetryPortsOptions = {}): {
  /** The module to pass in `imports`. */
  module: Type<unknown>;
  /** What the stubs recorded. */
  state: StubTelemetryPortsState;
} {
  const state: StubTelemetryPortsState = { audit: [], handlers: [] };
  const secrets = new Map(Object.entries(options.credentials ?? {}));
  const rows = new Map(Object.entries(options.rows ?? {}));
  const savedAt = new Date('2026-01-01T00:00:00.000Z');

  const describe = async (purpose: string, name: string): Promise<TelemetryCredentialInfo | null> => {
    const secret = secrets.get(name);
    if (secret === undefined || purpose !== 'telemetry_greptime') return null;
    return { purpose, name, hint: secret.slice(-4), label: null, updatedByUserId: null, createdAt: savedAt, updatedAt: savedAt };
  };

  @Module({
    providers: [
      { provide: TELEMETRY_AUDIT_SINK, useValue: { record: async (event: TelemetryAuditEvent) => void state.audit.push(event) } },
      {
        provide: TELEMETRY_SETTINGS_STORE,
        useValue: {
          getTelemetryPolicy: async () => structuredClone(TELEMETRY_SETTINGS_DEFAULTS),
          replaceTelemetryPolicy: async () => undefined,
          readPolicyProvenance: async () => null,
          readRow: async (key: string) =>
            rows.has(key) ? { value: structuredClone(rows.get(key)), version: 1, updatedAt: savedAt, updatedBy: null } : null,
          writeRow: async (key: string, value: unknown) => void rows.set(key, value),
          deleteRow: async (key: string) => void rows.delete(key),
          readFeatureFlag: async () => false,
        },
      },
      {
        provide: TELEMETRY_CREDENTIAL_STORE,
        useValue: {
          getSecret: async (purpose: string, name: string) => (purpose === 'telemetry_greptime' ? (secrets.get(name) ?? null) : null),
          setSecret: async (_purpose: string, name: string, secret: string | null | undefined) => {
            if (secret) secrets.set(name, secret);
            else secrets.delete(name);
          },
          deleteSecret: async (_purpose: string, name: string) => void secrets.delete(name),
          describe,
        },
      },
      {
        provide: TELEMETRY_JOBS,
        useValue: {
          enqueue: async () => ({ id: 'job-1', status: 'pending' }),
          enqueueHousekeepingJob: async () => undefined,
          registerHandler: (handler: { type: string }) => void state.handlers.push(handler.type),
          findLatest: async () => null,
          updatePayload: async () => undefined,
        },
      },
      {
        provide: TELEMETRY_AI,
        useValue: {
          forUser: () => ({ runTools: async () => ({ final: {}, steps: [], stopReason: 'completed' }) }),
          defineTool: (definition: unknown) => definition,
          isAiError: () => false,
          assertEnabled: async () => undefined,
        },
      },
      {
        provide: TELEMETRY_APP_INFO,
        useValue: {
          slug: 'stub-app',
          serviceName: () => 'stub-app-api',
          apiVersion: () => '0.0.0',
          readDeployInfo: async () => ({ status: 'absent', document: null }),
        },
      },
    ],
    exports: [TELEMETRY_AUDIT_SINK, TELEMETRY_SETTINGS_STORE, TELEMETRY_CREDENTIAL_STORE, TELEMETRY_JOBS, TELEMETRY_AI, TELEMETRY_APP_INFO],
  })
  class StubTelemetryPortsModule {}

  return { module: StubTelemetryPortsModule, state };
}
