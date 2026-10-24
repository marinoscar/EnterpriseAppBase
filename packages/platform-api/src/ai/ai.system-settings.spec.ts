import { BadRequestException, Logger, Module } from '@nestjs/common';
import type { SystemAiValue } from '@marinoscar/platform-contract/ai';
import { z } from 'zod';

import type { SettingsReadHelpers } from '../settings/index';
import { AI_SYSTEM_SETTINGS } from './ai.system-settings';
import { aiProviderKind, defaultAiProviderSlot, registerAiProvider } from './providers/ai-provider-definition';

@Module({})
class ZedModule {}

registerAiProvider({
  id: 'zed-provider',
  label: 'Zed',
  module: ZedModule,
  settingsSchema: z.object({
    region: z.enum(['us', 'eu']).default('us').describe('Processing region'),
    timeoutSeconds: z.number().int().min(1).max(300).optional(),
  }),
  defaults: { region: 'us' },
  requiresKey: true,
});

/** The helpers `SystemSettingsService` lends a namespace's `read`, minimally. */
const helpers: SettingsReadHelpers = {
  asPlainObject: (value) => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined),
  readNamespace: (stored, schema, defaults) => {
    const source = (stored !== null && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(schema.shape).map(([key, field]) => {
        const parsed = (field as z.ZodType).safeParse(source[key]);
        return [key, parsed.success ? parsed.data : structuredClone((defaults as Record<string, unknown>)[key])];
      }),
    ) as never;
  },
  readStringArray: () => [],
};

const read = (stored: unknown): SystemAiValue => AI_SYSTEM_SETTINGS.read(stored, helpers);

/** A row as an upgraded deployment has it stored today: the five built-ins, non-default values on some. */
const TODAYS_ROW = {
  enabled: true,
  keyPolicy: 'byok_with_org_fallback',
  providers: {
    openai: { enabled: true, baseUrl: 'https://gateway.example.com/v1' },
    anthropic: { enabled: false },
    gemini: { enabled: true },
    'azure-openai': {
      enabled: true,
      baseUrl: 'https://res.openai.azure.com',
      apiVersion: '2025-04-01-preview',
      apiStyle: 'responses',
      deployments: { 'gpt-4o': 'my-gpt-4o' },
    },
    'openai-compatible': { enabled: false, baseUrl: 'http://ollama:11434/v1', apiStyle: 'chat_completions', requiresKey: false },
  },
  defaults: { maxOutputTokensCap: 4096, allowBackgroundRuns: false, allowRealtime: true },
  logPromptContent: true,
  usageRetentionDays: 90,
  hostedTools: { web_search: true, file_search: false, code_interpreter: false, image_generation: false, mcp: true, mcpAllowedHosts: ['mcp.example.com'] },
  limits: { perUser: { requestsPerMinute: 30 }, perModel: { 'openai:gpt-4.1-mini': { maxOutputTokens: 1000 } } },
  deploymentKeyServesOrgs: false,
};

describe('the ai namespace over the provider registry (PP-14.6)', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  describe('read', () => {
    it("loads today's stored shape unchanged, and adds a default slot for a provider registered since", () => {
      const value = read(structuredClone(TODAYS_ROW));

      expect(value).toEqual({ ...TODAYS_ROW, providers: { ...TODAYS_ROW.providers, 'zed-provider': { enabled: false, region: 'us' } } });
      expect(Object.keys(value.providers)).toEqual([...aiProviderKind.ids()]);
      expect(warn).not.toHaveBeenCalled();
    });

    it('fills the slots a row written before they existed lacks, without resetting the ones it has', () => {
      const value = read({ ...TODAYS_ROW, providers: { openai: { enabled: true, baseUrl: 'https://gateway.example.com/v1' } } });

      expect(value.providers.openai).toEqual({ enabled: true, baseUrl: 'https://gateway.example.com/v1' });
      expect(value.providers.anthropic).toEqual({ enabled: false });
      expect(value.providers['azure-openai']).toEqual({ enabled: false });
    });

    it('a slot that no longer parses falls back to its own defaults, with one warning, and leaves the rest alone', () => {
      const value = read({
        ...TODAYS_ROW,
        providers: { ...TODAYS_ROW.providers, 'zed-provider': { enabled: true, region: 'mars' } },
      });

      expect(value.providers['zed-provider']).toEqual({ enabled: false, region: 'us' });
      expect(value.providers.openai).toEqual(TODAYS_ROW.providers.openai);
      expect(value.keyPolicy).toBe('byok_with_org_fallback');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('zed-provider');
    });

    it('drops the stored slot of a provider that is no longer registered, with ONE warning naming it', () => {
      const stored = {
        ...TODAYS_ROW,
        providers: { ...TODAYS_ROW.providers, 'removed-one': { enabled: true }, 'removed-two': { enabled: true, region: 'eu' } },
      };

      const value = read(structuredClone(stored));

      expect(Object.keys(value.providers)).not.toContain('removed-one');
      expect(Object.keys(value.providers)).not.toContain('removed-two');
      expect(value.providers.openai).toEqual(TODAYS_ROW.providers.openai);
      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0]?.[0]);
      expect(message).toContain('"removed-one"');
      expect(message).toContain('"removed-two"');

      // The same stored row is read again (the policy cache refreshes every few seconds): no second line.
      read(structuredClone(stored));
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('a missing or unusable namespace still gives every registered provider its default slot, an app provider included', () => {
      for (const stored of [undefined, null, 'x', [], 42]) {
        const value = read(stored);

        expect(Object.keys(value.providers)).toEqual([...aiProviderKind.ids()]);
        expect(value.providers['zed-provider']).toEqual({ enabled: false, region: 'us' });
        expect(value.enabled).toBe(false);
      }
    });

    it('a damaged or missing providers block degrades to every registered provider switched off', () => {
      for (const providers of [undefined, null, 'x', [], 42]) {
        const value = read({ ...TODAYS_ROW, providers });
        expect(Object.values(value.providers).every((slot) => slot.enabled === false)).toBe(true);
        expect(value.keyPolicy).toBe('byok_with_org_fallback');
      }
    });
  });

  describe('defaults', () => {
    it("are the built-in definitions' fresh slots, so the committed defaults catalog is unchanged", () => {
      expect(AI_SYSTEM_SETTINGS.defaults.providers).toEqual({
        openai: { enabled: false },
        anthropic: { enabled: false },
        gemini: { enabled: false },
        'azure-openai': { enabled: false },
        'openai-compatible': { enabled: false },
      });
      for (const id of Object.keys(AI_SYSTEM_SETTINGS.defaults.providers)) {
        expect(AI_SYSTEM_SETTINGS.defaults.providers[id]).toEqual(defaultAiProviderSlot(id));
      }
    });
  });

  describe('merge', () => {
    const current = (): SystemAiValue => read(structuredClone(TODAYS_ROW));

    it('keeps every provider the patch does not name, and an enabled-only patch keeps the settings', () => {
      const merged = AI_SYSTEM_SETTINGS.merge(current(), { providers: { openai: { enabled: false } } });

      expect(merged.providers.openai).toEqual({ enabled: false, baseUrl: 'https://gateway.example.com/v1' });
      expect(merged.providers['azure-openai']).toEqual(TODAYS_ROW.providers['azure-openai']);
      expect(merged.providers['zed-provider']).toEqual({ enabled: false, region: 'us' });
    });

    it('sets a registered provider\'s own setting, validated by its settingsSchema', () => {
      const merged = AI_SYSTEM_SETTINGS.merge(current(), { providers: { 'zed-provider': { enabled: true, region: 'eu', timeoutSeconds: 30 } } });

      expect(merged.providers['zed-provider']).toEqual({ enabled: true, region: 'eu', timeoutSeconds: 30 });
    });

    it('null removes a setting (back to its default) and replaces `deployments` wholesale', () => {
      const merged = AI_SYSTEM_SETTINGS.merge(current(), {
        providers: {
          openai: { baseUrl: null },
          'azure-openai': { deployments: { 'gpt-4.1': 'other' }, apiVersion: null },
          'zed-provider': { region: null },
        },
      });

      expect(merged.providers.openai).toEqual({ enabled: true });
      expect(merged.providers['azure-openai']).toEqual({
        enabled: true,
        baseUrl: 'https://res.openai.azure.com',
        apiStyle: 'responses',
        deployments: { 'gpt-4.1': 'other' },
      });
      expect(merged.providers['zed-provider']).toEqual({ enabled: false, region: 'us' });
    });

    it('does not alias the current value', () => {
      const before = current();
      const merged = AI_SYSTEM_SETTINGS.merge(before, undefined);

      expect(merged.providers).toEqual(before.providers);
      expect(merged.providers['azure-openai']).not.toBe(before.providers['azure-openai']);
    });

    it('refuses an unregistered provider with a 400 naming it', () => {
      try {
        AI_SYSTEM_SETTINGS.merge(current(), { providers: { 'ghost-provider': { enabled: true } } });
        throw new Error('expected a rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getResponse()).toMatchObject({ details: { reason: 'AI_UNKNOWN_PROVIDER', provider: 'ghost-provider' } });
      }
    });

    it("refuses settings the provider's own schema rejects, with the field named", () => {
      for (const [provider, slot, field] of [
        ['zed-provider', { region: 'mars' }, 'region'],
        ['azure-openai', { baseUrl: 'http://res.openai.azure.com' }, 'baseUrl'],
        ['openai', { baseUrl: 'not a url' }, 'baseUrl'],
      ] as const) {
        try {
          AI_SYSTEM_SETTINGS.merge(current(), { providers: { [provider]: slot } });
          throw new Error(`expected ${provider} to be rejected`);
        } catch (error) {
          expect(error).toBeInstanceOf(BadRequestException);
          expect((error as BadRequestException).getResponse()).toMatchObject({
            details: { reason: 'AI_PROVIDER_SETTINGS_INVALID', provider, fields: [field] },
          });
        }
      }
    });

    it('a stored slot for a removed provider is not an obstacle to a save', () => {
      const withGhost = read({ ...TODAYS_ROW, providers: { ...TODAYS_ROW.providers, 'ghost-provider': { enabled: true } } });

      expect(() => AI_SYSTEM_SETTINGS.merge(withGhost, { providers: { openai: { enabled: false } } })).not.toThrow();
      expect(Object.keys(AI_SYSTEM_SETTINGS.merge(withGhost, { enabled: false }).providers)).not.toContain('ghost-provider');
    });
  });

  describe('storedSchema', () => {
    it('validates each slot with its provider and fills the provider defaults', () => {
      const parsed = AI_SYSTEM_SETTINGS.storedSchema.parse({ ...TODAYS_ROW, providers: { 'zed-provider': { enabled: true } } });

      expect(parsed.providers).toEqual({ 'zed-provider': { enabled: true, region: 'us' } });
    });

    it('refuses an unregistered provider and a slot that does not parse', () => {
      expect(AI_SYSTEM_SETTINGS.storedSchema.safeParse({ ...TODAYS_ROW, providers: { 'ghost-provider': { enabled: true } } }).success).toBe(false);
      expect(AI_SYSTEM_SETTINGS.storedSchema.safeParse({ ...TODAYS_ROW, providers: { 'zed-provider': { enabled: true, region: 'mars' } } }).success).toBe(false);
    });
  });

  describe('the org layer', () => {
    const system = (): SystemAiValue => read(structuredClone({ ...TODAYS_ROW, providers: { ...TODAYS_ROW.providers, 'zed-provider': { enabled: true, region: 'eu' } } }));

    it('lets an organization switch a registered provider off for itself, never on', () => {
      const off = AI_SYSTEM_SETTINGS.org.merge(system(), { providers: { 'zed-provider': { enabled: false } } }) as SystemAiValue;
      expect(off.providers['zed-provider']).toEqual({ enabled: false, region: 'eu' });

      const stillOff = AI_SYSTEM_SETTINGS.org.merge(system(), { providers: { anthropic: { enabled: true } } }) as SystemAiValue;
      expect(stillOff.providers.anthropic?.enabled).toBe(false);
    });

    it('accepts an override for any provider id and ignores one the deployment does not have', () => {
      expect(AI_SYSTEM_SETTINGS.org.schema.parse({ providers: { 'zed-provider': { enabled: false }, 'ghost-provider': { enabled: false } } })).toEqual({
        providers: { 'zed-provider': { enabled: false }, 'ghost-provider': { enabled: false } },
      });
      const merged = AI_SYSTEM_SETTINGS.org.merge(system(), { providers: { 'ghost-provider': { enabled: false } } }) as SystemAiValue;
      expect(Object.keys(merged.providers)).not.toContain('ghost-provider');
    });
  });
});
