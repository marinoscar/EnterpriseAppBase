/**
 * The app's onboarding binding (#745): its feature notice registration
 * (`platform/onboarding.ts`), the reference examples
 * (`platform-extensions/onboarding/`), and the packaged hooks and sections
 * they build on, against a test platform host.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { OnboardingResponse } from '@marinoscar/platform-contract/onboarding';
import { PlatformHostProvider } from '@marinoscar/platform-web/core';
import {
  OnboardingProvider,
  createOnboardingClient,
  featureNoticeFor,
  useGettingStartedAction,
  useOnboardingMetrics,
} from '@marinoscar/platform-web/onboarding/headless';
import { ActivationMetrics, FeatureUnavailableNotice, WelcomeDialog } from '@marinoscar/platform-web/onboarding/ui';
import { createTestPlatformHost } from '@marinoscar/platform-web/testing';
import type { TestPlatformHost } from '@marinoscar/platform-web/testing';

import '../../platform/onboarding';
import { GetStartedCard } from '../../platform-extensions/onboarding/GetStartedCard.example';
import { RoleWelcomePane } from '../../platform-extensions/onboarding/RoleWelcomePane.example';

function onboarding(settings: Partial<OnboardingResponse['settings']> = {}): OnboardingResponse {
  const step = (id: string, status: 'done' | 'todo') => ({
    id,
    audience: 'user' as const,
    tier: 'optional' as const,
    status,
    title: `Title ${id}`,
    description: 'd',
    actionLabel: 'Go',
    href: `/to/${id}`,
    detail: null,
    blockedReason: null,
    skippable: true,
    skipped: false,
  });
  return {
    settings: { welcomeSeenAt: null, checklistDismissedAt: null, adminDismissedAt: null, skipped: [], ...settings },
    user: { steps: [step('user.profile', 'done'), step('user.notifications', 'todo')], completed: 1, total: 2, requiredDone: true, allResolved: false },
    admin: null,
  };
}

function hostFor(response: OnboardingResponse, permissions = ['user_settings:read']): TestPlatformHost {
  return createTestPlatformHost({
    permissions,
    responses: {
      'GET /onboarding': response,
      'GET /user-settings': { version: 3 },
      'PATCH /user-settings': {},
      'GET /admin/onboarding/metrics?days=30': {
        windowDays: 30,
        cohortSize: 2,
        milestones: [],
        steps: [{ id: 'user.profile', title: 'Complete your profile', completed: 1, rate: 0.5 }],
      },
    },
  });
}

function withOnboarding(host: TestPlatformHost, element: ReactElement) {
  return render(
    <MemoryRouter>
      <PlatformHostProvider host={host}>
        <OnboardingProvider appName="Base">{element}</OnboardingProvider>
      </PlatformHostProvider>
    </MemoryRouter>,
  );
}

describe('the app onboarding registrations', () => {
  it('adds a telemetry feature notice gated on telemetry:read', () => {
    expect(featureNoticeFor('telemetry')).toEqual({
      feature: 'telemetry',
      label: 'Telemetry',
      adminPermission: 'telemetry:read',
      setupHref: '/admin/settings/telemetry',
    });
    render(
      <MemoryRouter>
        <PlatformHostProvider host={createTestPlatformHost({ permissions: ['telemetry:read'] })}>
          <FeatureUnavailableNotice feature="telemetry" />
        </PlatformHostProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText("Telemetry isn't enabled yet")).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Set it up' }).getAttribute('href')).toBe('/admin/settings/telemetry');
  });
});

describe('GetStartedCard (example)', () => {
  it('lists the derived steps in words and hides itself when dismissed', async () => {
    const host = hostFor(onboarding());
    withOnboarding(host, <GetStartedCard />);
    const card = await screen.findByTestId('get-started-card');
    expect(within(card).getByTestId('onboarding-progress-text').textContent).toBe('1 of 2 done');
    fireEvent.click(within(card).getByRole('button', { name: 'Hide' }));
    await waitFor(() => expect(screen.queryByTestId('get-started-card')).toBeNull());
    expect(host.requests.find((r) => r.method === 'PATCH')).toEqual(
      expect.objectContaining({ ifMatch: '3', body: { onboarding: { checklistDismissedAt: expect.any(String) } } }),
    );
  });
});

describe('RoleWelcomePane (example slot)', () => {
  it('stores the chosen role with the welcome-seen write', async () => {
    const host = hostFor(onboarding());
    withOnboarding(host, <WelcomeDialog slots={{ userPane: (pane) => <RoleWelcomePane {...pane} /> }} />);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleDescription(/What brings you here/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'I run it' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Get started' }));
    await waitFor(() =>
      expect(host.requests.find((r) => r.method === 'PATCH')?.body).toEqual({
        onboarding: { role: 'operator', welcomeSeenAt: expect.any(String) },
      }),
    );
  });
});

describe('the packaged hooks and sections the app uses', () => {
  it('useGettingStartedAction reopens the welcome and the checklists', async () => {
    const host = hostFor(onboarding({ welcomeSeenAt: '2026-01-01T00:00:00.000Z' }));
    const { result } = renderHook(() => useGettingStartedAction(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <PlatformHostProvider host={host}>
          <OnboardingProvider>{children}</OnboardingProvider>
        </PlatformHostProvider>
      ),
    });
    await waitFor(() => expect(result.current.visible).toBe(true));
    await result.current.run();
    expect(host.requests.find((r) => r.method === 'PATCH')?.body).toEqual({
      onboarding: { welcomeSeenAt: null, checklistDismissedAt: null, adminDismissedAt: null },
    });
  });

  it('useOnboardingMetrics and ActivationMetrics read the aggregates, as text', async () => {
    const host = hostFor(onboarding(), ['system_settings:read']);
    const client = createOnboardingClient(host.api);
    const { result } = renderHook(() => useOnboardingMetrics(30, client));
    await waitFor(() => expect(result.current.metrics?.cohortSize).toBe(2));

    render(
      <MemoryRouter>
        <PlatformHostProvider host={host}>
          <ActivationMetrics />
        </PlatformHostProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Complete your profile: 1 of 2, 50%')).toBeTruthy();
  });
});
