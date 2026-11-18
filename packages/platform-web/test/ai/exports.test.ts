/**
 * The public surface of `@marinoscar/platform-web/ai/ui` carries the user-side
 * key, keyless and account sign-in cards (issue #998).
 */
import { describe, it, expect } from 'vitest';
import * as ui from '../../src/ai/ui/index.js';

describe('ai/ui exports', () => {
  it.each([
    'AccountSignInProviderCard',
    'UserAiKeyCard',
    'KeylessProviderCard',
    'DefaultAiModelPicker',
    'aiErrorText',
    'aiCodeText',
  ])('exports %s as a function or component', (name) => {
    const value = (ui as Record<string, unknown>)[name];
    expect(value).toBeDefined();
    expect(['function', 'object']).toContain(typeof value);
  });

  it('exports KEYLESS_PROVIDER_TEXT as a non-empty string', () => {
    expect(typeof ui.KEYLESS_PROVIDER_TEXT).toBe('string');
    expect(ui.KEYLESS_PROVIDER_TEXT.length).toBeGreaterThan(0);
  });

  it('keeps the existing page exports', () => {
    expect(ui.OrgAiKeysPage).toBeDefined();
    expect(ui.UserAiKeysPage).toBeDefined();
  });

  it('aiErrorText words a plain Error by its message and falls back otherwise', () => {
    expect(ui.aiErrorText(new Error('boom'), 'fallback')).toBe('boom');
    expect(ui.aiErrorText('x', 'fallback')).toBe('fallback');
  });

  it('aiCodeText words known and unknown codes', () => {
    expect(ui.aiCodeText('AI_KEY_INVALID')).toMatch(/rejected/);
    expect(ui.aiCodeText(null)).toBe('Something went wrong');
  });
});
