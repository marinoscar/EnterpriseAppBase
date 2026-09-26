/**
 * `/admin/settings/ai` (issue #429, epic #419).
 *
 * `useAiAdminConfig` is mocked, like `StorageConfigPage.test.tsx`: this suite
 * is about the PAGE — what each state renders, what is disabled for a
 * read-only admin, and what the page hands the hook. The hook's own plumbing
 * has its own test; the network round trip is `AiConfigPage.wire.test.tsx`.
 *
 * ⚠ THE NEGATIVE SECURITY INVARIANT. A key typed into the field must never be
 * rendered back after a save — the field is cleared once the server answers,
 * whatever it answered — and no stored key is ever rendered, only the mask.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render, mockAdminUser } from '../../utils/test-utils';
import type { AiAdminConfig } from '../../../services/ai';
import {
  mockAiAdminConfig,
  mockAiProbeResultFailed,
  mockAiProbeResultPassed,
} from '../../mocks/fixtures/ai';

vi.mock('../../../hooks/useAiAdminConfig', () => ({
  useAiAdminConfig: vi.fn(),
}));

vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}));

import { useAiAdminConfig } from '../../../hooks/useAiAdminConfig';
import type { UseAiAdminConfigReturn } from '../../../hooks/useAiAdminConfig';
import { usePermissions } from '../../../hooks/usePermissions';
import AiConfigPage from '../../../pages/Admin/AiConfigPage';

const mockUseAiAdminConfig = vi.mocked(useAiAdminConfig);
const mockUsePermissions = vi.mocked(usePermissions);

const WRITE = ['ai_config:read', 'ai_config:write'];
const READ_ONLY = ['ai_config:read'];

const TYPED_KEY = 'sk-THIS-IS-A-TYPED-KEY-DO-NOT-RENDER';

function setPermissions(granted: string[]) {
  mockUsePermissions.mockReturnValue({
    permissions: new Set(granted),
    roles: new Set(['admin']),
    hasPermission: (permission: string) => granted.includes(permission),
    hasAnyPermission: vi.fn(),
    hasAllPermissions: vi.fn(),
    hasRole: vi.fn(),
    hasAnyRole: vi.fn(),
    isAdmin: true,
  });
}

const noKeyConfig: AiAdminConfig = {
  ...mockAiAdminConfig,
  enabled: true,
  providers: [
    {
      ...mockAiAdminConfig.providers[0],
      enabled: true,
      keyStatus: { configured: false, hint: null, updatedAt: null, updatedByUserId: null },
    },
  ],
};

function setHook(overrides: Partial<UseAiAdminConfigReturn> = {}): UseAiAdminConfigReturn {
  const value: UseAiAdminConfigReturn = {
    config: mockAiAdminConfig,
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

function renderPage() {
  return render(<AiConfigPage />, { wrapperOptions: { user: mockAdminUser } });
}

describe('AiConfigPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPermissions(WRITE);
  });

  describe('states', () => {
    it('AI off: explains that AI is completely disabled', () => {
      setHook();
      renderPage();

      expect(screen.getByRole('heading', { level: 1, name: 'AI' })).toBeInTheDocument();
      expect(screen.getByRole('switch', { name: 'Enable AI for this deployment' })).not.toBeChecked();
      expect(screen.getByTestId('ai-disabled-notice')).toHaveTextContent(
        /AI is completely disabled: users see no AI features, and no AI requests are made/,
      );
      // The models page is unreachable while AI is off, so no link is offered.
      expect(screen.queryByRole('link', { name: /manage models/i })).not.toBeInTheDocument();
    });

    it('AI on with no key: no notice, an empty key field, and the models link', () => {
      setHook({ config: noKeyConfig });
      renderPage();

      expect(screen.getByRole('switch', { name: 'Enable AI for this deployment' })).toBeChecked();
      expect(screen.queryByTestId('ai-disabled-notice')).not.toBeInTheDocument();
      expect(screen.getByText(/no organization key is stored/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /remove key/i })).toBeDisabled();
      // Nothing to test with: no typed key, no stored key.
      expect(screen.getByRole('button', { name: /^test$/i })).toBeDisabled();
      expect(screen.getByRole('link', { name: /manage models/i })).toHaveAttribute(
        'href',
        '/admin/settings/ai/models',
      );
    });

    it('key configured: the mask is the placeholder and the helper text, never the key', () => {
      setHook();
      renderPage();

      const field = screen.getByLabelText('OpenAI API key');
      expect(field).toHaveAttribute('type', 'password');
      expect(field).toHaveAttribute('autocomplete', 'new-password');
      expect(field).toHaveValue('');
      expect(field).toHaveAttribute('placeholder', '••••abcd');
      expect(screen.getByText(/a key is saved \(••••abcd\).*leave this blank to keep it/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^test$/i })).toBeEnabled();
      expect(screen.getByRole('button', { name: /remove key/i })).toBeEnabled();
    });

    it('probe success renders a success alert with one row per check', () => {
      setHook({ testResults: { openai: mockAiProbeResultPassed } });
      renderPage();

      const result = screen.getByTestId('ai-test-result');
      expect(result).toHaveClass('MuiAlert-colorSuccess');
      expect(within(result).getByTestId('ai-check-credentials')).toBeInTheDocument();
      expect(within(result).getByTestId('ai-check-list_models')).toHaveTextContent('42 models');
      expect(within(result).getByTestId('ai-check-code-responses_smoke')).toHaveTextContent(
        'not_attempted',
      );
    });

    it('probe failure renders an error alert with the code and the verbatim error', () => {
      setHook({ testResults: { openai: mockAiProbeResultFailed } });
      renderPage();

      const result = screen.getByTestId('ai-test-result');
      expect(result).toHaveClass('MuiAlert-colorError');
      expect(within(result).getByTestId('ai-check-code-credentials')).toHaveTextContent(
        'AI_KEY_INVALID',
      );
      expect(within(result).getByTestId('ai-check-error-credentials')).toHaveTextContent(
        'Incorrect API key provided',
      );
      expect(within(result).getByText(/tested with the key typed above/i)).toBeInTheDocument();
    });

    it('read-only admin: every control visible and disabled, with a notice', () => {
      setPermissions(READ_ONLY);
      setHook({ config: noKeyConfig });
      renderPage();

      expect(screen.getByTestId('ai-read-only-notice')).toBeInTheDocument();
      expect(screen.getByRole('switch', { name: 'Enable AI for this deployment' })).toBeDisabled();
      expect(screen.getByRole('radio', { name: /fall back to the organization key/i })).toBeDisabled();
      expect(screen.getByRole('switch', { name: 'Log prompt content' })).toBeDisabled();
      expect(screen.getByRole('switch', { name: 'Enable OpenAI' })).toBeDisabled();
      expect(screen.getByLabelText('OpenAI API key')).toBeDisabled();
      expect(screen.getByRole('button', { name: /save key/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /^test$/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
    });

    it('redirects without ai_config:read', () => {
      setPermissions([]);
      setHook();
      renderPage();
      expect(screen.queryByRole('heading', { name: 'AI' })).not.toBeInTheDocument();
    });

    it('renders a load error', () => {
      setHook({ config: null, loadError: 'Failed to load the AI configuration' });
      renderPage();
      expect(screen.getByText('Failed to load the AI configuration')).toBeInTheDocument();
    });
  });

  describe('policy form', () => {
    it('saves the edited policy as one PUT body', async () => {
      const user = userEvent.setup();
      const hook = setHook();
      renderPage();

      const save = screen.getByRole('button', { name: /save changes/i });
      expect(save).toBeDisabled(); // clean form

      await user.click(screen.getByRole('switch', { name: 'Enable AI for this deployment' }));
      await user.click(screen.getByRole('switch', { name: 'Enable OpenAI' }));
      await user.clear(screen.getByLabelText('Maximum output tokens per call'));
      await user.click(save);

      await waitFor(() => expect(hook.save).toHaveBeenCalledTimes(1));
      expect(hook.save).toHaveBeenCalledWith({
        enabled: true,
        keyPolicy: 'byok',
        logPromptContent: false,
        // A full replace: a cleared cap and an absent base URL are sent as
        // explicit nulls, never omitted and never '' or 0.
        defaults: { maxOutputTokensCap: null, allowBackgroundRuns: true },
        providers: { openai: { enabled: true, baseUrl: null } },
      });
      expect(await screen.findByText('AI configuration saved')).toBeInTheDocument();
    });

    it('warns when the org-fallback policy is chosen, naming keyless providers', async () => {
      const user = userEvent.setup();
      setHook({ config: noKeyConfig });
      renderPage();

      expect(screen.queryByTestId('ai-org-fallback-warning')).not.toBeInTheDocument();
      await user.click(screen.getByRole('radio', { name: /fall back to the organization key/i }));

      const warning = screen.getByTestId('ai-org-fallback-warning');
      expect(warning).toHaveTextContent(/organization pays for users without a key/i);
      expect(warning).toHaveTextContent(/no organization key is stored yet for OpenAI/i);
    });

    it('warns about prompt logging when it is switched on', async () => {
      const user = userEvent.setup();
      setHook();
      renderPage();

      await user.click(screen.getByRole('switch', { name: 'Log prompt content' }));
      expect(screen.getByTestId('ai-log-prompts-warning')).toHaveTextContent(/personal or confidential/i);
    });

    it('blocks an invalid token cap and an invalid base URL', async () => {
      const user = userEvent.setup();
      setHook();
      renderPage();

      await user.clear(screen.getByLabelText('Maximum output tokens per call'));
      await user.type(screen.getByLabelText('Maximum output tokens per call'), '-5');
      expect(screen.getByText(/whole number greater than zero/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();

      await user.clear(screen.getByLabelText('Maximum output tokens per call'));
      await user.click(screen.getByText('Advanced'));
      await user.type(screen.getByLabelText('Base URL'), 'not a url');
      expect(screen.getByText(/must be a full url/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
    });

    it('shows a save error', () => {
      setHook({ saveError: 'Someone else changed the AI configuration while you were editing.' });
      renderPage();
      expect(screen.getByText(/someone else changed/i)).toBeInTheDocument();
    });
  });

  describe('provider key', () => {
    it('saves the typed key and clears it from the field', async () => {
      const user = userEvent.setup();
      const hook = setHook();
      renderPage();

      const field = screen.getByLabelText('OpenAI API key');
      await user.type(field, TYPED_KEY);
      await user.click(screen.getByRole('button', { name: /save key/i }));

      await waitFor(() => expect(hook.setKey).toHaveBeenCalledWith('openai', TYPED_KEY));
      await waitFor(() => expect(field).toHaveValue(''));
      expect(document.body.innerHTML).not.toContain(TYPED_KEY);
    });

    it('clears the typed key even when the provider refused it', async () => {
      const user = userEvent.setup();
      setHook({ setKey: vi.fn().mockResolvedValue(false) });
      renderPage();

      const field = screen.getByLabelText('OpenAI API key');
      await user.type(field, TYPED_KEY);
      await user.click(screen.getByRole('button', { name: /save key/i }));

      await waitFor(() => expect(field).toHaveValue(''));
    });

    it('rejects a too-short key before sending anything', async () => {
      const user = userEvent.setup();
      const hook = setHook();
      renderPage();

      await user.type(screen.getByLabelText('OpenAI API key'), 'short');
      expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /save key/i })).toBeDisabled();
      expect(hook.setKey).not.toHaveBeenCalled();
    });

    it('tests with the typed key, or with the stored one when blank', async () => {
      const user = userEvent.setup();
      const hook = setHook();
      renderPage();

      await user.click(screen.getByRole('button', { name: /^test$/i }));
      expect(hook.test).toHaveBeenLastCalledWith('openai', { apiKey: '', baseUrl: undefined });

      await user.type(screen.getByLabelText('OpenAI API key'), TYPED_KEY);
      await user.click(screen.getByRole('button', { name: /^test$/i }));
      expect(hook.test).toHaveBeenLastCalledWith('openai', { apiKey: TYPED_KEY, baseUrl: undefined });
    });

    it('shows a key error on the card', () => {
      setHook({ keyError: { provider: 'openai', message: 'The provider rejected this key' } });
      renderPage();
      expect(screen.getByText('The provider rejected this key')).toBeInTheDocument();
    });

    it('removes the key only after REMOVE is typed', async () => {
      const user = userEvent.setup();
      const hook = setHook();
      renderPage();

      await user.click(screen.getByRole('button', { name: /remove key/i }));
      const dialog = await screen.findByRole('dialog');
      const confirm = within(dialog).getByRole('button', { name: /remove key/i });
      expect(confirm).toBeDisabled();

      await user.type(within(dialog).getByLabelText(/type remove to confirm/i), 'remove');
      expect(confirm).toBeDisabled(); // capitals required

      await user.clear(within(dialog).getByLabelText(/type remove to confirm/i));
      await user.type(within(dialog).getByLabelText(/type remove to confirm/i), 'REMOVE');
      await user.click(confirm);

      await waitFor(() => expect(hook.removeKey).toHaveBeenCalledWith('openai'));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('surfaces the ORG_FALLBACK_WITHOUT_KEY warning after a removal', () => {
      setHook({ keyWarnings: ['ORG_FALLBACK_WITHOUT_KEY'] });
      renderPage();
      expect(screen.getByTestId('ai-org-fallback-without-key')).toBeInTheDocument();
    });
  });
});
