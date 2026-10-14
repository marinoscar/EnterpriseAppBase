/**
 * The dashboard's `/metrics` and `/filters` wire contract (issue #602, API
 * #601): the query each call sends, asserted on a test platform host.
 */
import { describe, expect, it } from 'vitest';
import { createTelemetryClient } from '../../../src/telemetry/headless/services/client.js';
import { dashboardSearchParams } from '../../../src/telemetry/headless/services/telemetryDashboard.js';
import { createTestPlatformHost } from '../../../src/testing/index.js';
import { mockDashboardFilters, mockDashboardMetrics } from '../fixtures/telemetryDashboard.js';

const API = '/admin/telemetry/dashboard';

/** A client whose `GET <API><path>` answers `data`, and the URLs it was asked. */
function captureUrls(path: string, data: unknown) {
  const host = createTestPlatformHost({ responses: { [`GET ${API}${path}`]: data } });
  const client = createTelemetryClient(host.api);
  const urls = () => host.requests.map((request) => new URL(request.path, 'http://test.local'));
  return { client, urls };
}

describe('telemetry dashboard service — metrics (#602)', () => {
  it('GETs one metric group with the window, filters and host', async () => {
    const { client, urls: requested } = captureUrls('/metrics', mockDashboardMetrics.host);
    const result = await client.getDashboardMetrics('host', {
      range: '6h',
      service: 'api',
      instance: 'node-1',
      host: 'vps-1',
      buckets: '30',
    });
    expect(result).toEqual(mockDashboardMetrics.host);
    const urls = requested();
    const params = urls[0].searchParams;
    expect(urls[0].pathname).toBe('/admin/telemetry/dashboard/metrics');
    expect(params.get('group')).toBe('host');
    expect(params.get('range')).toBe('6h');
    expect(params.get('service')).toBe('api');
    expect(params.get('instance')).toBe('node-1');
    expect(params.get('host')).toBe('vps-1');
    expect(params.get('buckets')).toBe('30');
  });

  it('sends from/to for a zoomed window and leaves absent filters out', async () => {
    const { client, urls } = captureUrls('/metrics', mockDashboardMetrics.queue);
    await client.getDashboardMetrics('queue', { from: '2026-09-27T10:00:00.000Z', to: '2026-09-27T10:30:00.000Z' });
    const params = urls()[0].searchParams;
    expect(params.get('group')).toBe('queue');
    expect(params.get('from')).toBe('2026-09-27T10:00:00.000Z');
    expect(params.has('range')).toBe(false);
    expect(params.has('host')).toBe(false);
    expect(params.has('service')).toBe(false);
  });

  it('never sends an empty host', () => {
    expect(dashboardSearchParams({ range: '1h', host: '' }).has('host')).toBe(false);
  });

  it('reads the hosts /filters reports', async () => {
    const { client } = captureUrls('/filters', mockDashboardFilters);
    const filters = await client.getDashboardFilters({ range: '1h' });
    expect(filters.hosts).toEqual(['vps-1', 'vps-2']);
  });
});
