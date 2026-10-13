import { BadRequestException, Logger } from '@nestjs/common';
import type { Prisma } from '../data/prisma';

import { registerAiCapability } from '../core/capability-registry';
import { registerAiOperation } from '../core/operation-registry';
import { registerAiFeature } from '../features/ai-feature.registry';
import { AiProviderRegistry } from '../core/provider-registry';
import type { AiPricing } from '../ports';
import { z } from 'zod';
import { FakeAiProvider } from '../testing/fake-ai-provider';
import { AI_USAGE_NO_USER_KEY, AiUsageService, emptyBucket, resolveAiUsageRange } from './ai-usage.service';

// Unit tests over fixture rows shaped exactly as the two `$queryRaw`
// statements return them. The SQL itself is exercised against a real
// Postgres by `test/ai/ai-usage.db.spec.ts`.

const NOW = new Date('2026-09-26T15:30:00.000Z');

function aggRow(key: string | null, over: Record<string, number> = {}, isTotal = 0) {
  return {
    is_total: isTotal,
    key,
    requests: 0,
    failed: 0,
    input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    cached_input_tokens: 0,
    org_requests: 0,
    org_input_tokens: 0,
    org_output_tokens: 0,
    ...over,
  };
}

describe('resolveAiUsageRange', () => {
  it('defaults to the last 30 UTC days ending today', () => {
    const range = resolveAiUsageRange(undefined, undefined, NOW);

    expect(range.from).toBe('2026-08-28');
    expect(range.to).toBe('2026-09-26');
    expect(range.start.toISOString()).toBe('2026-08-28T00:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-09-27T00:00:00.000Z');
  });

  it('defaults `from` relative to an explicit `to`', () => {
    expect(resolveAiUsageRange(undefined, '2026-03-31', NOW).from).toBe('2026-03-02');
  });

  it('accepts a single day and exactly 90 days', () => {
    expect(resolveAiUsageRange('2026-09-01', '2026-09-01', NOW).end.toISOString()).toBe(
      '2026-09-02T00:00:00.000Z',
    );
    expect(() => resolveAiUsageRange('2026-06-29', '2026-09-26', NOW)).not.toThrow();
  });

  it.each([
    ['a reversed range', '2026-09-10', '2026-09-01'],
    ['91 days', '2026-06-28', '2026-09-26'],
    ['an impossible date', '2026-02-30', '2026-03-01'],
    ['a default `to` with a `from` too far back', '2026-01-01', undefined],
  ])('refuses %s with 400 AI_USAGE_RANGE_INVALID', (_label, from, to) => {
    let error: unknown;
    try {
      resolveAiUsageRange(from, to, NOW);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      details: { reason: 'AI_USAGE_RANGE_INVALID' },
    });
  });
});

describe('AiUsageService.report', () => {
  let queryRaw: jest.Mock;
  let findUsers: jest.Mock;
  let service: AiUsageService;

  /** Script the two statements: aggregates first, units second (the order `report` issues them). */
  function script(aggregates: unknown[], units: unknown[] = []) {
    queryRaw.mockResolvedValueOnce(aggregates).mockResolvedValueOnce(units);
  }

  function sqlOf(call: number): Prisma.Sql {
    return queryRaw.mock.calls[call][0] as Prisma.Sql;
  }

  beforeEach(() => {
    queryRaw = jest.fn();
    findUsers = jest.fn().mockResolvedValue([]);
    const registry = new AiProviderRegistry();
    registry.register(new FakeAiProvider({ id: 'openai' }));
    service = new AiUsageService(
      { $queryRaw: queryRaw, user: { findMany: findUsers } } as never,
      registry,
      // The report is a deployment-wide aggregate: it reads through the system client (#725).
      { asSystem: () => ({ $queryRaw: queryRaw }) } as never,
    );
  });

  it('splits the GROUPING SETS rows into totals and groups, attaching units to each', async () => {
    script(
      [
        aggRow(null, { requests: 5, failed: 1, input_tokens: 300, output_tokens: 90, reasoning_tokens: 7, cached_input_tokens: 40, org_requests: 2, org_input_tokens: 100, org_output_tokens: 30 }, 1),
        aggRow('openai:gpt-a', { requests: 3, failed: 1, input_tokens: 200, output_tokens: 60, org_requests: 2, org_input_tokens: 100, org_output_tokens: 30 }),
        aggRow('openai:gpt-b', { requests: 2, input_tokens: 100, output_tokens: 30, reasoning_tokens: 7, cached_input_tokens: 40 }),
      ],
      [
        { is_total: 1, key: null, unit: 'images', amount: 3 },
        { is_total: 0, key: 'openai:gpt-b', unit: 'images', amount: 3 },
      ],
    );

    const report = await service.report({ groupBy: 'model', from: '2026-09-01', to: '2026-09-26' }, NOW);

    expect(report.range).toEqual({ from: '2026-09-01', to: '2026-09-26' });
    expect(report.groupBy).toBe('model');
    expect(report.totals).toEqual({
      requests: 5,
      failed: 1,
      inputTokens: 300,
      outputTokens: 90,
      reasoningTokens: 7,
      cachedInputTokens: 40,
      units: { images: 3 },
      orgKeyRequests: 2,
      orgKeyInputTokens: 100,
      orgKeyOutputTokens: 30,
    });
    expect(report.series).toEqual([
      expect.objectContaining({ key: 'openai:gpt-a', label: 'gpt-a', requests: 3, units: {}, orgKeyRequests: 2 }),
      expect.objectContaining({ key: 'openai:gpt-b', label: 'gpt-b', requests: 2, units: { images: 3 } }),
    ]);
  });

  it('returns an empty report (zero totals) when nothing was recorded', async () => {
    script([]);

    const report = await service.report({ groupBy: 'provider' }, NOW);

    expect(report.totals).toEqual(emptyBucket());
    expect(report.series).toEqual([]);
  });

  it('zero-fills a day series across the whole range, in order', async () => {
    script(
      [aggRow(null, { requests: 4 }, 1), aggRow('2026-09-02', { requests: 4, input_tokens: 10 })],
    );

    const report = await service.report({ groupBy: 'day', from: '2026-09-01', to: '2026-09-03' }, NOW);

    expect(report.series.map((s) => [s.key, s.label, s.requests, s.inputTokens])).toEqual([
      ['2026-09-01', '2026-09-01', 0, 0],
      ['2026-09-02', '2026-09-02', 4, 10],
      ['2026-09-03', '2026-09-03', 0, 0],
    ]);
  });

  it('labels user groups with their email, keys the null user `system`, and sorts by requests', async () => {
    script([
      aggRow(null, { requests: 6 }, 1),
      aggRow('u-1', { requests: 1 }),
      aggRow('u-2', { requests: 3 }),
      aggRow(null, { requests: 2 }),
    ]);
    findUsers.mockResolvedValue([
      { id: 'u-1', email: 'one@example.com' },
      { id: 'u-2', email: 'two@example.com' },
    ]);

    const report = await service.report({ groupBy: 'user' }, NOW);

    expect(findUsers).toHaveBeenCalledWith({
      where: { id: { in: ['u-1', 'u-2'] } },
      select: { id: true, email: true },
    });
    expect(report.series.map((s) => [s.key, s.label, s.requests])).toEqual([
      ['u-2', 'two@example.com', 3],
      [AI_USAGE_NO_USER_KEY, 'System (no user)', 2],
      ['u-1', 'one@example.com', 1],
    ]);
  });

  it('labels providers by adapter display name and key sources by description', async () => {
    script([aggRow(null, { requests: 1 }, 1), aggRow('openai', { requests: 1 }), aggRow('mystery', { requests: 1 })]);
    const byProvider = await service.report({ groupBy: 'provider' }, NOW);
    expect(byProvider.series.map((s) => s.label)).toEqual(['mystery', 'Fake AI']);

    script([aggRow(null, { requests: 3 }, 1), aggRow('org', { requests: 2 }), aggRow('user', { requests: 1 })]);
    const bySource = await service.report({ groupBy: 'keySource' }, NOW);
    expect(bySource.series.map((s) => [s.key, s.label])).toEqual([
      ['org', 'Organization key'],
      ['user', "User's own key"],
    ]);
  });

  it('binds the window and every filter as parameters, never as SQL text', async () => {
    script([]);

    await service.report(
      {
        groupBy: 'day',
        from: '2026-09-01',
        to: '2026-09-02',
        userId: '11111111-1111-4111-8111-111111111111',
        provider: "openai'; DROP TABLE users; --",
        model: 'gpt-a',
      },
      NOW,
    );

    for (const call of [0, 1]) {
      const sql = sqlOf(call);
      expect(sql.sql).toContain('user_id = ');
      expect(sql.sql).toContain('provider = ');
      expect(sql.sql).toContain('model_id = ');
      expect(sql.sql).not.toContain('DROP TABLE');
      expect(sql.values).toEqual(
        expect.arrayContaining([
          new Date('2026-09-01T00:00:00.000Z'),
          new Date('2026-09-03T00:00:00.000Z'),
          '11111111-1111-4111-8111-111111111111',
          "openai'; DROP TABLE users; --",
          'gpt-a',
        ]),
      );
    }
  });

  it('adds no user filter when none is asked for', async () => {
    script([]);

    await service.report({ groupBy: 'keySource' }, NOW);

    expect(sqlOf(0).sql).not.toContain('user_id =');
    expect(sqlOf(0).sql).toContain('GROUP BY GROUPING SETS ((key_source), ())');
  });
});

// ---- PP-14.17 (#935): per-feature usage and the pricing seam ------------------------

registerAiCapability({ id: 'usage_spec_capability', label: 'Usage spec', description: 'Only for this spec.' });
registerAiOperation({
  id: 'usage_spec.op',
  label: 'Usage spec operation',
  capability: 'usage_spec_capability',
  inputSchema: z.object({}),
  outputSchema: z.object({}),
});
registerAiFeature({ id: 'usage_spec_feature', label: 'Usage spec feature', needs: ['responses'] });

describe('AiUsageService.report: features, operations and pricing', () => {
  let queryRaw: jest.Mock;

  function build(pricing?: AiPricing) {
    queryRaw = jest.fn();
    const registry = new AiProviderRegistry();

    return new AiUsageService(
      { $queryRaw: queryRaw, forOrg: () => ({ $queryRaw: queryRaw }), user: { findMany: jest.fn().mockResolvedValue([]) } } as never,
      registry,
      { asSystem: () => ({ $queryRaw: queryRaw }) } as never,
      pricing,
    );
  }

  const slice = (key: string | null, provider: string, model: string, operation: string, over: Record<string, number> = {}) => ({
    key,
    provider,
    model_id: model,
    operation,
    requests: 1,
    input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    cached_input_tokens: 0,
    ...over,
  });

  it('groups by feature, labels a registered one, and keys events with none `none`', async () => {
    const service = build();

    queryRaw
      .mockResolvedValueOnce([aggRow('usage_spec_feature', { requests: 3 }), aggRow(null, { requests: 2 }), aggRow('removed_feature', { requests: 1 })].map((r) => r))
      .mockResolvedValueOnce([]);

    const report = await service.report({ groupBy: 'feature' }, NOW);

    expect(report.series.map((item) => [item.key, item.label])).toEqual([
      ['usage_spec_feature', 'Usage spec feature'],
      ['none', 'No feature'],
      ['removed_feature', 'removed_feature'],
    ]);
  });

  it('groups by operation and labels a registered operation', async () => {
    const service = build();

    queryRaw.mockResolvedValueOnce([aggRow('usage_spec.op', { requests: 4 }), aggRow('audio.transcribe', { requests: 2 })]).mockResolvedValueOnce([]);

    const report = await service.report({ groupBy: 'operation' }, NOW);

    expect(report.series.map((item) => [item.key, item.label])).toEqual([
      ['usage_spec.op', 'Usage spec operation'],
      ['audio.transcribe', 'Transcription'],
    ]);
  });

  it('binds the feature filter as a parameter, never as SQL text', async () => {
    const service = build();

    queryRaw.mockResolvedValue([]);
    await service.report({ groupBy: 'day', feature: "x'; DROP TABLE ai_usage_events; --" }, NOW);

    const sql = queryRaw.mock.calls[0][0] as Prisma.Sql;

    expect(sql.sql).toContain('AND feature = ?');
    expect(sql.sql).not.toContain('DROP TABLE');
    expect(sql.values).toContain("x'; DROP TABLE ai_usage_events; --");
  });

  it('carries no cost and no priced flag when no pricing port is bound', async () => {
    const service = build();

    queryRaw.mockResolvedValue([]);

    const report = await service.report({ groupBy: 'provider', withCost: true }, NOW);

    expect(report.priced).toBe(false);
    expect(report.totals).not.toHaveProperty('cost');
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it('prices a report that asks for cost: per group, per (provider, model, operation) slice, and in total', async () => {
    const costFor = jest.fn(async (usage) => ({ amount: usage.inputTokens / 1000 + (usage.units.audioSeconds ?? 0) / 100, currency: 'USD' }));
    const service = build({ costFor });

    queryRaw
      .mockResolvedValueOnce([aggRow(null, { requests: 3 }, 1), aggRow('usage_spec_feature', { requests: 2 }), aggRow(null, { requests: 1 })])
      .mockResolvedValueOnce([])
      // The slices at (group, provider, model, operation) grain, then their units.
      .mockResolvedValueOnce([
        slice('usage_spec_feature', 'openai', 'gpt-a', 'responses', { input_tokens: 2000 }),
        slice('usage_spec_feature', 'example-transcribe', 'asr', 'audio.transcribe'),
        slice(null, 'openai', 'gpt-a', 'responses', { input_tokens: 1000 }),
      ])
      .mockResolvedValueOnce([{ key: 'usage_spec_feature', provider: 'example-transcribe', model_id: 'asr', operation: 'audio.transcribe', unit: 'audioSeconds', amount: 50 }]);

    const report = await service.report({ groupBy: 'feature', withCost: true }, NOW);

    expect(report.priced).toBe(true);
    expect(report.totals.cost).toEqual({ amount: 3.5, currency: 'USD' });
    expect(Object.fromEntries(report.series.map((item) => [item.key, item.cost]))).toEqual({
      usage_spec_feature: { amount: 2.5, currency: 'USD' },
      none: { amount: 1, currency: 'USD' },
    });
    expect(costFor).toHaveBeenCalledWith({
      provider: 'example-transcribe',
      modelId: 'asr',
      operation: 'audio.transcribe',
      requests: 1,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedInputTokens: 0,
      units: { audioSeconds: 50 },
    });
  });

  it('a slice the port does not price, or prices in a second currency, never invents a cost', async () => {
    const costFor = jest.fn(async (usage) => (usage.modelId === 'free' ? null : { amount: 1, currency: usage.modelId === 'euro' ? 'EUR' : 'USD' }));
    const service = build({ costFor });

    queryRaw
      .mockResolvedValueOnce([aggRow('a', { requests: 1 }), aggRow('b', { requests: 1 }), aggRow('c', { requests: 1 })])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([slice('a', 'openai', 'free', 'responses'), slice('b', 'openai', 'euro', 'responses'), slice('b', 'openai', 'usd', 'responses'), slice('c', 'openai', 'usd', 'responses')])
      .mockResolvedValueOnce([]);

    const report = await service.report({ groupBy: 'model', withCost: true }, NOW);
    const costs = Object.fromEntries(report.series.map((item) => [item.key, item.cost]));

    expect(costs).toEqual({ a: null, b: null, c: { amount: 1, currency: 'USD' } });
    expect(report.totals.cost).toBeNull();
  });

  it('a throwing port is a missing price, logged without the usage, and the report still answers', async () => {
    const costFor = jest.fn(async () => {
      throw new Error('rate card offline: SENSITIVE');
    });
    const service = build({ costFor });
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    queryRaw
      .mockResolvedValueOnce([aggRow('a', { requests: 1 })])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([slice('a', 'openai', 'gpt', 'responses')])
      .mockResolvedValueOnce([]);

    const report = await service.report({ groupBy: 'model', withCost: true }, NOW);

    expect(report.series[0].cost).toBeNull();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SENSITIVE');
    warn.mockRestore();
  });

  it('a user\'s own report (no withCost) is never priced even when a port is bound', async () => {
    const costFor = jest.fn();
    const service = build({ costFor });

    queryRaw.mockResolvedValue([]);

    const report = await service.report({ groupBy: 'day', userId: 'u1' }, NOW, 'org-1');

    expect(report).not.toHaveProperty('priced');
    expect(costFor).not.toHaveBeenCalled();
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });
});
