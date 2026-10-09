/**
 * `hooks/useAiModels.ts` — issue #429, epic #419.
 *
 *   - The filter is passed through, and a new filter VALUE refetches while a
 *     rebuilt-but-equal object does not.
 *   - Enabling is optimistic and rolls back on a refusal.
 *   - A refresh resolves the job id; a 409 (no org key) is worded, not thrown.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('../../../src/ai/headless/client.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/ai/headless/client.js')>('../../../src/ai/headless/client.js');
  return {
    ...actual,
    listAiModels: vi.fn(),
    updateAiModel: vi.fn(),
    refreshAiModels: vi.fn(),
  };
});

import { listAiModels, refreshAiModels, updateAiModel } from '../../../src/ai/headless/client.js';
import type { AiModelListFilter } from '../../../src/ai/headless/types.js';
import { ApiError } from '../harness.js';
import { useAiModels } from '../../../src/ai/headless/use-ai-models.js';
import { mockAiModelList, mockAiModels } from '../fixtures.js';

const mockList = vi.mocked(listAiModels);
const mockUpdate = vi.mocked(updateAiModel);
const mockRefresh = vi.mocked(refreshAiModels);

async function renderLoaded(initial: AiModelListFilter = { page: 1, pageSize: 20 }) {
  const hook = renderHook(({ filter }) => useAiModels(filter), {
    initialProps: { filter: initial },
  });
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  return hook;
}

describe('useAiModels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue(mockAiModelList);
  });

  it('loads a page for the filter it is given', async () => {
    const { result } = await renderLoaded({ provider: 'openai', page: 1, pageSize: 20 });
    expect(mockList).toHaveBeenCalledWith(expect.anything(), { provider: 'openai', page: 1, pageSize: 20 });
    expect(result.current.models).toHaveLength(mockAiModels.length);
    expect(result.current.total).toBe(mockAiModels.length);
  });

  it('refetches on a new filter value but not on an equal, rebuilt object', async () => {
    const hook = await renderLoaded({ page: 1, pageSize: 20 });
    expect(mockList).toHaveBeenCalledTimes(1);

    hook.rerender({ filter: { page: 1, pageSize: 20 } });
    expect(mockList).toHaveBeenCalledTimes(1);

    hook.rerender({ filter: { page: 1, pageSize: 20, q: 'gpt' } });
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
    expect(mockList).toHaveBeenLastCalledWith(expect.anything(), { page: 1, pageSize: 20, q: 'gpt' });
  });

  it('reports a load failure', async () => {
    mockList.mockRejectedValue(new ApiError('Forbidden', 403, 'FORBIDDEN'));
    const { result } = await renderLoaded();
    expect(result.current.error).toMatch(/do not have permission/i);
  });

  describe('setEnabled', () => {
    it('flips the row at once and keeps the server answer', async () => {
      const model = mockAiModels[1]; // disabled
      let resolve!: (value: typeof model) => void;
      mockUpdate.mockReturnValue(new Promise((r) => (resolve = r)));
      const { result } = await renderLoaded();

      let pending!: Promise<boolean>;
      act(() => {
        pending = result.current.setEnabled(model, true);
      });

      // Optimistic: flipped before the server answered.
      expect(result.current.models.find((m) => m.id === model.id)?.enabled).toBe(true);
      expect(result.current.pendingIds.has(model.id)).toBe(true);

      await act(async () => {
        resolve({ ...model, enabled: true });
        expect(await pending).toBe(true);
      });

      expect(mockUpdate).toHaveBeenCalledWith(expect.anything(), model.id, { enabled: true });
      expect(result.current.pendingIds.has(model.id)).toBe(false);
    });

    it('rolls back on a refusal and words it from details.reason', async () => {
      const model = mockAiModels[2]; // unclassified, disabled
      mockUpdate.mockRejectedValue(
        new ApiError('Model is unclassified', 400, 'BAD_REQUEST', {
          reason: 'AI_MODEL_UNCLASSIFIED',
        }),
      );
      const { result } = await renderLoaded();

      let ok = true;
      await act(async () => {
        ok = await result.current.setEnabled(model, true);
      });

      expect(ok).toBe(false);
      expect(result.current.models.find((m) => m.id === model.id)?.enabled).toBe(false);
      expect(result.current.updateError).toMatch(/classify this model first/i);
    });

    it('words AI_MODEL_DEPRECATED as a withdrawn model', async () => {
      mockUpdate.mockRejectedValue(
        new ApiError('Conflict', 409, 'CONFLICT', { reason: 'AI_MODEL_DEPRECATED' }),
      );
      const { result } = await renderLoaded();

      await act(async () => {
        await result.current.setEnabled(mockAiModels[1], true);
      });

      expect(result.current.updateError).toMatch(/withdrawn by the provider/i);
    });
  });

  it('updateCapabilities sends the override and adopts the row', async () => {
    const model = mockAiModels[2];
    const capabilities = {
      capabilities: ['responses'],
      inputModalities: ['text'],
      outputModalities: ['text'],
    };
    mockUpdate.mockResolvedValue({ ...model, capabilities, capabilitySource: 'admin_override' });
    const { result } = await renderLoaded();

    let ok = false;
    await act(async () => {
      ok = await result.current.updateCapabilities(model, capabilities);
    });

    expect(ok).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(expect.anything(), model.id, { capabilities });
    expect(result.current.models.find((m) => m.id === model.id)?.capabilitySource).toBe(
      'admin_override',
    );
  });

  describe('refreshCatalog', () => {
    it('resolves the queued job id', async () => {
      mockRefresh.mockResolvedValue({ jobId: 'job-42', status: 'pending' });
      const { result } = await renderLoaded();

      let jobId: string | null = null;
      await act(async () => {
        jobId = await result.current.refreshCatalog('openai');
      });

      expect(jobId).toBe('job-42');
      expect(mockRefresh).toHaveBeenCalledWith(expect.anything(), 'openai');
    });

    it('explains AI_KEY_REQUIRED as a missing organization key', async () => {
      mockRefresh.mockRejectedValue(
        new ApiError('No key', 409, 'CONFLICT', { reason: 'AI_KEY_REQUIRED' }),
      );
      const { result } = await renderLoaded();

      let jobId: string | null = 'x';
      await act(async () => {
        jobId = await result.current.refreshCatalog('openai');
      });

      expect(jobId).toBeNull();
      expect(result.current.refreshError).toMatch(/no organization key/i);
      expect(result.current.isRefreshing).toBe(false);
    });
  });
});
