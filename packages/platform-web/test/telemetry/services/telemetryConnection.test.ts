/**
 * The telemetry-connection wire contract (issue #558, epic #528): method,
 * path, `If-Match` and body of each of the four routes, asserted on a test
 * platform host.
 * `If-Match: 0` IS sent — the check is `=== undefined`, never truthiness, so
 * the first save over the deployment default is still guarded.
 */
import { describe, it, expect } from 'vitest';
import { createTelemetryClient } from '../../../src/telemetry/headless/services/client.js';
import {
  isTelemetryProbeSkipped,
  type TelemetryConnectionInput,
} from '../../../src/telemetry/headless/services/telemetry.js';
import { createTestPlatformHost } from '../../../src/testing/index.js';
import type { TestPlatformHost } from '../../../src/testing/index.js';
import {
  mockTelemetryConnectionEnvironment,
  mockTelemetryConnectionStored,
  mockTelemetryConnectionTestResult,
} from '../fixtures/telemetry.js';

let host: TestPlatformHost;
const client = () => createTelemetryClient(host.api);

const input: TelemetryConnectionInput = {
  host: 'greptimedb',
  pgPort: 4003,
  database: 'public',
  readerUser: 'readonly',
  readerPassword: 'pw',
  adminUser: null,
};

/** Answer `<METHOD> path` with `data`; the calls' bodies and If-Match values, as they arrive. */
function capture(method: 'put' | 'delete' | 'post', path: string, data: unknown) {
  host = createTestPlatformHost({
    responses: { [`${method.toUpperCase()} ${path}`]: data, 'GET /admin/telemetry/connection': mockTelemetryConnectionStored },
  });
  return () =>
    host.requests
      .filter((request) => request.method === method.toUpperCase())
      .map((request) => ({ body: request.body ?? null, ifMatch: request.ifMatch ?? null }));
}

describe('telemetry connection service', () => {
  it('GETs the connection', async () => {
    capture('put', '/admin/telemetry/connection', null);
    await expect(client().getTelemetryConnection()).resolves.toEqual(mockTelemetryConnectionStored);
    expect(host.requests).toEqual([{ method: 'GET', path: '/admin/telemetry/connection' }]);
  });

  it('PUTs the body with If-Match, including 0', async () => {
    const calls = capture('put', '/admin/telemetry/connection', mockTelemetryConnectionStored);
    await client().updateTelemetryConnection(input, 0);
    expect(calls()).toEqual([{ body: input, ifMatch: '0' }]);
  });

  it('PUTs without If-Match when no version is given', async () => {
    const calls = capture('put', '/admin/telemetry/connection', mockTelemetryConnectionStored);
    await client().updateTelemetryConnection(input);
    expect(calls()[0].ifMatch).toBeNull();
  });

  it('DELETEs with If-Match and no body', async () => {
    const calls = capture('delete', '/admin/telemetry/connection', mockTelemetryConnectionEnvironment);
    await expect(client().resetTelemetryConnection(3)).resolves.toEqual(mockTelemetryConnectionEnvironment);
    expect(calls()).toEqual([{ body: null, ifMatch: '3' }]);
  });

  it('POSTs a test and resolves a failed diagnosis rather than throwing', async () => {
    const result = {
      host: 'greptimedb',
      hostMode: 'custom',
      reader: { success: false, latencyMs: 5, error: 'refused' },
      admin: { skipped: true },
    };
    const calls = capture('post', '/admin/telemetry/connection/test', result);
    const answer = await client().testTelemetryConnection(input);
    expect(calls()[0].body).toEqual(input);
    expect(answer.reader.success).toBe(false);
    expect(isTelemetryProbeSkipped(answer.admin)).toBe(true);
    expect(answer.host).toBe('greptimedb');
  });

  it('sends exactly { host: null } for an automatic host (#570)', async () => {
    const calls = capture('put', '/admin/telemetry/connection', mockTelemetryConnectionStored);
    await client().updateTelemetryConnection({ host: null }, 3);
    expect(calls()).toEqual([{ body: { host: null }, ifMatch: '3' }]);
  });

  it('POSTs exactly { host: null } to test the automatic connection (#570)', async () => {
    const calls = capture('post', '/admin/telemetry/connection/test', mockTelemetryConnectionTestResult);
    const answer = await client().testTelemetryConnection({ host: null });
    expect(calls()[0].body).toEqual({ host: null });
    expect(answer.hostMode).toBe('auto');
  });
});
