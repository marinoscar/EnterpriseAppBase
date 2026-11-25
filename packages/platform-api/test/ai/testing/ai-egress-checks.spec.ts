import { z } from 'zod';

import {
  findKeyShapedProperties,
  findLeakedSentinels,
  findSecretShapedProperties,
  collectPropertyNames,
} from '../../../src/ai/testing';
import { aiConfigResponseSchema, aiRealtimeSessionResponseSchema } from '../../../src/ai';

// Known-bad proof for the `ai-secret-egress` suite: a response schema shaped to
// publish a key back out, and a capture that carries a sentinel.

describe('ai-secret-egress detectors', () => {
  const planted = z.object({
    id: z.string(),
    nested: z.object({ items: z.array(z.object({ apiKey: z.string() })) }),
  });

  it('flag a response schema with a key-shaped property, however deeply nested', () => {
    expect(findKeyShapedProperties(planted)).toEqual(['apiKey']);
    expect(findKeyShapedProperties(z.object({ rows: z.record(z.string(), z.object({ Token: z.string() })) }))).toEqual(['Token']);
    expect(findKeyShapedProperties(z.union([z.object({ a: z.string() }), z.object({ password: z.string() })]).optional())).toEqual(['password']);
  });

  it('pass a response schema that publishes only a hint', () => {
    expect(findKeyShapedProperties(z.object({ hint: z.string(), provider: z.string() }))).toEqual([]);
    expect(findKeyShapedProperties(aiConfigResponseSchema)).toEqual([]);
  });

  it('list every credential-shaped name, so the realtime allowlist is the only one', () => {
    expect(findSecretShapedProperties({ AiRealtimeSessionResponseDto: aiRealtimeSessionResponseSchema })).toEqual([
      'AiRealtimeSessionResponseDto.clientSecret',
    ]);
    expect(findSecretShapedProperties({ Planted: planted })).toEqual(['Planted.apiKey']);
  });

  it('walk names, not values', () => {
    expect(collectPropertyNames(planted)).toEqual(['id', 'nested', 'items', 'apiKey']);
  });

  it('find a sentinel in a captured body, and only that one', () => {
    const sentinels = ['sk-user-own-key-1111', 'sk-org-admin-key-9999'];

    expect(findLeakedSentinels(JSON.stringify({ error: 'upstream rejected sk-org-admin-key-9999' }), sentinels)).toEqual([
      'sk-org-admin-key-9999',
    ]);
    expect(findLeakedSentinels('{"hint":"••••1111"}', sentinels)).toEqual([]);
  });
});
