// The AI slice's wire contract (issue #739): the `ai` namespace schemas, the
// org layer and its tighten-only merge, the org-key and feature shapes.
import { describe, expect, it } from 'vitest';

import {
  AI_SETTINGS_CARRIES_NO_SECRET,
  ORG_AI_KEY_VIEW_CARRIES_NO_SECRET,
  aiFeatureViewSchema,
  orgAiKeyViewSchema,
  orgAiSettingsSchema,
  setOrgAiKeySchema,
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
    expect(effective.providers.anthropic.enabled).toBe(false);
    expect(effective.providers.gemini.enabled).toBe(false);
    expect(effective.providers.openai.enabled).toBe(true);
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
