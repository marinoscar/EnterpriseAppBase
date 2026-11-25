/**
 * The AI pages' markup did not move (PP-14.24).
 *
 * Every packaged AI page gained the page-slot contract (`PageSlotsBase`, plus
 * `ProviderCardExtra`, the table slots and a `Sections` position). The snapshot
 * beside this file (`__snapshots__/`) was RECORDED FROM THE PAGES AS THEY WERE
 * BEFORE THAT CHANGE (the same fixtures, rendered by the old components), so
 * passing means the page an administrator or a user sees with no slot passed is,
 * element for element and class for class, the one they had.
 *
 * The only normalisation is React's and MUI's generated ids and the locale text
 * of the "last updated" line. Re-record only for a deliberate change of a page.
 */
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render } from './harness.js';
import {
  mockAiAdminConfig,
  mockAiModels,
  mockAiUsageReport,
  mockUsableAiModels,
  mockUserAiKeys,
} from './fixtures.js';
import type { AiAdminConfig } from '../../src/ai/headless/types.js';

vi.mock('../../src/ai/headless/use-ai-admin-config.js', () => ({ useAiAdminConfig: vi.fn() }));
vi.mock('../../src/ai/headless/use-ai-models.js', () => ({ useAiModels: vi.fn() }));
vi.mock('../../src/ai/headless/use-ai-usage.js', () => ({ useAiUsage: vi.fn(), useMyAiUsage: vi.fn() }));

import { useAiAdminConfig } from '../../src/ai/headless/use-ai-admin-config.js';
import type { UseAiAdminConfigReturn } from '../../src/ai/headless/use-ai-admin-config.js';
import { useAiModels } from '../../src/ai/headless/use-ai-models.js';
import { useAiUsage, useMyAiUsage } from '../../src/ai/headless/use-ai-usage.js';
import {
  AiConfigPage,
  AiModelsPage,
  AiPlaygroundPage,
  AiUsagePage,
  OrgAiKeysPage,
  UserAiKeysPage,
} from '../../src/ai/ui/index.js';

const html = (root: Element): string =>
  root.innerHTML
    .replace(/_r_[0-9a-z]+_/g, '_rX_')
    .replace(/(Last updated by [^<]*? on )[^<]*/g, '$1<date>');

const WRITE = ['ai_config:read', 'ai_config:write', 'ai:use'];
const READ = ['ai_config:read', 'ai:use'];

const CONFIG: AiAdminConfig = { ...mockAiAdminConfig, enabled: true };

function adminHook(config: AiAdminConfig | null): UseAiAdminConfigReturn {
  return {
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
  };
}

describe("the AI pages' markup is unchanged", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAiAdminConfig).mockReturnValue(adminHook(CONFIG));
    vi.mocked(useAiModels).mockReturnValue({
      models: mockAiModels,
      total: mockAiModels.length,
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
      refreshCatalog: vi.fn().mockResolvedValue('job-1'),
    } as unknown as ReturnType<typeof useAiModels>);
    vi.mocked(useAiUsage).mockImplementation(
      (query) =>
        ({
          report: mockAiUsageReport(query.groupBy),
          isLoading: false,
          error: null,
          refresh: vi.fn().mockResolvedValue(undefined),
        }) as unknown as ReturnType<typeof useAiUsage>,
    );
    vi.mocked(useMyAiUsage).mockReturnValue({
      report: null,
      isLoading: false,
      error: null,
      refresh: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useMyAiUsage>);
  });

  it('the AI configuration page, writable', () => {
    const { container } = render(<AiConfigPage />, { wrapperOptions: { user: { permissions: WRITE } } });
    expect(html(container)).toMatchSnapshot();
  });

  it('the AI configuration page, read-only', () => {
    const { container } = render(<AiConfigPage />, { wrapperOptions: { user: { permissions: READ } } });
    expect(html(container)).toMatchSnapshot();
  });

  it('the AI models page, writable and read-only', () => {
    const writable = render(<AiModelsPage />, { wrapperOptions: { user: { permissions: WRITE } } });
    expect(html(writable.container)).toMatchSnapshot();
    writable.unmount();
    const readOnly = render(<AiModelsPage />, { wrapperOptions: { user: { permissions: READ } } });
    expect(html(readOnly.container)).toMatchSnapshot();
  });

  it('the AI usage page', () => {
    const { container } = render(<AiUsagePage />, { wrapperOptions: { user: { permissions: READ } } });
    expect(html(container)).toMatchSnapshot();
  });

  it('the AI keys page', async () => {
    const { container } = render(<UserAiKeysPage />, {
      wrapperOptions: { user: { permissions: ['ai:use'] }, aiEnabled: true },
      responses: {
        'GET /ai/keys': mockUserAiKeys,
        'GET /ai/models': mockUsableAiModels,
        'GET /user-settings': { ai: {} },
        'GET /ai/usage/me': { range: { from: '2026-09-01T00:00:00.000Z', to: '2026-09-30T00:00:00.000Z' }, groupBy: 'day', totals: mockAiUsageReport('day').totals, series: [] },
      },
    });
    await screen.findByText('AI Keys');
    await waitFor(() => expect(container.querySelector('[aria-label="Loading AI keys"]')).toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(html(container)).toMatchSnapshot();
  });

  it('the organization AI keys page', async () => {
    const { container } = render(<OrgAiKeysPage />, {
      wrapperOptions: { user: { permissions: ['org_ai_config:read'] } },
      responses: {
        'GET /admin/ai/org-keys': [
          { provider: 'openai', displayName: 'OpenAI', configured: true, hint: '••••9999', verifiedAt: '2026-10-01T12:00:00.000Z' },
          { provider: 'anthropic', displayName: 'Anthropic', configured: false, hint: null, verifiedAt: null },
        ],
        'GET /org-settings': {
          effective: { ai: { enabled: true, keyPolicy: 'byok_with_org_fallback', limits: { perOrg: { requestsPerDay: 500 } } } },
        },
      },
    });
    await screen.findByTestId('org-ai-key-openai');
    await screen.findByText(/Requests per day for the organization: 500/);
    expect(html(container).replace(/verified [^<]*/, 'verified <date>')).toMatchSnapshot();
  });

  it('the AI playground page', async () => {
    const { container } = render(<AiPlaygroundPage />, {
      wrapperOptions: { user: { permissions: ['ai:use'] }, aiEnabled: true },
      responses: { 'GET /ai/models': mockUsableAiModels, 'GET /user-settings': { ai: {} } },
    });
    await screen.findByText('AI Playground');
    await waitFor(() => expect(container.querySelector('[aria-label="Loading models"]')).toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(html(container)).toMatchSnapshot();
  });
});
