// The AI slice's wire contract (issue #739): the `ai` namespace schemas, the
// org layer and its tighten-only merge, the org-key and feature shapes.
import { describe, expect, it } from 'vitest';

import {
  AI_PROVIDER_ID_PATTERN,
  AI_PROVIDER_IDS,
  AI_SETTINGS_CARRIES_NO_SECRET,
  BUILTIN_AI_PROVIDER_IDS,
  ORG_AI_KEY_VIEW_CARRIES_NO_SECRET,
  aiFeatureViewSchema,
  aiProviderIdSchema,
  aiProvidersResponseSchema,
  aiSettingsPatchSchema,
  aiSettingsSchema,
  orgAiKeyViewSchema,
  orgAiSettingsSchema,
  setOrgAiKeySchema,
  systemAiPatchSchema,
  systemAiSchema,
  tightenAiPolicy,
  type SystemAiValue,
} from '../src/ai/index.js';

const SYSTEM: SystemAiValue = {
  enabled: true,
  keyPolicy: 'byok_with_org_fallback',
  providers: {
    openai: { enabled: true },
    anthropic: { enabled: true },
    gemini: { enabled: false },
    'azure-openai': { enabled: false },
    'openai-compatible': { enabled: false },
  },
  defaults: { allowBackgroundRuns: true, allowRealtime: false },
  logPromptContent: false,
  usageRetentionDays: 180,
  hostedTools: {
    web_search: false,
    file_search: false,
    code_interpreter: false,
    image_generation: false,
    mcp: false,
    mcpAllowedHosts: [],
  },
  limits: { perOrg: { requestsPerDay: 100 } },
  deploymentKeyServesOrgs: true,
};

describe('ai settings contract', () => {
  it('the stored schema accepts the defaults shape, with the per-org cap and deploymentKeyServesOrgs', () => {
    expect(systemAiSchema.parse(SYSTEM)).toEqual(SYSTEM);
    expect(AI_SETTINGS_CARRIES_NO_SECRET).toBe(true);
  });

  it('the org layer refuses a secret-looking or unknown field and accepts only overrides', () => {
    expect(orgAiSettingsSchema.parse({})).toEqual({});
    expect(orgAiSettingsSchema.safeParse({ keyPolicy: 'nope' }).success).toBe(false);
    expect(orgAiSettingsSchema.parse({ apiKey: 'x' } as never)).toEqual({});
  });
});

describe('tightenAiPolicy (an organization can only tighten)', () => {
  it('turns AI off for the organization, never on', () => {
    expect(tightenAiPolicy(SYSTEM, { enabled: false }).enabled).toBe(false);
    expect(tightenAiPolicy({ ...SYSTEM, enabled: false }, { enabled: true }).enabled).toBe(false);
  });

  it('narrows keyPolicy to byok, never widens it', () => {
    expect(tightenAiPolicy(SYSTEM, { keyPolicy: 'byok' }).keyPolicy).toBe('byok');
    expect(tightenAiPolicy({ ...SYSTEM, keyPolicy: 'byok' }, { keyPolicy: 'byok_with_org_fallback' }).keyPolicy).toBe('byok');
  });

  it('lowers the per-org caps, never raises them; can set one the deployment left unlimited', () => {
    expect(tightenAiPolicy(SYSTEM, { limits: { perOrg: { requestsPerDay: 10 } } }).limits.perOrg).toEqual({ requestsPerDay: 10 });
    expect(tightenAiPolicy(SYSTEM, { limits: { perOrg: { requestsPerDay: 1000 } } }).limits.perOrg).toEqual({ requestsPerDay: 100 });
    expect(tightenAiPolicy(SYSTEM, { limits: { perOrg: { outputTokensPerDay: 5000 } } }).limits.perOrg).toEqual({
      requestsPerDay: 100,
      outputTokensPerDay: 5000,
    });
    expect(tightenAiPolicy({ ...SYSTEM, limits: {} }, {}).limits.perOrg).toBeUndefined();
  });

  it('switches providers off, never on', () => {
    const effective = tightenAiPolicy(SYSTEM, { providers: { anthropic: { enabled: false }, gemini: { enabled: true } } });
    expect(effective.providers.anthropic?.enabled).toBe(false);
    expect(effective.providers.gemini?.enabled).toBe(false);
    expect(effective.providers.openai?.enabled).toBe(true);
  });

  it('leaves everything else, and the system value, untouched', () => {
    const before = structuredClone(SYSTEM);
    const effective = tightenAiPolicy(SYSTEM, { enabled: false });
    expect(SYSTEM).toEqual(before);
    expect(effective.hostedTools).toEqual(SYSTEM.hostedTools);
    expect(effective.deploymentKeyServesOrgs).toBe(true);
  });
});

describe('org keys and features on the wire', () => {
  it('the org-key view has no key field; the PUT body trims and bounds the key', () => {
    expect(ORG_AI_KEY_VIEW_CARRIES_NO_SECRET).toBe(true);
    expect(Object.keys(orgAiKeyViewSchema.shape).sort()).toEqual(['configured', 'displayName', 'hint', 'provider', 'verifiedAt']);
    expect(setOrgAiKeySchema.parse({ apiKey: '  sk-12345678  ' })).toEqual({ apiKey: 'sk-12345678' });
    expect(setOrgAiKeySchema.safeParse({ apiKey: 'short' }).success).toBe(false);
  });

  it('a feature view carries usable', () => {
    expect(
      aiFeatureViewSchema.parse({
        id: 'example_summary',
        label: 'Summaries',
        group: null,
        needs: ['responses'],
        inputModalities: [],
        providers: null,
        requiresHostedTools: [],
        defaultEffort: null,
        usable: true,
      }).usable,
    ).toBe(true);
  });
});

describe('the open provider record (PP-14.6)', () => {
  it('BUILTIN_AI_PROVIDER_IDS is the shipped list and AI_PROVIDER_IDS is its deprecated alias', () => {
    expect([...BUILTIN_AI_PROVIDER_IDS]).toEqual(['openai', 'anthropic', 'gemini', 'azure-openai', 'openai-compatible']);
    expect(AI_PROVIDER_IDS).toBe(BUILTIN_AI_PROVIDER_IDS);
  });

  it('every built-in id matches the provider id pattern, which is the provider part of a perModel key', () => {
    for (const id of BUILTIN_AI_PROVIDER_IDS) expect(aiProviderIdSchema.safeParse(id).success).toBe(true);
    expect(aiProviderIdSchema.safeParse('example-transcribe').success).toBe(true);
    for (const bad of ['', 'a', 'A-b', 'has_underscore', '1abc', 'x'.repeat(49), 'a:b', 'a b']) {
      expect(aiProviderIdSchema.safeParse(bad).success).toBe(false);
    }
    expect(AI_PROVIDER_ID_PATTERN.test('openai')).toBe(true);
  });

  it('the stored schema accepts a slot for a provider it has never heard of, with its own fields passed through', () => {
    const value = { ...SYSTEM, providers: { ...SYSTEM.providers, 'example-transcribe': { enabled: true, region: 'eu' } } };
    expect(systemAiSchema.parse(value).providers['example-transcribe']).toEqual({ enabled: true, region: 'eu' });
  });

  it('a slot needs `enabled`, and a provider id must match the pattern', () => {
    expect(systemAiSchema.safeParse({ ...SYSTEM, providers: { 'example-transcribe': { region: 'eu' } } }).success).toBe(false);
    expect(systemAiSchema.safeParse({ ...SYSTEM, providers: { 'Bad_Id': { enabled: true } } }).success).toBe(false);
  });

  it("today's stored shape of the five built-ins still parses unchanged", () => {
    const stored = {
      ...SYSTEM,
      providers: {
        openai: { enabled: true, baseUrl: 'https://gateway.example.com/v1' },
        anthropic: { enabled: false },
        gemini: { enabled: false },
        'azure-openai': {
          enabled: true,
          baseUrl: 'https://res.openai.azure.com',
          apiVersion: '2025-04-01-preview',
          apiStyle: 'responses',
          deployments: { 'gpt-4o': 'my-gpt-4o' },
        },
        'openai-compatible': { enabled: true, baseUrl: 'http://ollama:11434/v1', apiStyle: 'chat_completions', requiresKey: false },
      },
    };
    expect(systemAiSchema.parse(stored)).toEqual(stored);
    expect(aiSettingsSchema.parse(stored).providers).toEqual(stored.providers);
  });

  it('the PATCH schemas take a partial slot per provider id, with `null` for a setting to remove', () => {
    const patch = { providers: { openai: { baseUrl: null }, 'example-transcribe': { enabled: true, region: 'eu' } } };
    expect(systemAiPatchSchema.parse(patch)).toEqual(patch);
    expect(aiSettingsPatchSchema.parse(patch)).toEqual(patch);
    expect(systemAiPatchSchema.safeParse({ providers: { 'Not Valid': { enabled: true } } }).success).toBe(false);
  });

  it('the response record carries hasKey beside enabled', () => {
    expect(aiProvidersResponseSchema.parse({ openai: { enabled: true, hasKey: true, baseUrl: 'https://x.example.com' } })).toEqual({
      openai: { enabled: true, hasKey: true, baseUrl: 'https://x.example.com' },
    });
  });

  it('the org layer takes `enabled` for any provider id and tightens a provider the system registered', () => {
    expect(orgAiSettingsSchema.parse({ providers: { 'example-transcribe': { enabled: false } } })).toEqual({
      providers: { 'example-transcribe': { enabled: false } },
    });
    const system = { ...SYSTEM, providers: { ...SYSTEM.providers, 'example-transcribe': { enabled: true, region: 'eu' } } };
    const effective = tightenAiPolicy(system, { providers: { 'example-transcribe': { enabled: false } } });
    expect(effective.providers['example-transcribe']).toEqual({ enabled: false, region: 'eu' });
  });
});
