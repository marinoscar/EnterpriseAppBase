// Moved from the reference app (apps/web/src/__tests__/hooks/useWorkerNodes.test.ts, issue #854).
/**
 * The worker-fleet hooks — issue #271, epic #254.
 *
 * Two things here are worth asserting that nothing else can:
 *
 *   * THE POLL PAUSES WITH THE TAB, driven through a real
 *     `document.visibilitychange`. A timer that keeps firing in a hidden tab
 *     looks identical to one that does not, right up until a fleet page left
 *     open on a second monitor overnight has issued a few thousand queries —
 *     each one a `groupBy` over the jobs table — against the database the
 *     workers are competing for.
 *
 *   * THERE IS EXACTLY ONE `useVisiblePolling` in the slice. The issue's
 *     instruction was to reuse the one #266 wrote, not to write a second, and
 *     the test for that is an IDENTITY comparison rather than a promise in a
 *     comment: two implementations that behave identically today are two
 *     places the teardown can be got wrong tomorrow, and the second one is
 *     discovered months later in a load graph.
 *
 * The rest is the contract every hook in this app shares: a failure is a STRING
 * the page renders, never an exception a click handler has to catch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { ApiError } from '../../src/core/index.js';
import {
  useNodeActions,
  useNodeCredentials,
  useVisiblePolling,
  useWorkerNode,
  useWorkerNodes,
} from '../../src/nodes/headless/index.js';
import type { NodeCredential, WorkerNode } from '../../src/nodes/headless/index.js';
import { useVisiblePolling as internalUseVisiblePolling } from '../../src/nodes/headless/use-visible-polling.js';
import { credential as credentialFixture, fakeNodesApi, node as nodeFixture } from './harness.js';

// The fake nodes client stands in for the reference app's mocked
// `services/nodes.ts`; the hooks take it as their explicit client.
const api = fakeNodesApi();
const mockGetWorkerNodes = api.getWorkerNodes;
const mockGetWorkerNode = api.getWorkerNode;
const mockGetNodeCredentials = api.getNodeCredentials;
const mockDeleteWorkerNode = api.deleteWorkerNode;
const mockCreateNodeCredential = api.createNodeCredential;
const mockRevokeNodeCredential = api.revokeNodeCredential;

function node(overrides: Partial<WorkerNode> = {}): WorkerNode {
  return nodeFixture(overrides);
}

function credential(overrides: Partial<NodeCredential> = {}): NodeCredential {
  return credentialFixture(overrides);
}

// ---------------------------------------------------------------------------
// `document.hidden` is a getter in jsdom, so it is redefined rather than
// assigned. The event is dispatched separately because the browser fires it
// AFTER the property flips, and a hook that read the property off the event
// object rather than the document would otherwise pass here and fail in a
// browser.
// ---------------------------------------------------------------------------
let documentHidden = false;

function setTabHidden(hidden: boolean) {
  documentHidden = hidden;
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

describe('the fleet poll', () => {
  it('is the ONE `useVisiblePolling`, the one the Worker Nodes page and its hook share', () => {
    // Identity, not behaviour. Two functions that behave the same today are two
    // places the `visibilitychange` teardown can diverge tomorrow — see the
    // file header, and `use-visible-polling.ts` for why it was extracted
    // rather than copied when this page needed it. Both pages take it from the
    // headless entry (#854).
    expect(useVisiblePolling).toBe(internalUseVisiblePolling);
  });

  describe('pausing', () => {
    beforeEach(() => {
      documentHidden = false;
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => documentHidden,
      });
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      documentHidden = false;
    });

    it('polls the fleet while the tab is in front and STOPS once it is hidden', () => {
      const tick = vi.fn();
      renderHook(() => useVisiblePolling(tick, 1000));

      act(() => vi.advanceTimersByTime(2000));
      expect(tick).toHaveBeenCalledTimes(2);

      setTabHidden(true);
      act(() => vi.advanceTimersByTime(60_000));

      // Not "fewer calls" — NONE. A throttled-but-alive timer is exactly the
      // state a fleet page left open on a second monitor must not be in.
      expect(tick).toHaveBeenCalledTimes(2);
    });

    it('re-reads IMMEDIATELY when the tab comes back, then resumes', () => {
      const tick = vi.fn();
      renderHook(() => useVisiblePolling(tick, 1000));

      setTabHidden(true);
      act(() => vi.advanceTimersByTime(10_000));
      expect(tick).not.toHaveBeenCalled();

      // Without the catch-up, a tab restored after an hour would show hour-old
      // HEALTH PILLS for up to a full interval — stale data that looks live,
      // which is the one wrong answer this page must never give.
      setTabHidden(false);
      expect(tick).toHaveBeenCalledTimes(1);

      act(() => vi.advanceTimersByTime(1000));
      expect(tick).toHaveBeenCalledTimes(2);
    });
  });
});

describe('useWorkerNodes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWorkerNodes.mockResolvedValue([node()]);
  });

  it('loads the fleet on mount', async () => {
    const { result } = renderHook(() => useWorkerNodes(api));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.nodes).toHaveLength(1);
    expect(result.current.error).toBeNull();
    expect(mockGetWorkerNodes).toHaveBeenCalledTimes(1);
  });

  it('transports the API’s derived health rather than deriving one', async () => {
    // The hook must be a pipe. A node whose last heartbeat is ancient but whose
    // server-side verdict is `healthy` (the administrator widened
    // `nodes.staleHeartbeatSeconds`) has to arrive as `healthy`: any
    // client-side rule here would need a threshold this app never reads, and
    // would put the pill and the database into disagreement.
    mockGetWorkerNodes.mockResolvedValue([
      node({ lastHeartbeatAt: '1999-01-01T00:00:00.000Z', health: 'healthy' }),
    ]);
    const { result } = renderHook(() => useWorkerNodes(api));

    await waitFor(() => expect(result.current.nodes).toHaveLength(1));
    expect(result.current.nodes[0]!.health).toBe('healthy');
  });

  it('refreshes WITHOUT raising the loading flag, so the table keeps its state', async () => {
    const { result } = renderHook(() => useWorkerNodes(api));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.isLoading).toBe(false);
    expect(mockGetWorkerNodes).toHaveBeenCalledTimes(2);
  });

  it('reports a failure as a string and CLEARS the rows', async () => {
    mockGetWorkerNodes.mockRejectedValue(new ApiError('Boom', 500));
    const { result } = renderHook(() => useWorkerNodes(api));

    await waitFor(() => expect(result.current.error).toBe('Boom'));
    // Rows are not left standing under the banner: they carry a health verdict,
    // and "healthy" pills for nodes nobody has heard from since are worse than
    // an empty table.
    expect(result.current.nodes).toEqual([]);
  });

  it('names a 403 by its remedy, and says NODES rather than jobs', async () => {
    mockGetWorkerNodes.mockRejectedValue(new ApiError('Forbidden', 403));
    const { result } = renderHook(() => useWorkerNodes(api));

    await waitFor(() =>
      expect(result.current.error).toBe('You do not have permission to manage worker nodes'),
    );
  });
});

describe('useWorkerNode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads one node by id (#854)', async () => {
    mockGetWorkerNode.mockResolvedValue(node({ name: 'worker-b' }));
    const { result } = renderHook(() => useWorkerNode('11111111-1111-4111-8111-111111111111', api));

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockGetWorkerNode).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    expect(result.current.node?.name).toBe('worker-b');
    expect(result.current.error).toBeNull();
  });

  it('asks for nothing without an id', async () => {
    const { result } = renderHook(() => useWorkerNode(null, api));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockGetWorkerNode).not.toHaveBeenCalled();
    expect(result.current.node).toBeNull();
  });

  it('clears the node and reports the error when it is gone', async () => {
    mockGetWorkerNode.mockResolvedValueOnce(node());
    const { result } = renderHook(() => useWorkerNode('11111111-1111-4111-8111-111111111111', api));
    await waitFor(() => expect(result.current.node).not.toBeNull());

    mockGetWorkerNode.mockRejectedValueOnce(new ApiError('Node not found', 404));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.node).toBeNull();
    expect(result.current.error).toBe('Node not found');
  });

  it('names the permission on a 403', async () => {
    mockGetWorkerNode.mockRejectedValue(new ApiError('Forbidden', 403));
    const { result } = renderHook(() => useWorkerNode('11111111-1111-4111-8111-111111111111', api));
    await waitFor(() => expect(result.current.error).toBe('You do not have permission to manage worker nodes'));
  });
});

describe('useNodeCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetNodeCredentials.mockResolvedValue([credential()]);
  });

  it('loads on its own request, not behind the fleet’s', async () => {
    const { result } = renderHook(() => useNodeCredentials(api));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.credentials).toHaveLength(1);
    // The fleet endpoint was never touched: an operator revoking a leaked token
    // must not be waiting on a fleet query that is slow or failing.
    expect(mockGetWorkerNodes).not.toHaveBeenCalled();
  });

  it('never carries a raw token, because the list shape has no field for one', async () => {
    const { result } = renderHook(() => useNodeCredentials(api));

    await waitFor(() => expect(result.current.credentials).toHaveLength(1));
    expect(result.current.credentials[0]).not.toHaveProperty('token');
    expect(result.current.credentials[0]!.tokenPrefix).toBe('nod_1a2b');
  });

  it('clears the list on failure rather than showing a revoked credential as active', async () => {
    mockGetNodeCredentials.mockRejectedValue(new ApiError('Boom', 500));
    const { result } = renderHook(() => useNodeCredentials(api));

    await waitFor(() => expect(result.current.error).toBe('Boom'));
    expect(result.current.credentials).toEqual([]);
  });
});

describe('useNodeActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteWorkerNode.mockResolvedValue(undefined);
    mockRevokeNodeCredential.mockResolvedValue(undefined);
    mockCreateNodeCredential.mockResolvedValue({
      token: 'nod_secret_value',
      id: 'c1',
      name: 'build-box-01',
      tokenPrefix: 'nod_1a2b',
      expiresAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('deletes a node and tells the page to re-read', async () => {
    const onChanged = vi.fn();
    const { result } = renderHook(() => useNodeActions(onChanged, api));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.removeNode('node-1');
    });

    expect(ok).toBe(true);
    expect(mockDeleteWorkerNode).toHaveBeenCalledWith('node-1');
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('reports a failed delete as `false` and a string, and does NOT refresh', async () => {
    mockDeleteWorkerNode.mockRejectedValue(new ApiError('Node not found', 404));
    const onChanged = vi.fn();
    const { result } = renderHook(() => useNodeActions(onChanged, api));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.removeNode('node-1');
    });

    expect(ok).toBe(false);
    expect(result.current.error).toBe('Node not found');
    // A refresh fired on a failed write would re-read state that did not change
    // and make the failure look like a race.
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('hands the raw token back to the caller and keeps NO copy of it', async () => {
    const { result } = renderHook(() => useNodeActions(undefined, api));

    let created: Awaited<ReturnType<typeof result.current.createCredential>> = null;
    await act(async () => {
      created = await result.current.createCredential({ name: 'build-box-01' });
    });

    expect(created).toMatchObject({ token: 'nod_secret_value' });
    // A secret that cannot be re-fetched must not outlive the component that
    // displays it, so nothing on the hook's own surface carries it.
    expect(JSON.stringify(result.current)).not.toContain('nod_secret_value');
  });

  it('omits `expiresInDays` entirely for a credential that never expires', async () => {
    const { result } = renderHook(() => useNodeActions(undefined, api));

    await act(async () => {
      await result.current.createCredential({ name: 'build-box-01' });
    });

    const body = mockCreateNodeCredential.mock.calls[0]![0];
    // ABSENCE is what the schema reads as "no expiry"; an explicit null would
    // be a validation failure expressing the same intent.
    expect(body).toEqual({ name: 'build-box-01' });
    expect(body).not.toHaveProperty('expiresInDays');
  });

  it('revokes a credential and immediately tells the page to re-read the list', async () => {
    const onChanged = vi.fn();
    const { result } = renderHook(() => useNodeActions(onChanged, api));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.revokeCredential('cred-1');
    });

    expect(ok).toBe(true);
    expect(mockRevokeNodeCredential).toHaveBeenCalledWith('cred-1');
    // This is what makes revocation visible in the list without a manual
    // refresh: the write resolves, THEN the page re-reads. Never in parallel —
    // a refresh racing its own mutation is how a revoked credential flickers
    // back to "Active" for a frame.
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight flag across all three writes', async () => {
    const { result } = renderHook(() => useNodeActions(undefined, api));
    expect(result.current.isWorking).toBe(false);

    let resolveDelete: (() => void) | undefined;
    mockDeleteWorkerNode.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveDelete = resolve;
      }),
    );

    let pending: Promise<boolean> | undefined;
    act(() => {
      pending = result.current.removeNode('node-1');
    });
    await waitFor(() => expect(result.current.isWorking).toBe(true));

    await act(async () => {
      resolveDelete?.();
      await pending;
    });
    expect(result.current.isWorking).toBe(false);
  });

  it('clears its error on demand', async () => {
    mockRevokeNodeCredential.mockRejectedValue(new ApiError('Nope', 404));
    const { result } = renderHook(() => useNodeActions(undefined, api));

    await act(async () => {
      await result.current.revokeCredential('cred-1');
    });
    expect(result.current.error).toBe('Nope');

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});
