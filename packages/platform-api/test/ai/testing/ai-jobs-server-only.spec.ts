import { z } from 'zod';

import { JobHandlerRegistry } from '../../../src/jobs/index';
import { findAiJobsMissingFromServerOnly, findNodeEligibleAiJobs } from '../../../src/ai/testing';

// Known-bad proof for the `ai-jobs-server-only` suite: the real registry, with an
// ai.* handler that a worker node could run. The suite's two checks must name it.

const handler = (type: string, extra: Record<string, unknown> = {}) =>
  ({ type, process: async () => undefined, ...extra }) as never;

describe('ai-jobs-server-only detectors', () => {
  it('pass a registry whose ai.* handlers are server-only, and ignore other prefixes', () => {
    const registry = new JobHandlerRegistry();
    registry.register(handler('ai.fixture.run'));
    // A non-ai type may be node-eligible: not this suite's business.
    registry.register(handler('export.csv', { nodeResultSchema: z.object({}), persistNodeResult: async () => undefined }));

    expect(findNodeEligibleAiJobs(registry)).toEqual([]);
    expect(findAiJobsMissingFromServerOnly(registry)).toEqual([]);
  });

  it('name an ai.* handler carrying both node members (the key would reach a node)', () => {
    const registry = new JobHandlerRegistry();
    registry.register(
      handler('ai.fixture.node', { nodeResultSchema: z.object({}), persistNodeResult: async () => undefined }),
    );

    expect(findNodeEligibleAiJobs(registry)).toEqual([
      "ai.fixture.node: carries nodeResultSchema — a user's/admin's provider key must never reach a node",
      "ai.fixture.node: carries persistNodeResult — a user's/admin's provider key must never reach a node",
    ]);
    // The registry derives it as node-eligible, so it is not in serverOnlyTypes().
    expect(findAiJobsMissingFromServerOnly(registry)).toEqual(['ai.fixture.node']);
  });

  it('name an ai.* handler carrying exactly one of the two members, even though the registry still calls it server-only', () => {
    const registry = new JobHandlerRegistry();
    registry.register(handler('ai.fixture.half', { persistNodeResult: async () => undefined }));

    expect(findAiJobsMissingFromServerOnly(registry)).toEqual([]);
    expect(findNodeEligibleAiJobs(registry)).toEqual([
      "ai.fixture.half: carries persistNodeResult — a user's/admin's provider key must never reach a node",
    ]);
  });

  it('name a type the registry lists but cannot return', () => {
    expect(
      findNodeEligibleAiJobs({ types: () => ['ai.ghost'], get: () => undefined, serverOnlyTypes: () => ['ai.ghost'] }),
    ).toEqual(['ai.ghost: registered in types() but get() returned nothing']);
  });
});
