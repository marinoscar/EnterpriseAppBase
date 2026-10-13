// =============================================================================
// Real-Postgres test: usage by feature, for an app operation (PP-14.17, #935)
// =============================================================================
//
// Per-feature usage is only answerable from the database if the feature is
// PERSISTED: `ai_usage_events.feature` (migration 0035) is written by the real
// recorder and read back by the real report. A mocked `$queryRaw` would return
// whatever a test told it to, so this runs the SQL (the `feature` filter, the
// `feature` and `operation` group-bys, the priced report's slice queries)
// against a real server, with the app's own example operation and price list.
//
// Every row is written under a provider id unique to this run and every report
// filters on it, so the suite neither sees nor disturbs other data.
//
// THIS IS A `*.db.spec.ts` FILE: skipped with a warning when no Postgres is
// reachable; see `test/jobs/db-test-support.ts`.
// =============================================================================

import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';

import { AiProviderRegistry, AiUsageRecorder, AiUsageService } from '@marinoscar/platform-api/ai';

import '../../../src/app-registrations/ai';
import { EXAMPLE_DIARIZE_OPERATION } from '../../../src/platform-extensions/ai/example-transcribe/example-diarize.operation';
import { ExamplePricing } from '../../../src/platform-extensions/ai/example-pricing/example-pricing';
import { createDbClient, createDbServices, defaultOrgId, resolveDbSuite } from '../../jobs/db-test-support';

const { describeWithDb } = resolveDbSuite('ai-usage-by-feature.db.spec');

const NOW = new Date('2026-09-26T12:00:00.000Z');
const FEATURE = 'example_meeting_notes';

describeWithDb('AI usage by feature (real Postgres)', () => {
  let client: PrismaClient;
  let services: ReturnType<typeof createDbServices>;
  let recorder: AiUsageRecorder;
  let plain: AiUsageService;
  let priced: AiUsageService;
  let orgId: string;
  let userId: string;
  // `example-transcribe` is the provider the example price list prices; a unique suffix keeps this run's rows apart.
  const provider = `example-transcribe`;
  const model = `asr-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    client = createDbClient();
    services = createDbServices();
    orgId = await defaultOrgId(client);
    recorder = new AiUsageRecorder(services.prisma);
    plain = new AiUsageService(services.prisma, new AiProviderRegistry(), services.system);
    priced = new AiUsageService(services.prisma, new AiProviderRegistry(), services.system, new ExamplePricing());
    userId = (
      await client.user.create({ data: { email: `usage-feature-${model}@example.com` }, select: { id: true } })
    ).id;

    const common = { userId, orgId, provider, modelId: model, keySource: 'user' as const, latencyMs: 12, status: 'succeeded' as const };
    const at = (iso: string) => ({ createdAt: new Date(iso) });

    // The real write path: recorder.record() persists the feature column.
    await recorder.record({ ...common, operation: EXAMPLE_DIARIZE_OPERATION, feature: FEATURE, units: { audioSeconds: 1800 } });
    await recorder.record({ ...common, operation: EXAMPLE_DIARIZE_OPERATION, feature: FEATURE, units: { audioSeconds: 1800 } });
    await recorder.record({ ...common, operation: 'audio.transcribe', feature: FEATURE, units: { audioSeconds: 600 } });
    await recorder.record({ ...common, operation: 'audio.transcribe', units: { audioSeconds: 60 } });
    // A value that is not a feature id is stored as no feature, never as text.
    await recorder.record({ ...common, operation: 'audio.transcribe', feature: "x'; DROP TABLE ai_usage_events; --" });
    // Pin every row into the report's window (the recorder stamps "now").
    await client.aiUsageEvent.updateMany({ where: { modelId: model }, data: at('2026-09-20T10:00:00.000Z') });
  });

  afterAll(async () => {
    await client.aiUsageEvent.deleteMany({ where: { modelId: model } });
    await client.user.deleteMany({ where: { id: userId } });
    await services.close();
    await client.$disconnect();
  });

  const window = { from: '2026-09-01', to: '2026-09-30', provider, model };

  it('persists the feature column, and nothing else of the id', async () => {
    const rows = await client.aiUsageEvent.findMany({ where: { modelId: model }, select: { operation: true, feature: true }, orderBy: { createdAt: 'asc' } });

    expect(rows.map((row) => row.feature).sort((a, b) => String(a).localeCompare(String(b)))).toEqual([FEATURE, FEATURE, FEATURE, null, null]);
    expect(JSON.stringify(rows)).not.toContain('DROP TABLE');
  });

  it('groups by feature, labelled from the registry, with the events of no feature under `none`', async () => {
    const report = await plain.report({ ...window, groupBy: 'feature' }, NOW);

    expect(report.series.map((item) => [item.key, item.label, item.requests])).toEqual([
      [FEATURE, 'Example: meeting notes', 3],
      ['none', 'No feature', 2],
    ]);
    expect(report.totals.requests).toBe(5);
  });

  it('filters by feature: only that feature rows are counted, under every grouping', async () => {
    const report = await plain.report({ ...window, feature: FEATURE, groupBy: 'operation' }, NOW);

    expect(report.totals).toMatchObject({ requests: 3, units: { audioSeconds: 4200 } });
    expect(report.series.map((item) => [item.key, item.label, item.requests, item.units])).toEqual([
      [EXAMPLE_DIARIZE_OPERATION, 'Diarization', 2, { audioSeconds: 3600 }],
      ['audio.transcribe', 'Transcription', 1, { audioSeconds: 600 }],
    ]);
  });

  it('an injection attempt in the filter is a value, not SQL', async () => {
    const report = await plain.report({ ...window, feature: "x' OR '1'='1", groupBy: 'feature' }, NOW);

    expect(report.totals.requests).toBe(0);
  });

  it('prices the report through the bound port: per group and in total, from real units', async () => {
    const report = await priced.report({ ...window, groupBy: 'feature', withCost: true }, NOW);
    const ratePerSecond = 0.6 / 3600;

    expect(report.priced).toBe(true);
    // (3600 + 600) seconds under the feature, 60 under none.
    expect(report.series.find((item) => item.key === FEATURE)?.cost).toEqual({ amount: expect.closeTo(4200 * ratePerSecond, 10), currency: 'USD' });
    expect(report.series.find((item) => item.key === 'none')?.cost).toEqual({ amount: expect.closeTo(60 * ratePerSecond, 10), currency: 'USD' });
    expect(report.totals.cost).toEqual({ amount: expect.closeTo(4260 * ratePerSecond, 10), currency: 'USD' });
  });

  it('a report that does not ask for cost carries none, even with a port bound', async () => {
    const report = await priced.report({ ...window, groupBy: 'feature' }, NOW);

    expect(report).not.toHaveProperty('priced');
    expect(report.totals).not.toHaveProperty('cost');
  });
});
