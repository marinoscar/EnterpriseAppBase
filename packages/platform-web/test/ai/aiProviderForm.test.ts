/**
 * The admin provider card's form model (issue #448, epic #421): the value a
 * provider loads as, the client-side validation that mirrors the API, and the
 * `PUT` entry — which must carry ONLY the provider's `settingsFields`.
 */
import { describe, it, expect } from 'vitest';
import {
  providerSettingValue,
  withProviderSetting,
  toProviderFormValue,
  toProviderInput,
  validateProviderForm,
  hasProviderFormErrors,
} from '../../src/ai/ui/admin/aiProviderForm.js';
import type { AiProviderFormValue } from '../../src/ai/ui/admin/aiProviderForm.js';
import { aiAdminConfigToInput } from '../../src/ai/headless/types.js';
import type { AiAdminProvider } from '../../src/ai/headless/types.js';
import { mockAiAdminConfig, mockAiAdminConfigWithCompatible, mockAiAdminConfigWithExample } from './fixtures.js';

const [openai, azure, compatible] = mockAiAdminConfigWithCompatible.providers as [
  AiAdminProvider,
  AiAdminProvider,
  AiAdminProvider,
];

function value(overrides: Partial<AiProviderFormValue> = {}): AiProviderFormValue {
  return {
    enabled: false,
    baseUrl: '',
    apiVersion: '',
    apiStyle: '',
    deployments: [],
    requiresKey: true,
    ...overrides,
  };
}

describe('aiProviderForm', () => {
  describe('toProviderFormValue', () => {
    it('loads nulls as blanks, deployments as rows, and requiresKey as on', () => {
      expect(toProviderFormValue(azure)).toEqual({
        enabled: true,
        baseUrl: 'https://contoso.openai.azure.com',
        apiVersion: '2024-10-21',
        apiStyle: '',
        deployments: [{ modelId: 'gpt-4o', deployment: 'contoso-gpt-4o' }],
        requiresKey: true,
      });
      expect(toProviderFormValue({ ...compatible, requiresKey: false }).requiresKey).toBe(false);
    });
  });

  describe('toProviderInput', () => {
    it('openai keeps the pre-#448 body exactly: { enabled, baseUrl }', () => {
      expect(toProviderInput(openai, value({ enabled: true, apiVersion: 'x', requiresKey: false }))).toEqual({
        enabled: true,
        baseUrl: null,
      });
    });

    it('an API older than #448 (no settingsFields) is treated as baseUrl only', () => {
      const legacy = { ...openai, settingsFields: undefined };
      expect(toProviderInput(legacy, value({ baseUrl: ' https://gw.example.com/v1 ' }))).toEqual({
        enabled: false,
        baseUrl: 'https://gw.example.com/v1',
      });
    });

    it('azure sends its own fields, blanks omitted and empty deployment rows dropped', () => {
      expect(
        toProviderInput(
          azure,
          value({
            enabled: true,
            baseUrl: 'https://contoso.openai.azure.com',
            apiVersion: ' 2024-10-21 ',
            apiStyle: 'chat_completions',
            deployments: [
              { modelId: 'gpt-4o', deployment: 'contoso-gpt-4o' },
              { modelId: '', deployment: '' },
            ],
            requiresKey: false, // not an Azure field: never sent
          }),
        ),
      ).toEqual({
        enabled: true,
        baseUrl: 'https://contoso.openai.azure.com',
        apiVersion: '2024-10-21',
        apiStyle: 'chat_completions',
        deployments: { 'gpt-4o': 'contoso-gpt-4o' },
      });
      expect(toProviderInput(azure, value())).toEqual({ enabled: false, baseUrl: null });
    });

    it('openai-compatible sends apiStyle only when chosen, and requiresKey always', () => {
      expect(
        toProviderInput(
          compatible,
          value({ enabled: true, baseUrl: 'http://ollama:11434/v1', apiVersion: '2024-10-21', requiresKey: false }),
        ),
      ).toEqual({ enabled: true, baseUrl: 'http://ollama:11434/v1', requiresKey: false });
    });

    it('aiAdminConfigToInput re-sends each provider with only its own fields', () => {
      expect(aiAdminConfigToInput(mockAiAdminConfigWithCompatible).providers).toEqual({
        openai: { enabled: false, baseUrl: null },
        'azure-openai': {
          enabled: true,
          baseUrl: 'https://contoso.openai.azure.com',
          apiVersion: '2024-10-21',
          deployments: { 'gpt-4o': 'contoso-gpt-4o' },
        },
        'openai-compatible': { enabled: false, baseUrl: null },
      });
      expect(aiAdminConfigToInput(mockAiAdminConfig).providers).toEqual({
        openai: { enabled: false, baseUrl: null },
      });
    });
  });

  describe('validateProviderForm', () => {
    it('accepts a clean provider', () => {
      expect(hasProviderFormErrors(validateProviderForm(azure, toProviderFormValue(azure)))).toBe(false);
      expect(hasProviderFormErrors(validateProviderForm(compatible, toProviderFormValue(compatible)))).toBe(false);
    });

    it('requires an endpoint to enable azure-openai or openai-compatible, not openai', () => {
      expect(validateProviderForm(azure, value({ enabled: true })).baseUrl).toMatch(/endpoint is required/i);
      expect(validateProviderForm(compatible, value({ enabled: true })).baseUrl).toMatch(/base url is required/i);
      expect(validateProviderForm(openai, value({ enabled: true })).baseUrl).toBeUndefined();
    });

    it('Azure endpoints must be https; a compatible server may be http', () => {
      expect(validateProviderForm(azure, value({ baseUrl: 'http://contoso.openai.azure.com' })).baseUrl).toMatch(
        /https/,
      );
      expect(validateProviderForm(compatible, value({ baseUrl: 'http://ollama:11434/v1' })).baseUrl).toBeUndefined();
    });

    it('refuses credentials and a fragment in the URL', () => {
      expect(validateProviderForm(compatible, value({ baseUrl: 'http://me:pw@ollama:11434/v1' })).baseUrl).toMatch(
        /user name and password/i,
      );
      expect(validateProviderForm(compatible, value({ baseUrl: 'http://ollama:11434/v1#x' })).baseUrl).toMatch(
        /fragment/i,
      );
      expect(validateProviderForm(openai, value({ baseUrl: 'not a url' })).baseUrl).toMatch(/must be a full url/i);
    });

    it('checks the api-version and deployment names against the API pattern', () => {
      expect(validateProviderForm(azure, value({ apiVersion: '2024 10 21' })).apiVersion).toBeDefined();
      expect(validateProviderForm(azure, value({ apiVersion: '-preview' })).apiVersion).toBeDefined();
      expect(validateProviderForm(azure, value({ apiVersion: 'preview' })).apiVersion).toBeUndefined();

      const errors = validateProviderForm(
        azure,
        value({
          deployments: [
            { modelId: 'gpt-4o', deployment: 'bad name' },
            { modelId: '', deployment: 'orphan' },
            { modelId: 'gpt-4o', deployment: 'dup' },
          ],
        }),
      );
      expect(errors.deploymentRows?.[0]?.deployment).toMatch(/letters, digits/i);
      expect(errors.deploymentRows?.[1]?.modelId).toMatch(/enter the model id/i);
      expect(errors.deploymentRows?.[2]?.modelId).toMatch(/already mapped/i);
      expect(errors.deployments).toMatch(/more than once/);
    });

    it('caps deployments at 200', () => {
      const rows = Array.from({ length: 201 }, (_, i) => ({ modelId: `m${i}`, deployment: `d${i}` }));
      expect(validateProviderForm(azure, value({ deployments: rows })).deployments).toMatch(/at most 200/i);
      expect(validateProviderForm(azure, value({ deployments: rows.slice(0, 200) })).deployments).toBeUndefined();
    });

    it('only validates fields the provider renders', () => {
      // openai has no apiVersion field, so a stale value there is never an error.
      expect(validateProviderForm(openai, value({ apiVersion: 'bad version' }))).toEqual({});
    });
  });

  describe('a provider an app registered (PP-14.6, #924)', () => {
    const example = mockAiAdminConfigWithExample.providers[1] as AiAdminProvider;

    it('loads its own settings into the form value and sends them back as { enabled, ...settings }', () => {
      const form = toProviderFormValue(example);
      expect(form.settings).toEqual({ region: 'us' });
      expect(toProviderInput(example, { ...form, enabled: true, settings: { region: 'eu' } })).toEqual({
        enabled: true,
        region: 'eu',
      });
    });

    it('leaves an empty own setting out of the entry (the provider default)', () => {
      expect(toProviderInput(example, { ...toProviderFormValue(example), settings: { region: '' } })).toEqual({
        enabled: false,
      });
    });

    it('aiAdminConfigToInput re-sends its stored settings', () => {
      expect(aiAdminConfigToInput(mockAiAdminConfigWithExample).providers['example-transcribe']).toEqual({
        enabled: false,
        region: 'us',
      });
    });

    it('the built-ins carry no own settings', () => {
      expect(toProviderFormValue(azure).settings).toBeUndefined();
    });

    it('requires an endpoint to enable only a provider whose API says requiresBaseUrl', () => {
      const gateway: AiAdminProvider = { ...example, settingsFields: ['baseUrl'], requiresBaseUrl: true };
      expect(validateProviderForm(gateway, value({ enabled: true })).baseUrl).toMatch(/base url is required/i);
      expect(validateProviderForm({ ...gateway, requiresBaseUrl: false }, value({ enabled: true })).baseUrl).toBeUndefined();
    });

    it('providerSettingValue / withProviderSetting map built-in names to the typed members and the rest to settings', () => {
      const form = toProviderFormValue(example);
      expect(providerSettingValue(form, 'region')).toBe('us');
      expect(providerSettingValue(form, 'baseUrl')).toBeUndefined();
      expect(withProviderSetting(form, 'region', 'eu').settings).toEqual({ region: 'eu' });
      expect(withProviderSetting(form, 'region', undefined).settings).toEqual({});
      expect(withProviderSetting(form, 'baseUrl', 'https://x.example').baseUrl).toBe('https://x.example');
      expect(withProviderSetting(form, 'baseUrl', undefined).baseUrl).toBe('');
      expect(withProviderSetting(form, 'enabled', true).enabled).toBe(true);
      expect(withProviderSetting(form, 'requiresKey', false).requiresKey).toBe(false);
      expect(withProviderSetting(form, 'apiStyle', 'responses').apiStyle).toBe('responses');
      expect(providerSettingValue(withProviderSetting(form, 'apiVersion', '2024-10-21'), 'apiVersion')).toBe('2024-10-21');
    });
  });
});
