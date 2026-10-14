// =============================================================================
// The runtime harness over a provider an app adds (PP-14.6, issue #924)
// =============================================================================
//
// `createAiRuntimeHarness({ extraProviders, extraAdapters })` runs the real gate
// pipeline (kill switch, provider switch, key policy, usage) over a provider
// that is not `openai`, so its author can prove the provider works with the
// other slices without booting the application.
// =============================================================================

import { Module } from '@nestjs/common';
import { z } from 'zod';

import { parseStoredTranscriptionRunRequest } from '../../../src/ai/runtime/ai-audio-run-request';
import {
  createAiRuntimeHarness,
  FakeAiProvider,
  FAKE_TRANSCRIPTION_MODEL_CAPABILITIES,
  HARNESS_ORG,
  HARNESS_ORG_KEY,
  HARNESS_TENANT_KEY,
  HARNESS_USER,
  HARNESS_USER_KEY,
} from '../../../src/ai/testing/index';
import { aiProviderKind, type AiProviderDefinition } from '../../../src/ai/providers/ai-provider-definition';

@Module({})
class AcmeModule {}

const ACME: AiProviderDefinition = {
  id: 'acme-asr',
  label: 'Acme ASR',
  module: AcmeModule,
  settingsSchema: z.object({ region: z.enum(['us', 'eu']).default('us') }),
  defaults: { region: 'us' },
  requiresKey: true,
};
const ACME_MODEL = 'acme-asr-1';
const RECORDING = Buffer.from('0123456789'.repeat(100));

function setup(options: Parameters<typeof createAiRuntimeHarness>[0] = {}) {
  const acme = new FakeAiProvider({ id: 'acme-asr', displayName: 'Acme ASR', models: [ACME_MODEL], audioPort: true, responsesPort: false, classify: () => FAKE_TRANSCRIPTION_MODEL_CAPABILITIES });
  const h = createAiRuntimeHarness({
    extraProviders: [ACME],
    extraAdapters: [acme],
    models: [{ modelId: ACME_MODEL, provider: 'acme-asr', capabilities: FAKE_TRANSCRIPTION_MODEL_CAPABILITIES }],
    ...options,
  });
  const transcribe = async () => {
    const object = h.storage.addObject({ uploadedById: HARNESS_USER, bytes: RECORDING, mimeType: 'audio/mpeg', name: 'memo.mp3' });
    const handle = await h.ai.forUser(HARNESS_USER).transcribe({ storageObjectId: object.id, provider: 'acme-asr', model: ACME_MODEL });
    const stored = parseStoredTranscriptionRunRequest(h.runRows.find((r) => r.id === handle.runId)!.request);
    return h.ai.executeTranscriptionRun(HARNESS_USER, stored, { jobId: 'job-1' });
  };

  return { h, acme, transcribe };
}

describe('createAiRuntimeHarness({ extraProviders, extraAdapters })', () => {
  it('registers the definition once and gives the provider an enabled slot with its defaults', () => {
    const { h } = setup();

    expect(aiProviderKind.has('acme-asr')).toBe(true);
    expect(h.registry.ids()).toEqual(['openai', 'acme-asr']);
    expect(h.policy.providers['acme-asr']).toEqual({ enabled: true, region: 'us' });
    // A second harness reuses the registered definition.
    expect(() => setup()).not.toThrow();
  });

  it('merges extraProviderSettings over the definition defaults', () => {
    const { h } = setup({ extraProviderSettings: { 'acme-asr': { region: 'eu' } } });

    expect(h.policy.providers['acme-asr']).toEqual({ enabled: true, region: 'eu' });
  });

  it("runs a call through the provider's adapter with the user's key and meters it under the provider", async () => {
    const { h, acme, transcribe } = setup();

    await transcribe();

    const [call] = acme.callsTo('audio.transcribe');
    expect(call?.apiKey).toBe(`${HARNESS_USER_KEY}-acme-asr`);
    expect(call?.providerSettings).toEqual({ region: 'us' });
    expect(h.fake.callsTo('audio.transcribe')).toHaveLength(0);
    expect(h.usageEvents).toEqual([expect.objectContaining({ provider: 'acme-asr', modelId: ACME_MODEL, operation: 'audio.transcribe', keySource: 'user' })]);
  });

  it('applies the kill switch and the provider switch to it', async () => {
    const off = setup();
    off.h.setPolicy({ enabled: false });
    await expect(off.transcribe()).rejects.toMatchObject({ code: 'AI_DISABLED' });

    const noSlot = setup();
    noSlot.h.policy.providers['acme-asr'] = { enabled: false, region: 'us' };
    noSlot.h.aiConfig.invalidateCache();
    await expect(noSlot.transcribe()).rejects.toMatchObject({ code: 'AI_PROVIDER_DISABLED' });
  });

  it("applies the key policy: a user's own key wins, then the organization's, then the deployment's", async () => {
    const { h, acme, transcribe } = setup({ orgKey: true });
    h.setPolicy({ keyPolicy: 'byok_with_org_fallback' });
    h.setTenantKey(HARNESS_ORG, HARNESS_TENANT_KEY, 'acme-asr');

    await transcribe();
    expect(acme.callsTo('audio.transcribe').at(-1)?.apiKey).toBe(`${HARNESS_USER_KEY}-acme-asr`);

    h.removeUserKeys(HARNESS_USER);
    await transcribe();
    expect(acme.callsTo('audio.transcribe').at(-1)?.apiKey).toBe(HARNESS_TENANT_KEY);

    h.setTenantKey(HARNESS_ORG, null, 'acme-asr');
    await transcribe();
    expect(acme.callsTo('audio.transcribe').at(-1)?.apiKey).toBe(HARNESS_ORG_KEY);
  });

  it('a harness without extras is unchanged', () => {
    const h = createAiRuntimeHarness();

    expect(h.registry.ids()).toEqual(['openai']);
    expect(Object.keys(h.policy.providers)).toEqual(['openai', 'anthropic', 'gemini', 'azure-openai', 'openai-compatible']);
  });
});
