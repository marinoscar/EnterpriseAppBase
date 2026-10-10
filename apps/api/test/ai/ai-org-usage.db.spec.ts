// =============================================================================
// Per-organization AI usage and caps against real Postgres (issue #739)
// =============================================================================
//
// Two organizations, one deployment:
//   - every inference row carries `org_id` (the usage recorder writes it);
//   - the system report filters by `orgId` and groups by `org`; the
//     organization report (`/api/admin/ai/org-usage`) reads through that
//     organization's own scope and sees only its rows;
//   - `limits.perOrg.requestsPerDay` refuses one organization (429
//     AI_RATE_LIMITED) and not the other, and an organization's own layer
//     can lower it but not raise it.
// =============================================================================

import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import {
  AiConfigService,
  AiError,
  AiLimitsService,
  AiProviderRegistry,
  AiUsageRecorder,
  AiUsageService,
  type AiPolicy,
} from '@marinoscar/platform-api/ai';

import { createDbClient, createDbServices, defaultOrgId, resolveDbSuite } from '../jobs/db-test-support';

const { describeWithDb } = resolveDbSuite('ai-org-usage.db.spec');

function policy(limits: AiPolicy['limits']): AiPolicy {
  return {
    enabled: true,
    keyPolicy: 'byok',
    providers: {
      openai: { enabled: true },
      anthropic: { enabled: false },
      gemini: { enabled: false },
      'azure-openai': { enabled: false },
      'openai-compatible': { enabled: false },
    },
    defaults: { allowBackgroundRuns: true, allowRealtime: false },
    logPromptContent: false,
    usageRetentionDays: 180,
    hostedTools: { web_search: false, file_search: false, code_interpreter: false, image_generation: false, mcp: false, mcpAllowedHosts: [] },
    limits,
    deploymentKeyServesOrgs: true,
  };
}

describeWithDb('per-organization AI usage and caps (real Postgres, #739)', () => {
  let client: PrismaClient;
  let services: ReturnType<typeof createDbServices>;
  let orgA: string;
  let orgB: string;
  let alice: string;
  let bob: string;
  const provider = `orgspec-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    client = createDbClient();
    services = createDbServices();
    orgA = await defaultOrgId(client);
    const created = await client.organization.create({
      data: { name: `Org B ${provider}`, slug: `org-b-${provider}`.slice(0, 63) },
      select: { id: true },
    });
    orgB = created.id;
    alice = (await client.user.create({ data: { email: `alice-${provider}@example.com` }, select: { id: true } })).id;
    bob = (await client.user.create({ data: { email: `bob-${provider}@example.com` }, select: { id: true } })).id;

    // The recorder writes `org_id` on every inference row.
    const recorder = new AiUsageRecorder(services.prisma as never);
    const call = (userId: string, orgId: string) =>
      recorder.record({
        userId,
        orgId,
        provider,
        modelId: 'm-1',
        operation: 'responses',
        keySource: 'user',
        usage: { inputTokens: 10, outputTokens: 5 },
        latencyMs: 12,
        status: 'succeeded',
      });
    await call(alice, orgA);
    await call(alice, orgA);
    await call(bob, orgB);
  });

  afterAll(async () => {
    await client.aiUsageEvent.deleteMany({ where: { provider } });
    await client.user.deleteMany({ where: { id: { in: [alice, bob] } } });
    await client.organization.delete({ where: { id: orgB } });
    await services.close();
    await client.$disconnect();
  });

  it('writes org_id for every inference', async () => {
    const rows = await client.aiUsageEvent.findMany({ where: { provider }, select: { orgId: true, userId: true } });
    expect(rows).toHaveLength(3);
    expect(rows.filter((row) => row.orgId === orgA)).toHaveLength(2);
    expect(rows.filter((row) => row.orgId === orgB)).toHaveLength(1);
  });

  it('the system report filters by orgId and groups by org', async () => {
    const usage = new AiUsageService(services.prisma as never, new AiProviderRegistry(), services.system as never);
    const today = new Date().toISOString().slice(0, 10);

    const onlyB = await usage.report({ groupBy: 'day', provider, orgId: orgB, from: today, to: today });
    expect(onlyB.totals.requests).toBe(1);

    const byOrg = await usage.report({ groupBy: 'org', provider, from: today, to: today });
    expect(byOrg.series.map((s) => [s.key, s.requests]).sort()).toEqual([
      [orgA, 2],
      [orgB, 1],
    ].sort());
    expect(byOrg.series.find((s) => s.key === orgB)?.label).toBe(`Org B ${provider}`);
  });

  it("the organization report (its own scope) sees only that organization's rows", async () => {
    const usage = new AiUsageService(services.prisma as never, new AiProviderRegistry(), services.system as never);
    const today = new Date().toISOString().slice(0, 10);

    const a = await usage.report({ groupBy: 'user', provider, orgId: orgA, from: today, to: today }, new Date(), orgA);
    expect(a.totals.requests).toBe(2);
    expect(a.series.map((s) => s.key)).toEqual([alice]);
  });

  describe('limits.perOrg.requestsPerDay', () => {
    function limitsService(limits: AiPolicy['limits'], orgLayers: Record<string, Record<string, unknown>> = {}) {
      const aiConfig = new AiConfigService(
        { getAiPolicy: async () => policy(limits) } as never,
        {} as never,
        new AiProviderRegistry(),
        { isEnabled: () => true, getNamespace: async (orgId: string) => orgLayers[orgId] } as never,
      );
      return new AiLimitsService(services.prisma as never, aiConfig, () => Date.now());
    }

    const callIn = (orgId: string, userId: string) => ({ userId, orgId, provider, modelId: 'm-1', keySource: 'user' as const });

    it('returns 429 AI_RATE_LIMITED for that organization only', async () => {
      const limits = limitsService({ perOrg: { requestsPerDay: 2 } });

      const refused = await limits.enforce(callIn(orgA, bob)).catch((e: unknown) => e);
      expect(refused).toBeInstanceOf(AiError);
      expect((refused as AiError).code).toBe('AI_RATE_LIMITED');
      expect((refused as AiError).getStatus()).toBe(429);
      expect((refused as AiError).toJSON().details).toMatchObject({ limit: 'perOrg.requestsPerDay', scope: 'org' });

      await expect(limits.enforce(callIn(orgB, bob))).resolves.toBeUndefined();
    });

    it('an organization can lower the cap but not raise it', async () => {
      await expect(
        limitsService({ perOrg: { requestsPerDay: 5 } }, { [orgB]: { limits: { perOrg: { requestsPerDay: 1 } } } }).enforce(callIn(orgB, bob)),
      ).rejects.toBeInstanceOf(AiError);

      await expect(
        limitsService({ perOrg: { requestsPerDay: 2 } }, { [orgA]: { limits: { perOrg: { requestsPerDay: 100 } } } }).enforce(callIn(orgA, alice)),
      ).rejects.toBeInstanceOf(AiError);
    });
  });
});
