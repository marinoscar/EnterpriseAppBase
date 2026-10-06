// =============================================================================
// Retention purge handlers — registration in the real module graph (#681)
// =============================================================================
//
// The unit specs construct each handler by hand; this boots the application
// module and asserts what the worker and the node claim actually see: every
// retention type registered, server-only (`JobHandlerRegistry.serverOnlyTypes()`,
// the derivation the node plane reads) and carrying the declared profile.
// =============================================================================

import { JobHandlerRegistry } from '../../src/jobs/job-handler.registry';
import { jobTypeLabel } from '../../src/jobs/job-type-labels';
import { RETENTION_PURGES } from '../../src/common/retention/retention-purge.task';
import { closeTestApp, createTestApp, type TestContext } from '../helpers/test-app.helper';

const RETENTION_TYPES = [
  'notifications.inbox.purge',
  'notifications.deliveries.purge',
  'audit.events.purge',
  'ai.runs.purge',
];

describe('retention purge handlers in the application module (#681)', () => {
  let context: TestContext;
  let registry: JobHandlerRegistry;

  beforeAll(async () => {
    context = await createTestApp();
    registry = context.app.get(JobHandlerRegistry);
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(context);
  });

  it('the task schedules exactly these four types', () => {
    expect(RETENTION_PURGES.map((purge) => purge.type)).toEqual(RETENTION_TYPES);
  });

  it.each(RETENTION_TYPES)('%s is registered, server-only, and declares its profile', (type) => {
    const handler = registry.get(type);

    expect(handler).toBeDefined();
    expect(registry.serverOnlyTypes()).toContain(type);
    expect(handler!.nodeResultSchema).toBeUndefined();
    expect(handler!.persistNodeResult).toBeUndefined();
    expect(handler!.profile).toEqual({ maxRuntimeMs: 1_800_000, maxAttempts: 3 });
  });

  it.each(RETENTION_TYPES)('%s has a readable label in the admin job list', (type) => {
    expect(jobTypeLabel(type)).not.toBe(type);
  });
});
