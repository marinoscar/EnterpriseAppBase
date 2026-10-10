import { Module } from '@nestjs/common';
import { z } from 'zod';

import { PluggableUnknownError } from '../../core/pluggable/index';
import {
  aiProviderDefinitions,
  aiProviderKind,
  aiProviderSettingsFields,
  defaultAiProviderSlot,
  describeAiProvider,
  getAiProviderDefinition,
  registerAiProvider,
  requireAiProviderDefinition,
  type AiProviderDefinition,
} from './ai-provider-definition';
import { BUILTIN_AI_PROVIDER_DEFINITIONS } from './builtin-ai-providers';

@Module({})
class ToyModule {}

function toy(overrides: Partial<AiProviderDefinition> = {}): AiProviderDefinition {
  return {
    id: 'toy-provider',
    label: 'Toy',
    module: ToyModule,
    settingsSchema: z.object({ region: z.enum(['us', 'eu']).default('us').describe('Processing region') }),
    defaults: { region: 'us' },
    requiresKey: true,
    ...overrides,
  };
}

describe('AI provider definitions (PP-14.6)', () => {
  it('registers the five built-ins first, through the same function an app uses', () => {
    expect(aiProviderDefinitions().slice(0, 5).map((d) => d.id)).toEqual([
      'openai',
      'anthropic',
      'gemini',
      'azure-openai',
      'openai-compatible',
    ]);
    expect(BUILTIN_AI_PROVIDER_DEFINITIONS.map((d) => d.id)).toEqual(aiProviderDefinitions().slice(0, 5).map((d) => d.id));
  });

  it('gives each built-in its current settings fields, in the order the admin form always had them', () => {
    expect(aiProviderSettingsFields('openai')).toEqual(['baseUrl']);
    expect(aiProviderSettingsFields('anthropic')).toEqual(['baseUrl']);
    expect(aiProviderSettingsFields('gemini')).toEqual(['baseUrl']);
    expect(aiProviderSettingsFields('azure-openai')).toEqual(['baseUrl', 'apiVersion', 'apiStyle', 'deployments']);
    expect(aiProviderSettingsFields('openai-compatible')).toEqual(['baseUrl', 'apiStyle', 'requiresKey']);
    expect(aiProviderSettingsFields('no-such-provider')).toEqual([]);
  });

  it('replaces the hard-coded endpoint rules with requiresBaseUrl and help', () => {
    expect(['openai', 'anthropic', 'gemini'].map((id) => getAiProviderDefinition(id)?.requiresBaseUrl ?? false)).toEqual([false, false, false]);
    expect(getAiProviderDefinition('azure-openai')?.requiresBaseUrl).toBe(true);
    expect(getAiProviderDefinition('openai-compatible')?.requiresBaseUrl).toBe(true);
    expect(getAiProviderDefinition('azure-openai')?.help?.baseUrl).toContain('Azure OpenAI resource endpoint');
    expect(getAiProviderDefinition('openai')?.help).toBeUndefined();
  });

  it("a fresh slot is switched off with the provider's defaults", () => {
    expect(defaultAiProviderSlot('openai')).toEqual({ enabled: false });
    expect(defaultAiProviderSlot('azure-openai')).toEqual({ enabled: false });
  });

  it('describes a provider for a generated form: enabled, its settings, then a write-only key', () => {
    expect(describeAiProvider('openai', false)).toEqual({
      kind: 'ai-provider',
      id: 'openai',
      label: 'OpenAI',
      description: expect.any(String),
      fields: [
        expect.objectContaining({ name: 'enabled', kind: 'boolean', label: 'Enabled' }),
        expect.objectContaining({ name: 'baseUrl', kind: 'string' }),
        { name: 'apiKey', label: 'API key', kind: 'secret', hasValue: false, required: true },
      ],
    });
    const keyed = describeAiProvider('openai', true).fields.find((f) => f.name === 'apiKey');
    expect(keyed).toMatchObject({ kind: 'secret', hasValue: true });
    expect(JSON.stringify(describeAiProvider('openai', true))).not.toMatch(/sk-/);
  });

  describe('registerAiProvider', () => {
    it('registers an app provider after the built-ins and describes its own settings', () => {
      registerAiProvider(toy());

      expect(aiProviderKind.ids().at(-1)).toBe('toy-provider');
      expect(requireAiProviderDefinition('toy-provider').label).toBe('Toy');
      expect(defaultAiProviderSlot('toy-provider')).toEqual({ enabled: false, region: 'us' });
      expect(describeAiProvider('toy-provider', false).fields).toEqual([
        expect.objectContaining({ name: 'enabled', kind: 'boolean' }),
        { name: 'region', kind: 'enum', options: ['us', 'eu'], label: 'Region', help: 'Processing region' },
        { name: 'apiKey', label: 'API key', kind: 'secret', hasValue: false, required: true },
      ]);
    });

    it('a keyless provider declares no key field', () => {
      registerAiProvider(toy({ id: 'keyless-toy', requiresKey: false }));

      expect(describeAiProvider('keyless-toy', false).fields.map((f) => f.name)).toEqual(['enabled', 'region']);
    });

    it('refuses a duplicate id', () => {
      expect(() => registerAiProvider(toy({ id: 'openai' }))).toThrow(/openai/);
    });

    it('refuses an id outside the pattern', () => {
      for (const id of ['', 'x', 'Has-Caps', 'has_underscore', '9lives']) {
        expect(() => registerAiProvider(toy({ id }))).toThrow(/Invalid AI provider id|must match/);
      }
    });

    it('refuses a settings field that looks like a secret, or that the slot owns', () => {
      for (const field of ['apiKey', 'secret', 'token', 'password', 'key']) {
        expect(() => registerAiProvider(toy({ id: 'secret-toy', settingsSchema: z.object({ [field]: z.string().optional() }), defaults: {} }))).toThrow(
          /looks like a secret/,
        );
      }
      expect(() => registerAiProvider(toy({ id: 'own-toy', settingsSchema: z.object({ enabled: z.boolean() }), defaults: {} }))).toThrow(/slot owns/);
    });

    it('refuses requiresBaseUrl without a baseUrl field, defaults that do not parse and a module that is not a class', () => {
      expect(() => registerAiProvider(toy({ id: 'url-toy', requiresBaseUrl: true }))).toThrow(/baseUrl/);
      expect(() => registerAiProvider(toy({ id: 'default-toy', defaults: { region: 'mars' } }))).toThrow(/defaults do not parse/);
      expect(() => registerAiProvider(toy({ id: 'module-toy', module: {} as never }))).toThrow(/module must be/);
    });
  });

  it('an unregistered id is an unknown-provider error naming the registered ones', () => {
    expect(getAiProviderDefinition('nope-provider')).toBeUndefined();
    expect(() => requireAiProviderDefinition('nope-provider')).toThrow(PluggableUnknownError);
    expect(() => requireAiProviderDefinition('nope-provider')).toThrow(/openai/);
  });
});
