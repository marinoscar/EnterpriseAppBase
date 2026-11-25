// A worked example of the alerts extension points (#1047): an app registers its
// own rule kind and the evaluator treats it like a built-in one.
import { z } from 'zod';
import {
  AlertContextService,
  AlertsDispatchService,
  AlertsEvaluationService,
  AlertsMetrics,
  alertRuleKindRegistry,
  registerAlertRuleKind,
  resolveAlertsModuleOptions,
} from '@marinoscar/platform-api/alerts';
import { createInMemoryAlertsPrisma } from '@marinoscar/platform-api/alerts/testing';

const KIND = 'example_queue_stuck';

describe('registerAlertRuleKind (example)', () => {
  it('a custom kind is validated, evaluated and listed like a built-in', async () => {
    if (!alertRuleKindRegistry.has(KIND)) {
      registerAlertRuleKind({
        id: KIND,
        label: 'Queue stuck',
        description: 'Jobs are pending and none is running.',
        configSchema: z.object({ minPending: z.number().int().min(1).default(10) }).strict(),
        evaluate: async (_ctx, rule) => [{ labels: {}, value: rule.config.minPending, breached: true, summary: `${rule.name}: stuck` }],
        describe: (rule) => `At least ${rule.config.minPending} jobs pending and none running`,
      });
    }
    expect(alertRuleKindRegistry.get(KIND)!.configSchema.parse({})).toEqual({ minPending: 10 });
    expect(alertRuleKindRegistry.get(KIND)!.configSchema.safeParse({ minPending: 0 }).success).toBe(false);

    const prisma = createInMemoryAlertsPrisma();
    const rule = prisma.addRule({ kind: KIND, name: 'Queue', config: { minPending: 5 } });
    const dispatcher = new AlertsDispatchService(new AlertsMetrics(prisma));
    const evaluation = new AlertsEvaluationService(prisma, new AlertContextService(prisma), dispatcher, resolveAlertsModuleOptions());
    expect(await evaluation.evaluateRule(rule)).toMatchObject({ status: 'ok', fired: 1 });
    expect(prisma.incidents[0]).toMatchObject({ state: 'firing', lastValue: 5 });
  });
});
