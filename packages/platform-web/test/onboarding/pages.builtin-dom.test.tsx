/**
 * The onboarding pages' markup with NO slot did not move (PP-14.24b).
 *
 * `GettingStartedPage` and `SetupGuidePage` gained the page-slot contract
 * (`PageSlotsBase`). The snapshot beside this file (`__snapshots__/`) was
 * RECORDED FROM THE PAGES AS THEY WERE BEFORE THAT CHANGE (the same fixtures,
 * rendered by the old components), so passing means the pages a user sees with
 * no slot passed are, element for element and class for class, the ones they
 * had.
 *
 * The only normalisation is React's and MUI's generated ids. Re-record only for
 * a deliberate change of a page.
 */
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createTestApiError } from '../../src/testing/index.js';
import { GettingStartedPage, SetupGuidePage } from '../../src/onboarding/ui/index.js';
import { ADMIN_BLOCK, hostWith, renderWithOnboarding, response } from './fixtures.js';

function markup(root: HTMLElement): string {
  return root.innerHTML
    .replace(/_r_[0-9a-z]+_/g, '_r_N_')
    .replace(/:r[0-9a-z]+:/g, ':rN:')
    .replace(/></g, '>\n<');
}

const ADMIN_PERMISSIONS = ['user_settings:read', 'system_settings:read'];
const METRICS = {
  windowDays: 30,
  cohortSize: 4,
  milestones: [{ id: 'first', label: 'First thing', windowDays: 7, eligible: 4, activated: 1, activationRate: 0.25, medianHours: 12 }],
  steps: [{ id: 'user.profile', title: 'Complete your profile', completed: 2, rate: 0.5 }],
};
const EMPTY_METRICS = { windowDays: 30, cohortSize: 0, milestones: [], steps: [] };

describe('GettingStartedPage builtin markup', () => {
  it('loaded', async () => {
    const { container } = renderWithOnboarding(hostWith({ 'GET /onboarding': response() }), <GettingStartedPage />);
    await screen.findByRole('button', { name: 'Skip' });
    expect(markup(container)).toMatchSnapshot();
  });

  it('while loading', () => {
    const { container } = renderWithOnboarding(hostWith({ 'GET /onboarding': () => new Promise(() => undefined) }), <GettingStartedPage />);
    expect(markup(container)).toMatchSnapshot();
  });

  it('with nothing to set up', async () => {
    const empty = response({ user: { steps: [], completed: 0, total: 0, requiredDone: true, allResolved: true } });
    const { container } = renderWithOnboarding(hostWith({ 'GET /onboarding': empty }), <GettingStartedPage />);
    await screen.findByText('Nothing to set up right now.');
    expect(markup(container)).toMatchSnapshot();
  });

  it('when the state could not be read', async () => {
    const host = hostWith({ 'GET /onboarding': () => Promise.reject(createTestApiError(500, 'down')) });
    const { container } = renderWithOnboarding(host, <GettingStartedPage />);
    await screen.findByRole('alert');
    expect(markup(container)).toMatchSnapshot();
  });
});

describe('SetupGuidePage builtin markup', () => {
  it('loaded, with the activation numbers', async () => {
    const host = hostWith({ 'GET /onboarding': response({ admin: ADMIN_BLOCK }), 'GET /admin/onboarding/metrics?days=30': METRICS }, ADMIN_PERMISSIONS);
    const { container } = renderWithOnboarding(host, <SetupGuidePage />);
    await screen.findByText('25%');
    expect(markup(container)).toMatchSnapshot();
  });

  it('loaded, everything required done', async () => {
    const done = { ...ADMIN_BLOCK!, requiredDone: true };
    const host = hostWith({ 'GET /onboarding': response({ admin: done }), 'GET /admin/onboarding/metrics?days=30': EMPTY_METRICS }, ADMIN_PERMISSIONS);
    const { container } = renderWithOnboarding(host, <SetupGuidePage />);
    await screen.findByText('No new users in this window');
    expect(markup(container)).toMatchSnapshot();
  });

  it('with a footer and no activation section', async () => {
    const host = hostWith({ 'GET /onboarding': response({ admin: ADMIN_BLOCK }) }, ADMIN_PERMISSIONS);
    const { container } = renderWithOnboarding(host, <SetupGuidePage showActivation={false} footer={<p>Own section</p>} />);
    await screen.findByRole('list', { name: 'Required' });
    expect(markup(container)).toMatchSnapshot();
  });

  it('while loading', () => {
    const host = hostWith({ 'GET /onboarding': () => new Promise(() => undefined), 'GET /admin/onboarding/metrics?days=30': () => new Promise(() => undefined) }, ADMIN_PERMISSIONS);
    const { container } = renderWithOnboarding(host, <SetupGuidePage />);
    expect(markup(container)).toMatchSnapshot();
  });

  it('when the state could not be read', async () => {
    const host = hostWith(
      { 'GET /onboarding': () => Promise.reject(createTestApiError(500, 'down')), 'GET /admin/onboarding/metrics?days=30': EMPTY_METRICS },
      ADMIN_PERMISSIONS,
    );
    const { container } = renderWithOnboarding(host, <SetupGuidePage showActivation={false} />);
    await screen.findByRole('alert');
    expect(markup(container)).toMatchSnapshot();
  });
});
