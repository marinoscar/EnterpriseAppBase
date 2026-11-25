// Per-organization daily caps (issue #739): `ai.limits.perOrg` counts every
// member's calls in ONE organization per UTC day, refuses with the same
// 429 AI_RATE_LIMITED contract as the per-user windows, and an
// organization's own layer can only lower it.

import type { SystemAiLimitsValue } from '@marinoscar/platform-contract/ai';

import { AiError } from '../core/ai-error';
import { createAiRuntimeHarness, HARNESS_MODEL, HARNESS_ORG, HARNESS_OTHER_USER, HARNESS_USER } from '../testing/ai-runtime-harness';
import { AiLimitsService, type AiLimitCall } from './ai-limits.service';
import { AiConfigService } from '../config/ai-config.service';

const T0 = Date.UTC(2026, 8, 26, 12, 0, 0);
const OTHER_ORG = '44444444-4444-4444-8444-444444444444';

function setup(limits: SystemAiLimitsValue, orgLayer: Record<string, Record<string, unknown>> = {}) {
  const h = createAiRuntimeHarness({ policy: { limits }, clock: () => T0 });
  // The harness's AiConfigService has no org layer; give the limits service one that does.
  const orgSettings = { isEnabled: () => true, getNamespace: async (orgId: string) => orgLayer[orgId] };
  const aiConfig = new AiConfigService(
    { getAiPolicy: async () => h.aiConfig.resolve() } as never,
    {} as never,
    h.registry,
    orgSettings as never,
  );
  const limitsService = new AiLimitsService(h.prisma as never, aiConfig, () => T0);
  const row = (fields: Record<string, unknown>) =>
    h.usageEvents.push({
      userId: HARNESS_USER,
      orgId: HARNESS_ORG,
      provider: 'openai',
      modelId: HARNESS_MODEL,
      operation: 'responses',
      keySource: 'user',
      status: 'succeeded',
      inputTokens: null,
      outputTokens: null,
      createdAt: new Date(T0 - 60_000),
      ...fields,
    });
  return { h, limitsService, row };
}

const call = (userId: string, orgId = HARNESS_ORG): AiLimitCall => ({
  userId,
  orgId,
  provider: 'openai',
  modelId: HARNESS_MODEL,
  keySource: 'user',
});

async function refused(promise: Promise<unknown>): Promise<AiError> {
  const err = await promise.then(
    () => new Error('admitted'),
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AiError);
  expect((err as AiError).code).toBe('AI_RATE_LIMITED');
  expect((err as AiError).getStatus()).toBe(429);
  return err as AiError;
}

describe('AiLimitsService per-org windows (#739)', () => {
  it('perOrg.requestsPerDay counts every member of the organization, and refuses that organization only', async () => {
    const { limitsService, row } = setup({ perOrg: { requestsPerDay: 2 } });
    row({ userId: HARNESS_USER });
    row({ userId: HARNESS_OTHER_USER });
    // Another organization's calls are not this organization's budget.
    row({ userId: HARNESS_USER, orgId: OTHER_ORG });
    row({ userId: HARNESS_USER, orgId: OTHER_ORG });

    const err = await refused(limitsService.enforce(call(HARNESS_OTHER_USER)));
    expect(err.toJSON().details).toMatchObject({ limit: 'perOrg.requestsPerDay', max: 2, window: 'day', scope: 'org' });

    // The other organization has spent only 2 of its own 2: refused too, but a third org is free.
    await refused(limitsService.enforce(call(HARNESS_USER, OTHER_ORG)));
    await expect(limitsService.enforce(call(HARNESS_USER, '55555555-5555-4555-8555-555555555555'))).resolves.toBeUndefined();
  });

  it('counts only today (UTC)', async () => {
    const { limitsService, row } = setup({ perOrg: { requestsPerDay: 1 } });
    row({ createdAt: new Date(T0 - 24 * 60 * 60 * 1000) });
    await expect(limitsService.enforce(call(HARNESS_USER))).resolves.toBeUndefined();
  });

  it('perOrg.outputTokensPerDay sums output tokens only', async () => {
    const { limitsService, row } = setup({ perOrg: { outputTokensPerDay: 100 } });
    row({ inputTokens: 1_000, outputTokens: 60 });
    await expect(limitsService.enforce(call(HARNESS_USER))).resolves.toBeUndefined();
    row({ userId: HARNESS_OTHER_USER, outputTokens: 40 });
    const err = await refused(limitsService.enforce(call(HARNESS_USER)));
    expect(err.toJSON().details).toMatchObject({ limit: 'perOrg.outputTokensPerDay', max: 100 });
  });

  it("an organization's own layer can lower the cap, never raise it", async () => {
    const lowered = setup({ perOrg: { requestsPerDay: 5 } }, { [HARNESS_ORG]: { limits: { perOrg: { requestsPerDay: 1 } } } });
    lowered.row({});
    await refused(lowered.limitsService.enforce(call(HARNESS_USER)));

    const raised = setup({ perOrg: { requestsPerDay: 1 } }, { [HARNESS_ORG]: { limits: { perOrg: { requestsPerDay: 50 } } } });
    raised.row({});
    await refused(raised.limitsService.enforce(call(HARNESS_USER)));
  });

  it('an organization may cap itself where the deployment set no cap', async () => {
    const { limitsService, row } = setup({}, { [HARNESS_ORG]: { limits: { perOrg: { requestsPerDay: 1 } } } });
    row({});
    await refused(limitsService.enforce(call(HARNESS_USER)));
  });
});
