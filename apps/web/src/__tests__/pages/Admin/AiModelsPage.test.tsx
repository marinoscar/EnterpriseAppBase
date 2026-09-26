/**
 * `/admin/settings/ai/models` (issue #429, epic #419).
 *
 * `useAiModels`, `useAiAdminConfig` and `usePermissions` are mocked: this
 * suite is about what the PAGE renders for each row and what it asks the
 * hooks to do. The optimistic toggle and its rollback are proved end to end
 * in `AiModelsPage.wire.test.tsx`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render, mockAdminUser } from '../../utils/test-utils';
import type { AiAdminConfig, AiModel } from '../../../services/ai';
import { mockAiAdminConfig, mockAiModels } from '../../mocks/fixtures/ai';

vi.mock('../../../hooks/useAiModels', () => ({ useAiModels: vi.fn() }));
vi.mock('../../../hooks/useAiAdminConfig', () => ({ useAiAdminConfig: vi.fn() }));
vi.mock('../../../hooks/usePermissions', () => ({ usePermissions: vi.fn() }));

import { useAiModels } from '../../../hooks/useAiModels';
import type { UseAiModelsReturn } from '../../../hooks/useAiModels';
import { useAiAdminConfig } from '../../../hooks/useAiAdminConfig';
import type { UseAiAdminConfigReturn } from '../../../hooks/useAiAdminConfig';
import { usePermissions } from '../../../hooks/usePermissions';
import AiModelsPage from '../../../pages/Admin/AiModelsPage';

const mockUseAiModels = vi.mocked(useAiModels);
const mockUseAiAdminConfig = vi.mocked(useAiAdminConfig);
const mockUsePermissions = vi.mocked(usePermissions);

const deprecatedModel: AiModel = {
  ...mockAiModels[0],
  id: 'model-4',
  modelId: 'gpt-4-legacy',
  displayName: 'GPT-4 legacy',
  enabled: false,
  deprecatedAt: '2026-08-01T00:00:00.000Z',
};

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

function setConfig(config: AiAdminConfig | null = mockAiAdminConfig) {
  mockUseAiAdminConfig.mockReturnValue({
    config,
    isLoading: false,
    loadError: null,
  } as unknown as UseAiAdminConfigReturn);
}

function setModels(overrides: Partial<UseAiModelsReturn> = {}): UseAiModelsReturn {
  const models = overrides.models ?? mockAiModels;
  const value: UseAiModelsReturn = {
    models,
    total: models.length,
    isLoading: false,
    error: null,
    refetch: vi.fn().mockResolvedValue(undefined),
    pendingIds: new Set(),
    updateError: null,
    clearUpdateError: vi.fn(),
    setEnabled: vi.fn().mockResolvedValue(true),
    updateCapabilities: vi.fn().mockResolvedValue(true),
    isRefreshing: false,
    refreshError: null,
    clearRefreshError: vi.fn(),
    refreshCatalog: vi.fn().mockResolvedValue('job-ai-refresh-1'),
    ...overrides,
  };
  mockUseAiModels.mockReturnValue(value);
  return value;
}

function renderPage() {
  return render(<AiModelsPage />, { wrapperOptions: { user: mockAdminUser } });
}

describe('AiModelsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPermissions(['ai_config:read', 'ai_config:write']);
    setConfig();
  });

  it('renders the title and one row per model', async () => {
    setModels();
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'AI Models' })).toBeInTheDocument();
    expect(await screen.findByText('gpt-5-mini')).toBeInTheDocument();
    expect(screen.getByText('GPT-5 mini')).toBeInTheDocument();
    expect(screen.getByText('text-embedding-3-small')).toBeInTheDocument();
    expect(screen.getByText('ft:custom-model')).toBeInTheDocument();
  });

  it('groups capabilities into labelled chips', async () => {
    setModels();
    renderPage();
    await screen.findByText('gpt-5-mini');

    // gpt-5-mini carries text/vision/structured/tools/reasoning.
    for (const label of ['Text', 'Reasoning', 'Tools', 'Structured', 'Vision']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText('Embeddings').length).toBeGreaterThan(0);
  });

  it('shows the source as a text chip, unclassified included', async () => {
    setModels();
    renderPage();
    await screen.findByText('gpt-5-mini');

    expect(screen.getAllByText('catalog').length).toBe(2);
    expect(screen.getByText('unclassified')).toBeInTheDocument();
  });

  it('toggles a classified model through the hook', async () => {
    const user = userEvent.setup();
    const hook = setModels();
    renderPage();

    const toggle = await screen.findByRole('switch', { name: 'Enable text-embedding-3-small' });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);

    expect(hook.setEnabled).toHaveBeenCalledWith(mockAiModels[1], true);
  });

  it('disables the switch of an unclassified model', async () => {
    setModels();
    renderPage();

    expect(await screen.findByRole('switch', { name: 'Enable ft:custom-model' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Enable gpt-5-mini' })).toBeEnabled();
  });

  it('marks a withdrawn model and disables its switch', async () => {
    setModels({ models: [...mockAiModels, deprecatedModel] });
    renderPage();

    expect(await screen.findByText('Withdrawn by provider')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Enable gpt-4-legacy' })).toBeDisabled();
  });

  it('passes the toolbar filters to the hook', async () => {
    const user = userEvent.setup();
    setModels();
    renderPage();

    expect(mockUseAiModels).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 });

    await user.click(screen.getByRole('switch', { name: 'Show deprecated models' }));
    expect(mockUseAiModels).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeDeprecated: true }),
    );

    await user.click(screen.getByRole('combobox', { name: 'Provider' }));
    await user.click(await screen.findByRole('option', { name: 'OpenAI' }));
    expect(mockUseAiModels).toHaveBeenLastCalledWith(
      expect.objectContaining({ provider: 'openai', includeDeprecated: true }),
    );

    await user.click(screen.getByRole('combobox', { name: 'Capability' }));
    await user.click(await screen.findByRole('option', { name: 'Embeddings' }));
    expect(mockUseAiModels).toHaveBeenLastCalledWith(
      expect.objectContaining({ capability: 'embeddings' }),
    );
  });

  describe('refresh', () => {
    it('queues a refresh and links to the jobs page', async () => {
      const user = userEvent.setup();
      const hook = setModels();
      renderPage();

      await user.click(screen.getByRole('button', { name: /refresh from provider/i }));

      expect(hook.refreshCatalog).toHaveBeenCalledWith('openai');
      expect(await screen.findByText('Refresh queued (job job-ai-refresh-1)')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /view jobs/i })).toHaveAttribute(
        'href',
        '/admin/settings/jobs',
      );
    });

    it('is disabled when no provider has an organization key', () => {
      setConfig({
        ...mockAiAdminConfig,
        providers: [
          {
            ...mockAiAdminConfig.providers[0],
            keyStatus: { configured: false, hint: null, updatedAt: null, updatedByUserId: null },
          },
        ],
      });
      setModels();
      renderPage();

      expect(screen.getByRole('button', { name: /refresh from provider/i })).toBeDisabled();
    });

    it('renders a refresh error', () => {
      setModels({ refreshError: 'This provider has no organization key' });
      renderPage();
      expect(screen.getByText('This provider has no organization key')).toBeInTheDocument();
    });
  });

  describe('edit capabilities', () => {
    it('classifies an unclassified model through the override dialog', async () => {
      const user = userEvent.setup();
      const hook = setModels();
      renderPage();

      // A single row action renders inline, named after the row.
      await user.click(
        await screen.findByRole('button', { name: 'Edit capabilities for ft:custom-model' }),
      );

      const dialog = await screen.findByRole('dialog');
      const save = within(dialog).getByRole('button', { name: /save capabilities/i });
      expect(save).toBeDisabled(); // nothing chosen yet

      await user.click(within(dialog).getByRole('checkbox', { name: 'Text responses' }));
      await user.click(within(dialog).getByRole('checkbox', { name: 'Reasoning' }));
      const [inputText] = within(dialog).getAllByRole('checkbox', { name: 'text' });
      await user.click(inputText);
      expect(save).toBeDisabled(); // no output modality yet
      await user.click(within(dialog).getAllByRole('checkbox', { name: 'text' })[1]);
      await user.click(within(dialog).getByRole('checkbox', { name: 'high' }));
      await user.type(within(dialog).getByLabelText('Context window (tokens)'), '128000');
      await user.click(save);

      await waitFor(() =>
        expect(hook.updateCapabilities).toHaveBeenCalledWith(mockAiModels[2], {
          capabilities: ['responses', 'reasoning'],
          inputModalities: ['text'],
          outputModalities: ['text'],
          reasoningEfforts: ['high'],
          contextWindow: 128000,
        }),
      );
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });
  });

  it('empty catalogue explains how to discover models', async () => {
    setModels({ models: [] });
    renderPage();
    expect(await screen.findByTestId('ai-models-empty')).toHaveTextContent(
      'Save an admin key and refresh to discover models.',
    );
  });

  it('read-only admin: switches disabled, no row actions, refresh disabled', async () => {
    setPermissions(['ai_config:read']);
    setModels();
    renderPage();

    expect(screen.getByTestId('ai-models-read-only-notice')).toBeInTheDocument();
    expect(await screen.findByRole('switch', { name: 'Enable gpt-5-mini' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /edit capabilities/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh from provider/i })).toBeDisabled();
  });

  it('renders an update error', () => {
    setModels({ updateError: 'Classify this model first' });
    renderPage();
    expect(screen.getByTestId('ai-models-update-error')).toHaveTextContent('Classify this model first');
  });
});
