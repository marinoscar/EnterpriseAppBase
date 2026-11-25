/**
 * The section metadata (issue #602): order, anchors, and which verdict reason
 * (the API's wording, `telemetry-dashboard.verdict.ts`) belongs to which
 * section.
 */
import { describe, expect, it } from 'vitest';
import {
  metricPanelId,
  metricSectionAnchor,
  metricSectionTitle,
  verdictReasonGroup,
} from '../../../../src/telemetry/headless/lib/metrics/metricSections.js';
import { mockDashboardMetricGroups } from '../../fixtures/telemetryDashboard.js';

describe('metric sections', () => {
  it('anchors and panel ids are derived from the group id', () => {
    expect(metricSectionAnchor('database')).toBe('telemetry-section-database');
    expect(metricPanelId('database')).toBe('panel-metrics-database');
    expect(metricSectionAnchor('coach')).toBe('telemetry-section-coach');
  });

  it('titles come from the /metric-groups metadata (#680), then the fallback map, then the id', () => {
    expect(mockDashboardMetricGroups.map((group) => metricSectionTitle(group.id, mockDashboardMetricGroups))).toEqual([
      'Infrastructure',
      'Database',
      'Job queue',
      'Worker nodes',
      'Uptime & dependencies',
      'Telemetry pipeline',
    ]);
    expect(metricSectionTitle('coach', mockDashboardMetricGroups)).toBe('coach');
    // Without metadata, the two platform groups whose title is not their id
    // keep their dashboard titles (#704); every other group shows its id.
    expect(metricSectionTitle('host')).toBe('Infrastructure');
    expect(metricSectionTitle('uptime')).toBe('Uptime & dependencies');
    expect(metricSectionTitle('database')).toBe('database');
    // An app group is titled from its metadata, with no web change (EvoPath's `coach`).
    expect(metricSectionTitle('coach', [{ id: 'coach', title: 'AI Coach' }])).toBe('AI Coach');
  });

  it.each([
    ['Disk 91.2% full (≥ 85%) — mountpoint: /', 'host'],
    ['Memory 97.5% used (≥ 97%) — host: vps-1', 'host'],
    ['Database connections at 82% of max (≥ 80%) — server: db:5432', 'database'],
    ['Oldest pending job waiting 12 min (≥ 10 min) — job type: export.csv', 'queue'],
    ['Last successful backup 30 h ago (> 26 h)', 'queue'],
    ['2 job type(s) have pending work and no eligible worker node — types: a, b', 'nodes'],
    ['1 worker node(s) stale (missed heartbeats)', 'nodes'],
    ['TLS certificate expires in 12 days (< 14 days) — url: https://app.example.com/', 'uptime'],
    ['TLS certificate expired 2 days ago (< 7 days) — url: https://app.example.com/', 'uptime'],
    ['Uptime check failed on its latest run (1 URL(s)) — url: https://app.example.com/', 'uptime'],
    ['Uptime check failing for every check in the lookback (1 URL(s)) — url: http://nginx/', 'uptime'],
    ['Collector failed to export 12 points (3% of attempted) — exporter: otlphttp', 'pipeline'],
  ])('%s → %s', (reason, group) => {
    expect(verdictReasonGroup(reason)).toBe(group);
  });

  it.each([
    '5xx rate 3.2% (> 2%) — top: GET /api/users/:id',
    'p95 latency 1400 ms (> 1000 ms)',
    'Error logs 40 vs 4 in the previous window (10× ≥ 10×)',
    'No telemetry received for 7 min',
  ])('leaves the traffic and no-data reasons unlinked: %s', (reason) => {
    expect(verdictReasonGroup(reason)).toBeNull();
  });
});
