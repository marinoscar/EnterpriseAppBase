// The SSRF posture of the #448 endpoint settings: which URLs an administrator
// may point the Azure OpenAI and OpenAI-compatible adapters at.

import { BadRequestException } from '@nestjs/common';
import { AI_SYSTEM_SETTINGS } from '@marinoscar/platform-api/ai';

import {
  AI_AZURE_ENDPOINT_SCHEMES,
  AI_COMPATIBLE_ENDPOINT_SCHEMES,
  aiEndpointUrlProblem,
  systemAiAzureProviderSchema,
  systemAiCompatibleProviderSchema,
  systemAiPatchSchema,
} from './settings.schema';

describe('aiEndpointUrlProblem (#448)', () => {
  it.each([
    'https://contoso.openai.azure.com',
    'https://contoso.openai.azure.com/',
    'https://gateway.example.com/azure',
  ])('accepts the Azure endpoint %s', (url) => {
    expect(aiEndpointUrlProblem(url, AI_AZURE_ENDPOINT_SCHEMES)).toBeNull();
  });

  it.each([
    'http://localhost:11434/v1',
    'http://ollama.internal:11434/v1',
    'http://10.0.0.5:8000/v1',
    'https://vllm.example.com/v1',
  ])('accepts the compatible endpoint %s (an internal host is an admin decision)', (url) => {
    expect(aiEndpointUrlProblem(url, AI_COMPATIBLE_ENDPOINT_SCHEMES)).toBeNull();
  });

  it.each([
    ['plain http for Azure', 'http://contoso.openai.azure.com', AI_AZURE_ENDPOINT_SCHEMES, /scheme/],
    ['a file: URL', 'file:///etc/passwd', AI_COMPATIBLE_ENDPOINT_SCHEMES, /scheme/],
    ['a gopher: URL', 'gopher://internal:70/', AI_COMPATIBLE_ENDPOINT_SCHEMES, /scheme/],
    ['a data: URL', 'data:text/plain,hello', AI_COMPATIBLE_ENDPOINT_SCHEMES, /scheme/],
    ['embedded credentials', 'https://user:secret@host.example/v1', AI_COMPATIBLE_ENDPOINT_SCHEMES, /Credentials/],
    ['a bare username', 'https://user@host.example/v1', AI_COMPATIBLE_ENDPOINT_SCHEMES, /Credentials/],
    ['a fragment', 'https://host.example/v1#frag', AI_COMPATIBLE_ENDPOINT_SCHEMES, /fragment/],
    ['an empty fragment', 'https://host.example/v1#', AI_COMPATIBLE_ENDPOINT_SCHEMES, /fragment/],
    ['a relative path', '/v1', AI_COMPATIBLE_ENDPOINT_SCHEMES, /absolute/],
  ])('refuses %s', (_label, url, schemes, message) => {
    expect(aiEndpointUrlProblem(url, schemes)).toMatch(message);
  });
});

describe('the #448 provider slots', () => {
  it('validates the Azure slot', () => {
    expect(
      systemAiAzureProviderSchema.safeParse({
        enabled: true,
        baseUrl: 'https://contoso.openai.azure.com',
        apiVersion: '2025-04-01-preview',
        apiStyle: 'responses',
        deployments: { 'gpt-4o-mini': 'mini-prod', 'text-embedding-3-small': 'embed_v1.2' },
      }).success,
    ).toBe(true);

    expect(systemAiAzureProviderSchema.safeParse({ enabled: true, apiVersion: '2025-04-01?x=1' }).success).toBe(false);
    expect(systemAiAzureProviderSchema.safeParse({ enabled: true, apiStyle: 'completions' }).success).toBe(false);
    expect(systemAiAzureProviderSchema.safeParse({ enabled: true, deployments: { m: 'has space' } }).success).toBe(false);
    expect(systemAiAzureProviderSchema.safeParse({ enabled: true, deployments: { m: '../../x' } }).success).toBe(false);
  });

  it('validates the OpenAI-compatible slot', () => {
    expect(
      systemAiCompatibleProviderSchema.safeParse({
        enabled: true,
        baseUrl: 'http://ollama.internal:11434/v1',
        apiStyle: 'chat_completions',
        requiresKey: false,
      }).success,
    ).toBe(true);
    expect(systemAiCompatibleProviderSchema.safeParse({ enabled: true, baseUrl: 'ftp://x.example' }).success).toBe(false);
  });

  it('lets a PATCH remove each optional field with null', () => {
    expect(
      systemAiPatchSchema.safeParse({
        providers: {
          'azure-openai': { baseUrl: null, apiVersion: null, apiStyle: null, deployments: null },
          'openai-compatible': { baseUrl: null, apiStyle: null, requiresKey: null },
        },
      }).success,
    ).toBe(true);
  });

  // PP-14.6 (#924): `ai.providers` is an open record, so the PATCH WIRE schema
  // no longer carries a provider's own URL rules (the contract package cannot
  // know which providers a deployment registered). The same rules now come from
  // the provider's `settingsSchema` (the contract's `systemAiAzureProviderSchema`
  // above, registered by the platform) when the namespace merges the patch: still
  // a 400 for an `http` Azure endpoint, before anything is stored.
  it('applies the same URL rules to a PATCH when the namespace merges it', () => {
    const current = AI_SYSTEM_SETTINGS.defaults;
    const patch = { providers: { 'azure-openai': { baseUrl: 'http://contoso.openai.azure.com' } } };

    expect(systemAiPatchSchema.safeParse(patch).success).toBe(true);
    expect(() => AI_SYSTEM_SETTINGS.merge(current, patch)).toThrow(BadRequestException);
    expect(() => AI_SYSTEM_SETTINGS.merge(current, { providers: { 'azure-openai': { baseUrl: 'https://contoso.openai.azure.com' } } })).not.toThrow();
  });
});
