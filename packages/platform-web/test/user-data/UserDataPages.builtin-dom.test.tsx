/**
 * The user-data pages' markup did not move (PP-14.24).
 *
 * `FactoryResetPage` and `UserDangerZonePage` gained the page-slot contract
 * (`PageSlotsBase`, `copy`) and print the kept and deleted lists the summary
 * routes return instead of constants in the bundle. The snapshot beside this
 * file (`__snapshots__/`) was RECORDED FROM THE PAGES AS THEY WERE BEFORE THAT
 * CHANGE (the same fixtures, rendered by the old pages), so passing means that
 * with the lists the platform returns (the text the constants held), and with a
 * summary that failed to load, the page is, element for element and class for
 * class, the one it was.
 *
 * The only normalisation is React's and MUI's generated ids. Re-record only for
 * a deliberate change of a page.
 */
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FactoryResetSummary } from '@marinoscar/platform-contract/user-data';

import { createTestApiError } from '../../src/testing/index.js';
import { FactoryResetPage, UserDangerZonePage } from '../../src/user-data/ui/index.js';
import { LISTS, SUMMARY, hostWith, renderWithHost } from './fixtures.js';

const html = (root: Element): string => root.innerHTML.replace(/_r_[0-9a-z]+_/g, '_rX_').replace(/:r[0-9a-z]+:/g, ':rX:');

const RESET: FactoryResetSummary = {
  disabledReason: null,
  otherUsers: 4,
  organizations: 1,
  storageObjects: 12,
  jobs: 30,
  categories: [{ id: 'files', label: 'Files', count: 12 }],
  ...LISTS.reset,
};

describe("the user-data pages' markup is unchanged", () => {
  it('the factory reset page, loaded', async () => {
    const { container } = renderWithHost(hostWith({ 'GET /admin/factory-reset/summary': RESET }), <FactoryResetPage />);
    await screen.findByText('Other users: 4');
    expect(html(container)).toMatchSnapshot();
  });

  it('the factory reset page, disabled in saas mode', async () => {
    const { container } = renderWithHost(
      hostWith({ 'GET /admin/factory-reset/summary': { ...RESET, disabledReason: 'FACTORY_RESET_DISABLED_IN_SAAS' } }),
      <FactoryResetPage />,
    );
    await screen.findByText(/disabled in SaaS mode/);
    await screen.findByText('Other users: 4');
    expect(html(container)).toMatchSnapshot();
  });

  it('the factory reset page, summary failed', async () => {
    const { container } = renderWithHost(
      hostWith({ 'GET /admin/factory-reset/summary': () => Promise.reject(createTestApiError(500, 'down')) }),
      <FactoryResetPage />,
    );
    await screen.findByText(/Could not load the summary/);
    expect(html(container)).toMatchSnapshot();
  });

  it('the danger zone page, loaded', async () => {
    const { container } = renderWithHost(hostWith({ 'GET /user-data/summary': { ...SUMMARY, ...LISTS.user } }), <UserDangerZonePage />);
    await screen.findByText('Files: 2 (2.0 KB)');
    expect(html(container)).toMatchSnapshot();
  });

  it('the danger zone page, summary failed', async () => {
    const { container } = renderWithHost(
      hostWith({ 'GET /user-data/summary': () => Promise.reject(createTestApiError(500, 'down')) }),
      <UserDangerZonePage />,
    );
    await screen.findByText(/Could not load what you own/);
    expect(html(container)).toMatchSnapshot();
  });
});
