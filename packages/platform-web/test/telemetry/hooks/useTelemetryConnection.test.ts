/**
 * `hooks/useTelemetryConnection.ts` — issue #558, epic #528.
 *
 * What a page test cannot assert directly:
 *   - `save` and `revert` pass the CONNECTION's loaded version (its own
 *     counter, not `/config`'s) as the expected version, and adopt the reply.
 *   - A 409 is `conflict`, not a generic `saveError`.
 *   - A failed DIAGNOSIS (200, success:false) lands in `testResult`; only a
 *     failed CALL lands in `testError`.
 *   - Writes resolve `true`/`false` and never throw.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

// The hook reads its client from the platform host; stand one in whose four
// connection calls are spies (#704: the app's module mock, moved).
const client = vi.hoisted(() => ({
  getTelemetryConnection: vi.fn(),
  updateTelemetryConnection: vi.fn(),
  resetTelemetryConnection: vi.fn(),
  testTelemetryConnection: vi.fn(),
}));
vi.mock('../../../src/telemetry/headless/services/client.js', () => ({
  useTelemetryClient: () => client,
  createTelemetryClient: () => client,
}));

import type { TelemetryConnectionInput } from '../../../src/telemetry/headless/services/telemetry.js';
import { createTestApiError } from '../../../src/testing/index.js';
import { useTelemetryConnection } from '../../../src/telemetry/headless/hooks/useTelemetryConnection.js';
import {
  mockTelemetryConnectionEnvironment,
  mockTelemetryConnectionStored,
  mockTelemetryConnectionTestResult,
} from '../fixtures/telemetry.js';

const mockGet = client.getTelemetryConnection;
const mockUpdate = client.updateTelemetryConnection;
const mockReset = client.resetTelemetryConnection;
const mockTest = client.testTelemetryConnection;

const input: TelemetryConnectionInput = {
  host: 'greptimedb',
  pgPort: 4003,
  database: 'public',
  readerUser: 'readonly',
  adminUser: null,
};

async function loaded() {
  const hook = renderHook(() => useTelemetryConnection());
  await waitFor(() => expect(hook.result.current.connection).not.toBeNull());
  return hook;
}

describe('useTelemetryConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue(mockTelemetryConnectionStored);
  });

  it('loads the connection', async () => {
    const { result } = await loaded();
    expect(result.current.connection).toEqual(mockTelemetryConnectionStored);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.loadError).toBeNull();
  });

  it('reports a load failure', async () => {
    mockGet.mockRejectedValue(createTestApiError(403, 'Forbidden'));
    const { result } = renderHook(() => useTelemetryConnection());
    await waitFor(() => expect(result.current.loadError).toBe('Forbidden'));
  });

  it('saves with the connection version and adopts the reply', async () => {
    const saved = { ...mockTelemetryConnectionStored, host: 'other', version: 4 };
    mockUpdate.mockResolvedValue(saved);
    const { result } = await loaded();

    let ok = false;
    await act(async () => {
      ok = await result.current.save(input);
    });
    expect(ok).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(input, mockTelemetryConnectionStored.version);
    expect(result.current.connection).toEqual(saved);
  });

  it('marks a 409 as a conflict, not an error', async () => {
    mockUpdate.mockRejectedValue(createTestApiError(409, 'Version mismatch'));
    const { result } = await loaded();

    let ok = true;
    await act(async () => {
      ok = await result.current.save(input);
    });
    expect(ok).toBe(false);
    expect(result.current.conflict).toBe(true);
    expect(result.current.saveError).toBeNull();

    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.conflict).toBe(false);
  });

  it('reports other save failures as saveError', async () => {
    mockUpdate.mockRejectedValue(createTestApiError(400, 'A reader password is required'));
    const { result } = await loaded();
    await act(async () => {
      await result.current.save(input);
    });
    expect(result.current.saveError).toBe('A reader password is required');
    expect(result.current.conflict).toBe(false);
  });

  it('reverts with the connection version', async () => {
    mockReset.mockResolvedValue(mockTelemetryConnectionEnvironment);
    const { result } = await loaded();

    let ok = false;
    await act(async () => {
      ok = await result.current.revert();
    });
    expect(ok).toBe(true);
    expect(mockReset).toHaveBeenCalledWith(mockTelemetryConnectionStored.version);
    expect(result.current.connection?.source).toBe('environment');
  });

  it('puts a failed diagnosis in testResult, and a failed call in testError', async () => {
    mockTest.mockResolvedValueOnce(mockTelemetryConnectionTestResult);
    const { result } = await loaded();

    await act(async () => {
      await result.current.test(input);
    });
    expect(mockTest).toHaveBeenCalledWith(input);
    expect(result.current.testResult).toEqual(mockTelemetryConnectionTestResult);
    expect(result.current.testError).toBeNull();

    mockTest.mockRejectedValueOnce(createTestApiError(403, 'Forbidden'));
    await act(async () => {
      await result.current.test(input);
    });
    expect(result.current.testResult).toBeNull();
    expect(result.current.testError).toBe('Forbidden');

    act(() => result.current.clearTestResult());
    expect(result.current.testError).toBeNull();
  });
});
