/**
 * `/admin/settings/ai` — a provider an app registered (PP-14.6, issue #924).
 *
 * The page draws any provider without a registered card from the descriptor the
 * API serves (`AiGenericProviderCard`): a switch, the provider's own settings
 * through `PluggableConfigForm`, and a write-only key with the deployment-key
 * actions. The five built-ins keep their bespoke cards, registered through the
 * same `registerAiProviderCard` registry an app uses. `useAiAdminConfig` is
 * mocked, as in `AiConfigPage.providers.test.tsx`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { render } from '../harness.js';
import type { AiAdminConfig } from '../../../src/ai/headless/types.js';
import { mockAiAdminConfigWithExample } from '../fixtures.js';

vi.mock('../../../src/ai/headless/use-ai-admin-config.js', () => ({ useAiAdminConfig: vi.fn() }));

import { useAiAdminConfig } from '../../../src/ai/headless/use-ai-admin-config.js';
import type { UseAiAdminConfigReturn } from '../../../src/ai/headless/use-ai-admin-config.js';
import AiConfigPage from '../../../src/ai/ui/AiConfigPage.js';
import { registerAiProviderCard } from '../../../src/ai/ui/provider-cards.js';
import { resetAiProviderCardsForTests } from '../../../src/ai/ui/admin/aiProviderCardRegistry.js';
import type { AiProviderCardProps } from '../../../src/ai/ui/provider-cards.js';

const mockUseAiAdminConfig = vi.mocked(useAiAdminConfig);
const TYPED_KEY = 'asm-THIS-IS-A-TYPED-KEY-DO-NOT-RENDER';

function setHook(overrides: Partial<UseAiAdminConfigReturn> = {}, config: AiAdminConfig = mockAiAdminConfigWithExample) {
  const value: UseAiAdminConfigReturn = {
    config,
    isLoading: false,
    loadError: null,
    refresh: vi.fn().mockResolvedValue(undefined),
    isSaving: false,
    saveError: null,
    clearSaveError: vi.fn(),
    save: vi.fn().mockResolvedValue(true),
    keyAction: null,
    keyError: null,
    clearKeyError: vi.fn(),
    keyWarnings: [],
    clearKeyWarnings: vi.fn(),
    setKey: vi.fn().mockResolvedValue(true),
    removeKey: vi.fn().mockResolvedValue(true),
    probingProvider: null,
    probeError: null,
    clearProbeError: vi.fn(),
    testResults: {},
    clearTestResult: vi.fn(),
    test: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  mockUseAiAdminConfig.mockReturnValue(value);
  return value;
}

function renderPage(permissions: string[] = ['ai_config:read', 'ai_config:write']) {
  const user = userEvent.setup();
  render(<AiConfigPage />, { wrapperOptions: { user: { permissions } } });
  return user;
}

const card = (id: string) => screen.getByTestId(`ai-provider-${id}`);
const saveButton = () => screen.getByRole('button', { name: /save changes/i });

describe('AiConfigPage — a provider an app registered (#924)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    resetAiProviderCardsForTests();
  });

  it('draws it from its descriptor: a switch, its own setting and a write-only key', () => {
    setHook();
    renderPage();
    const example = within(card('example-transcribe'));

    expect(example.getByRole('heading', { name: 'Example Transcribe' })).toBeInTheDocument();
    expect(example.getByRole('switch', { name: 'Enable Example Transcribe' })).not.toBeChecked();
    expect(example.getByRole('combobox', { name: 'Region' })).toHaveTextContent('us');
    expect(example.getByText('Processing region')).toBeInTheDocument();
    const key = example.getByLabelText(/Example Transcribe API key/);
    expect(key).toHaveAttribute('type', 'password');
    expect(key).toHaveValue('');
    expect(example.getByText(/no organization key is stored yet/i)).toBeInTheDocument();
  });

  it('saves { enabled, ...settings } in the one PUT, beside the built-ins unchanged', async () => {
    const hook = setHook();
    const user = renderPage();
    const example = within(card('example-transcribe'));

    await user.click(example.getByRole('switch', { name: 'Enable Example Transcribe' }));
    await user.click(example.getByRole('combobox', { name: 'Region' }));
    await user.click(screen.getByRole('option', { name: 'eu' }));
    await user.click(saveButton());

    await waitFor(() => expect(hook.save).toHaveBeenCalledTimes(1));
    expect(vi.mocked(hook.save).mock.calls[0]![0].providers).toEqual({
      openai: { enabled: false, baseUrl: null },
      'example-transcribe': { enabled: true, region: 'eu' },
    });
  });

  it('saves the typed key through the deployment-key route and clears it', async () => {
    const hook = setHook();
    const user = renderPage();
    const example = within(card('example-transcribe'));

    const field = example.getByLabelText(/Example Transcribe API key/);
    await user.type(field, TYPED_KEY);
    await user.click(example.getByRole('button', { name: /save key/i }));

    await waitFor(() => expect(hook.setKey).toHaveBeenCalledWith('example-transcribe', TYPED_KEY));
    await waitFor(() => expect(field).toHaveValue(''));
    expect(document.body.innerHTML).not.toContain(TYPED_KEY);
  });

  it('rejects a too-short key and tests with the stored or the typed one', async () => {
    const hook = setHook();
    const user = renderPage();
    const example = within(card('example-transcribe'));

    await user.type(example.getByLabelText(/Example Transcribe API key/), 'short');
    expect(example.getByText(/at least 8 characters/i)).toBeInTheDocument();
    expect(example.getByRole('button', { name: /save key/i })).toBeDisabled();
    expect(hook.setKey).not.toHaveBeenCalled();
  });

  it('shows a stored key by its hint and removes it only after REMOVE is typed', async () => {
    const config: AiAdminConfig = {
      ...mockAiAdminConfigWithExample,
      providers: mockAiAdminConfigWithExample.providers.map((provider) =>
        provider.id === 'example-transcribe'
          ? { ...provider, keyStatus: { configured: true, hint: '••••9z9z', updatedAt: null, updatedByUserId: null } }
          : provider,
      ),
    };
    const hook = setHook({}, config);
    const user = renderPage();
    const example = within(card('example-transcribe'));

    expect(example.getByLabelText(/Example Transcribe API key/)).toHaveAttribute('placeholder', '••••9z9z');
    expect(example.getByText(/a key is saved \(••••9z9z\)/i)).toBeInTheDocument();

    await user.click(example.getByRole('button', { name: /remove key/i }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/type remove to confirm/i), 'REMOVE');
    await user.click(within(dialog).getByRole('button', { name: /remove key/i }));
    await waitFor(() => expect(hook.removeKey).toHaveBeenCalledWith('example-transcribe'));
  });

  it('read-only admin: the switch, the setting and the key field are disabled', () => {
    setHook();
    renderPage(['ai_config:read']);
    const example = within(card('example-transcribe'));

    expect(example.getByRole('switch', { name: 'Enable Example Transcribe' })).toBeDisabled();
    expect(example.getByRole('combobox', { name: 'Region' })).toHaveAttribute('aria-disabled', 'true');
    expect(example.getByLabelText(/Example Transcribe API key/)).toBeDisabled();
  });

  it('a provider the API sent no descriptor for still renders, with its fields as text inputs', async () => {
    const hook = setHook({}, { ...mockAiAdminConfigWithExample, descriptors: undefined });
    const user = renderPage();
    const example = within(card('example-transcribe'));

    expect(example.getByLabelText('region')).toHaveValue('us');
    await user.click(example.getByRole('switch', { name: 'Enable Example Transcribe' }));
    await user.click(saveButton());
    await waitFor(() => expect(hook.save).toHaveBeenCalledTimes(1));
    expect(vi.mocked(hook.save).mock.calls[0]![0].providers['example-transcribe']).toEqual({ enabled: true, region: 'us' });
  });

  it('a registered card replaces the generated one for that id, and receives the descriptor', () => {
    const seen: Array<AiProviderCardProps['descriptor']> = [];
    function Bespoke(props: AiProviderCardProps): ReactElement {
      seen.push(props.descriptor);
      return <div data-testid={`ai-provider-${props.provider.id}`}>bespoke {props.provider.displayName}</div>;
    }
    registerAiProviderCard('example-transcribe', Bespoke);
    setHook();
    renderPage();

    expect(card('example-transcribe')).toHaveTextContent('bespoke Example Transcribe');
    expect(seen[0]?.id).toBe('example-transcribe');
    // The built-in beside it is untouched.
    expect(within(card('openai')).getByLabelText('Base URL')).toBeInTheDocument();
  });

  it('an app registration wins over a built-in card, whichever module loaded first', () => {
    function Mine(props: AiProviderCardProps): ReactElement {
      return <div data-testid={`ai-provider-${props.provider.id}`}>mine</div>;
    }
    registerAiProviderCard('openai', Mine);
    setHook();
    renderPage();

    expect(card('openai')).toHaveTextContent('mine');
  });

  it('a registered adapter with no definition stays the read-only card and is not sent back', async () => {
    const config: AiAdminConfig = {
      ...mockAiAdminConfigWithExample,
      providers: mockAiAdminConfigWithExample.providers.map((provider) =>
        provider.id === 'example-transcribe' ? { ...provider, configurable: false } : provider,
      ),
    };
    const hook = setHook({}, config);
    const user = renderPage();

    expect(within(card('example-transcribe')).getByText('Registered, not configurable yet')).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Enable OpenAI' }));
    await user.click(saveButton());
    await waitFor(() => expect(hook.save).toHaveBeenCalledTimes(1));
    expect(Object.keys(vi.mocked(hook.save).mock.calls[0]![0].providers)).toEqual(['openai']);
  });
});
