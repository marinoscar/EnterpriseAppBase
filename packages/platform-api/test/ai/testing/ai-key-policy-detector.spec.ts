import { keysSeenBy } from '../../../src/ai/testing';
import {
  createAiRuntimeHarness,
  HARNESS_MODEL,
  HARNESS_ORG_KEY,
  HARNESS_USER,
  HARNESS_USER_KEY,
} from '../../../src/ai/testing';

// Known-bad proof for the `ai-key-policy` suite. The suite's assertion is about
// what the fake provider received: `keysSeenBy(fake, [orgKey])` must be empty
// when the call is a user's own. Here the REAL runtime (the same harness the
// suite boots behind HTTP) is put under a policy that DOES spend the org key,
// and the detector must see it; under `byok` it must not.

const hello = { model: HARNESS_MODEL, input: 'hello' };

describe('the ai-key-policy detector over the real AI runtime', () => {
  it('sees the org key when a policy spends it (byok_with_org_fallback, caller has no key)', async () => {
    const h = createAiRuntimeHarness({ userKey: false, orgKey: true, policy: { keyPolicy: 'byok_with_org_fallback' } });

    await h.ai.forUser(HARNESS_USER).respond(hello);

    expect(keysSeenBy(h.fake, [HARNESS_ORG_KEY])).toEqual([HARNESS_ORG_KEY]);
  });

  it('sees nothing under byok: the call is refused and the org key is never handed to the fake', async () => {
    const h = createAiRuntimeHarness({ userKey: false, orgKey: true, policy: { keyPolicy: 'byok' } });

    await expect(h.ai.forUser(HARNESS_USER).respond(hello)).rejects.toMatchObject({ code: 'AI_KEY_REQUIRED' });

    expect(keysSeenBy(h.fake, [HARNESS_ORG_KEY])).toEqual([]);
  });

  it('sees the org key if the resolver were sabotaged to hand it to a user who has their own key', async () => {
    const h = createAiRuntimeHarness({ orgKey: true, policy: { keyPolicy: 'byok_with_org_fallback' } });
    // Sabotage: the user's key is hidden, so the resolver falls through to the org key.
    h.removeUserKeys(HARNESS_USER);

    await h.ai.forUser(HARNESS_USER).respond(hello);

    expect(keysSeenBy(h.fake, [HARNESS_ORG_KEY])).toEqual([HARNESS_ORG_KEY]);
    expect(keysSeenBy(h.fake, [HARNESS_USER_KEY])).toEqual([]);
  });

  it('reports only the keys that were seen', () => {
    expect(keysSeenBy({ apiKeys: ['a', 'b'] }, ['b', 'c'])).toEqual(['b']);
    expect(keysSeenBy({ apiKeys: [] }, ['b'])).toEqual([]);
  });
});
