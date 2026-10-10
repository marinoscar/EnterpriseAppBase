// The onboarding headless slice (issue #745): one fetch, inert without a
// provider, writes through PATCH /user-settings with If-Match (409 retried
// once), optimistic overlay, the Getting started action.
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { PlatformHostProvider } from '../../src/core/index.js';
import {
  ONBOARDING_INERT,
  OnboardingProvider,
  createOnboardingClient,
  useGettingStartedAction,
  useOnboarding,
} from '../../src/onboarding/headless/index.js';
import { createTestApiError } from '../../src/testing/index.js';
import { hostWith, response } from './fixtures.js';

describe('useOnboarding', () => {
  it('is inert without a provider and requests nothing', () => {
    const host = hostWith({});
    const { result } = renderHook(() => useOnboarding(), {
      wrapper: ({ children }: { children: ReactNode }) => <PlatformHostProvider host={host}>{children}</PlatformHostProvider>,
    });
    expect(result.current).toBe(ONBOARDING_INERT);
    expect(host.requests).toEqual([]);
  });

  it('fetches once for every consumer under the provider', async () => {
    const host = hostWith({ 'GET /onboarding': response() });
    function Consumer({ id }: { id: string }) {
      const { state } = useOnboarding();
      return <div data-testid={id}>{state ? `${state.user.completed}/${state.user.total}` : 'loading'}</div>;
    }
    render(
      <PlatformHostProvider host={host}>
        <OnboardingProvider>
          <Consumer id="a" />
          <Consumer id="b" />
        </OnboardingProvider>
      </PlatformHostProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('a').textContent).toBe('1/2'));
    expect(screen.getByTestId('b').textContent).toBe('1/2');
    expect(host.requests.filter((r) => r.path === '/onboarding')).toHaveLength(1);
  });

  it('does not fetch without user_settings:read', async () => {
    const host = hostWith({ 'GET /onboarding': response() }, []);
    const { result } = renderHook(() => useOnboarding(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <PlatformHostProvider host={host}>
          <OnboardingProvider>{children}</OnboardingProvider>
        </PlatformHostProvider>
      ),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.state).toBeNull();
    expect(host.requests).toEqual([]);
  });

  it('writes optimistically through PATCH /user-settings with If-Match, then re-reads', async () => {
    let seen = false;
    const host = hostWith({
      'GET /onboarding': () => response({}, { welcomeSeenAt: seen ? '2026-10-08T00:00:00.000Z' : null }),
      'GET /user-settings': { version: 4 },
      'PATCH /user-settings': () => {
        seen = true;
        return {};
      },
    });
    const { result } = renderHook(() => useOnboarding(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <PlatformHostProvider host={host}>
          <OnboardingProvider>{children}</OnboardingProvider>
        </PlatformHostProvider>
      ),
    });
    await waitFor(() => expect(result.current.state).not.toBeNull());
    await act(() => result.current.markWelcomeSeen({ goal: 'strength' }));

    const patch = host.requests.find((r) => r.method === 'PATCH');
    expect(patch).toEqual(
      expect.objectContaining({ path: '/user-settings', ifMatch: '4', body: { onboarding: expect.objectContaining({ goal: 'strength', welcomeSeenAt: expect.any(String) }) } }),
    );
    expect(result.current.state?.settings.welcomeSeenAt).toBe('2026-10-08T00:00:00.000Z');
    expect(host.requests.filter((r) => r.path === '/onboarding')).toHaveLength(2);
  });

  it('keeps the overlay and reports the error when a write fails', async () => {
    const host = hostWith({
      'GET /onboarding': response(),
      'GET /user-settings': { version: 1 },
      'PATCH /user-settings': () => {
        throw createTestApiError(500, 'Save failed');
      },
    });
    const { result } = renderHook(() => useOnboarding(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <PlatformHostProvider host={host}>
          <OnboardingProvider>{children}</OnboardingProvider>
        </PlatformHostProvider>
      ),
    });
    await waitFor(() => expect(result.current.state).not.toBeNull());
    await act(() => result.current.setSkipped('user.notifications', true));
    expect(result.current.error).toBe('Save failed');
    expect(result.current.state?.user.steps.find((s) => s.id === 'user.notifications')?.skipped).toBe(true);
    expect(result.current.state?.user.allResolved).toBe(true);
  });

  it('clears the welcome and dismissals from the Getting started action', async () => {
    const host = hostWith({
      'GET /onboarding': response({}, { welcomeSeenAt: '2026-01-01T00:00:00.000Z', checklistDismissedAt: '2026-01-01T00:00:00.000Z' }),
      'GET /user-settings': { version: 2 },
      'PATCH /user-settings': {},
    });
    const { result } = renderHook(() => useGettingStartedAction(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <PlatformHostProvider host={host}>
          <OnboardingProvider>{children}</OnboardingProvider>
        </PlatformHostProvider>
      ),
    });
    await waitFor(() => expect(result.current.visible).toBe(true));
    await act(() => result.current.run());
    expect(host.requests.find((r) => r.method === 'PATCH')?.body).toEqual({
      onboarding: { welcomeSeenAt: null, checklistDismissedAt: null, adminDismissedAt: null },
    });
  });
});

describe('createOnboardingClient', () => {
  it('sends refresh=true, the metrics window, and retries a 409 once with the new version', async () => {
    let version = 1;
    let conflicts = 1;
    const host = hostWith({
      'GET /onboarding?refresh=true': response(),
      'GET /admin/onboarding/metrics?days=7': { windowDays: 7, cohortSize: 0, milestones: [], steps: [] },
      'GET /user-settings': () => ({ version }),
      'PATCH /user-settings': () => {
        if (conflicts-- > 0) {
          version = 2;
          throw createTestApiError(409, 'Version mismatch');
        }
        return {};
      },
    });
    const client = createOnboardingClient(host.api);
    await client.get({ refresh: true });
    await client.metrics(7);
    await client.write({ checklistDismissedAt: '2026-10-08T00:00:00.000Z' });
    expect(host.requests.filter((r) => r.method === 'PATCH').map((r) => r.ifMatch)).toEqual(['1', '2']);
  });
});
