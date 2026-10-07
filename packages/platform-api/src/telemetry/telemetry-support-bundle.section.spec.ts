import { SupportBundleRegistry, isSupportBundleOmission } from '../doctor/index';
import type { SupportBundleSectionContext } from '../doctor/index';

import type { TelemetryDashboardService } from './dashboard/telemetry-dashboard.service';
import type { GreptimeClient } from './greptime/greptime.client';
import type { TelemetryStackService } from './stack/telemetry-stack.service';
import type { TelemetrySettingsService } from './telemetry-settings.service';
import type { TelemetryStatusService } from './telemetry-status.service';
import { TelemetrySupportBundleSection } from './telemetry-support-bundle.section';

const CTX: SupportBundleSectionContext = {
  actorUserId: 'user-1',
  permissions: new Set(['system_settings:read', 'telemetry:query']),
  now: new Date('2026-10-06T00:00:00.000Z'),
  signal: new AbortController().signal,
};

function setup(overrides: { configured?: boolean; enabled?: boolean; summary?: () => Promise<unknown> } = {}) {
  const registry = new SupportBundleRegistry();
  const summary = jest.fn(overrides.summary ?? (async () => ({ verdict: { level: 'healthy', reasons: [] }, tiles: [], sql: 'x' })));
  const section = new TelemetrySupportBundleSection(
    registry,
    { isConfigured: () => overrides.configured ?? true } as unknown as GreptimeClient,
    { getPolicy: async () => ({ enabled: overrides.enabled ?? true }) } as unknown as TelemetrySettingsService,
    {
      getStatus: async () => ({
        configured: true,
        reachable: false,
        version: null,
        database: 'public',
        ttl: null,
        retentionDays: 7,
        tables: [],
        error: 'GreptimeDB did not answer.',
      }),
    } as unknown as TelemetryStatusService,
    { getStatus: async () => ({ agent: 'not_configured', agentError: null, services: [], deploy: null }) } as unknown as TelemetryStackService,
    { summary } as unknown as TelemetryDashboardService,
  );
  section.onModuleInit();
  return { registry, section, summary };
}

describe('TelemetrySupportBundleSection', () => {
  it('registers as "telemetry", gated on telemetry:query', () => {
    const { registry, section } = setup();

    expect(registry.get('telemetry')).toBe(section);
    expect(section.permission).toBe('telemetry:query');
  });

  it.each([
    [{ configured: false }, 'no telemetry store is configured'],
    [{ enabled: false }, 'telemetry is switched off'],
  ])('is omitted when %j', async (overrides, reason) => {
    const { section, summary } = setup(overrides);

    const result = await section.collect(CTX);

    expect(isSupportBundleOmission(result) && result.reason).toBe(reason);
    expect(summary).not.toHaveBeenCalled();
  });

  it('keeps the status and stack when the summary fails, recording one line of why', async () => {
    const { section } = setup({
      summary: async () => {
        throw new Error('The telemetry store did not answer.\nstack...');
      },
    });

    const data = await section.collect(CTX);

    expect(section.schema.parse(data)).toMatchObject({
      status: { reachable: false, retentionDays: 7, tableCount: 0, error: 'GreptimeDB did not answer.' },
      stack: { agent: 'not_configured', services: [] },
      summary: null,
      summaryError: 'The telemetry store did not answer.',
    });
  });

  it('asks the dashboard for the 24-hour summary as the downloading user', async () => {
    const { section, summary } = setup();

    const data = await section.collect(CTX);

    expect(summary).toHaveBeenCalledWith('user-1', { range: '24h' });
    expect(section.schema.parse(data)).toMatchObject({ summary: { range: '24h', verdict: { level: 'healthy' } } });
  });
});
