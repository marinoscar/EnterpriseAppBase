// The onboarding UI (issue #745): the welcome dialog shows once and every
// exit marks it seen; the checklist states status in words; the Setup guide
// shows the tier groups and Re-check; the feature notice shows "Set it up"
// only to the admin permission's holders.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PlatformHostProvider } from '../../src/core/index.js';
import { registerFeatureNotice, useGettingStartedAction } from '../../src/onboarding/headless/index.js';
import {
  FeatureUnavailableNotice,
  GettingStartedPage,
  OnboardingChecklist,
  SetupGuidePage,
  WelcomeDialog,
  gettingStartedSettingsPage,
  setupGuideSettingsPage,
} from '../../src/onboarding/ui/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ADMIN_BLOCK, hostWith, renderWithOnboarding, response, stateful, step } from './fixtures.js';

const writes = () => ({ 'GET /user-settings': { version: 1 }, 'PATCH /user-settings': {} });

describe('WelcomeDialog', () => {
  it('opens while welcomeSeenAt is null, labelled and described, and Later marks it seen', async () => {
    const host = hostWith(stateful(response()));
    renderWithOnboarding(host, <WelcomeDialog />);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleName('Welcome to Acme');
    expect(dialog).toHaveAccessibleDescription(/short checklist/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Later' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(host.requests.find((r) => r.method === 'PATCH')?.body).toEqual({ onboarding: { welcomeSeenAt: expect.any(String) } });
  });

  it('marks it seen on Escape too', async () => {
    const host = hostWith({ 'GET /onboarding': response(), ...writes() });
    renderWithOnboarding(host, <WelcomeDialog />);
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(host.requests.some((r) => r.method === 'PATCH')).toBe(true));
  });

  it('stays closed once seen', async () => {
    const host = hostWith({ 'GET /onboarding': response({}, { welcomeSeenAt: '2026-01-01T00:00:00.000Z' }) });
    renderWithOnboarding(host, <WelcomeDialog />);
    await waitFor(() => expect(host.requests).toHaveLength(1));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('points an administrator at the Setup guide', async () => {
    const admin = hostWith(stateful(response({ admin: ADMIN_BLOCK })));
    renderWithOnboarding(admin, <WelcomeDialog />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start setup' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/admin/settings/setup'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('renders the app slot for users and stores what it collected with the seen write', async () => {
    const user = hostWith(stateful(response()));
    renderWithOnboarding(
      user,
      <WelcomeDialog
        slots={{
          userPane: ({ descriptionId, setExtra }) => (
            <p id={descriptionId}>
              Pick a goal <button onClick={() => setExtra({ goal: 'strength' })}>Strength</button>
            </p>
          ),
        }}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Strength' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Get started' }));
    await waitFor(() =>
      expect(user.requests.find((r) => r.method === 'PATCH')?.body).toEqual({ onboarding: { goal: 'strength', welcomeSeenAt: expect.any(String) } }),
    );
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/settings/getting-started'));
  });

  it('comes back after Getting started clears the stored state', async () => {
    const host = hostWith(stateful(response({}, { welcomeSeenAt: '2026-01-01T00:00:00.000Z' })));
    function Reopen() {
      const action = useGettingStartedAction();
      return <button onClick={() => void action.run()}>{action.label}</button>;
    }
    renderWithOnboarding(host, <><WelcomeDialog /><Reopen /></>);
    fireEvent.click(await screen.findByRole('button', { name: 'Getting started' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });
});

describe('OnboardingChecklist', () => {
  it('states each status in words, with "n of m done" progress, and links the steps to do', () => {
    render(
      <MemoryRouter>
        <OnboardingChecklist
          steps={[
            step('user.a', { status: 'done' }),
            step('user.b', { detail: 'Add one.' }),
            step('user.c', { status: 'blocked', blockedReason: 'Needs a key.' }),
            step('user.d', { skipped: true }),
          ]}
          completed={1}
          total={4}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('onboarding-progress-text').textContent).toBe('1 of 4 done');
    expect(screen.getByTestId('onboarding-step-user.a').textContent).toContain('Done');
    expect(screen.getByTestId('onboarding-step-user.b').textContent).toContain('To do · Add one.');
    expect(screen.getByTestId('onboarding-step-user.c').textContent).toContain('Blocked · Needs a key.');
    expect(screen.getByTestId('onboarding-step-user.d').textContent).toContain('Skipped');
    expect(screen.getByRole('link', { name: /Title user.b/ }).getAttribute('href')).toBe('/to/user.b');
    expect(screen.queryByRole('link', { name: /Title user.a/ })).toBeNull();
  });

  it('groups by tier', () => {
    render(
      <MemoryRouter>
        <OnboardingChecklist steps={ADMIN_BLOCK!.steps} completed={1} total={3} grouped label="Setup" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('list', { name: 'Required' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Recommended' })).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Optional' })).toBeNull();
  });
});

describe('SetupGuidePage', () => {
  it('shows the required and recommended groups and re-checks with refresh=true', async () => {
    const host = hostWith(
      {
        'GET /onboarding': response({ admin: ADMIN_BLOCK }),
        'GET /onboarding?refresh=true': response({ admin: ADMIN_BLOCK }),
        'GET /admin/onboarding/metrics?days=30': { windowDays: 30, cohortSize: 0, milestones: [], steps: [] },
      },
      ['user_settings:read', 'system_settings:read'],
    );
    renderWithOnboarding(host, <SetupGuidePage />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(setupGuideSettingsPage.card.title);
    expect(await screen.findByRole('list', { name: 'Required' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Recommended' })).toBeTruthy();
    expect(screen.getByText(/Configure storage\./)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open the Doctor/ }).getAttribute('href')).toBe('/admin/settings/doctor');
    expect(await screen.findByText('No new users in this window')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Re-check' }));
    await waitFor(() => expect(host.requests.some((r) => r.path === '/onboarding?refresh=true')).toBe(true));
  });

  it('writes the activation numbers as text', async () => {
    const host = hostWith(
      {
        'GET /onboarding': response({ admin: ADMIN_BLOCK }),
        'GET /admin/onboarding/metrics?days=30': {
          windowDays: 30,
          cohortSize: 4,
          milestones: [{ id: 'first', label: 'First thing', windowDays: 7, eligible: 4, activated: 1, activationRate: 0.25, medianHours: 12 }],
          steps: [{ id: 'user.profile', title: 'Complete your profile', completed: 2, rate: 0.5 }],
        },
      },
      ['user_settings:read', 'system_settings:read'],
    );
    renderWithOnboarding(host, <SetupGuidePage />);
    expect(await screen.findByText('25%')).toBeTruthy();
    expect(screen.getByText('1 of 4 eligible · median 12 h')).toBeTruthy();
    expect(screen.getByText('Complete your profile: 2 of 4, 50%')).toBeTruthy();
  });
});

describe('GettingStartedPage', () => {
  it('lists the user steps, skips one and shows the welcome again', async () => {
    const host = hostWith({ 'GET /onboarding': response(), ...writes() });
    renderWithOnboarding(host, <GettingStartedPage />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(gettingStartedSettingsPage.card.title);
    fireEvent.click(await screen.findByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(host.requests.find((r) => r.method === 'PATCH')?.body).toEqual({ onboarding: { skipped: ['user.notifications'] } }));
    fireEvent.click(screen.getByRole('button', { name: 'Show the welcome again' }));
    await waitFor(() => expect(host.requests.filter((r) => r.method === 'PATCH')).toHaveLength(2));
  });
});

describe('FeatureUnavailableNotice', () => {
  const renderNotice = (permissions: string[], feature = 'ai') =>
    render(
      <MemoryRouter>
        <PlatformHostProvider host={createTestPlatformHost({ permissions })}>
          <FeatureUnavailableNotice feature={feature} />
        </PlatformHostProvider>
      </MemoryRouter>,
    );

  it('offers "Set it up" only to holders of the admin permission', () => {
    renderNotice(['ai_config:read']);
    expect(screen.getByText("AI isn't enabled yet")).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Set it up' }).getAttribute('href')).toBe('/admin/settings/ai');
  });

  it('tells everyone else their administrator has not set it up', () => {
    renderNotice([], 'storage');
    expect(screen.getByText("Storage isn't enabled yet")).toBeTruthy();
    expect(screen.getByText("Your administrator hasn't set this up yet.")).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Set it up' })).toBeNull();
  });

  it('takes an app notice from the registry', () => {
    registerFeatureNotice({ feature: 'maps', label: 'Maps', adminPermission: 'maps:admin', setupHref: '/admin/settings/maps' });
    renderNotice(['maps:admin'], 'maps');
    expect(screen.getByRole('link', { name: 'Set it up' }).getAttribute('href')).toBe('/admin/settings/maps');
    expect(() => registerFeatureNotice({ feature: 'x', label: 'X', adminPermission: 'x:read', setupHref: 'admin' })).toThrow(/app route/);
  });
});
