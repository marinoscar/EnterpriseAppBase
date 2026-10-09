import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { FactoryResetSummary } from '@marinoscar/platform-contract/user-data';

import { createTestApiError } from '../../src/testing/index.js';
import { FactoryResetPage } from '../../src/user-data/ui/index.js';
import { hostWith, renderWithHost } from './fixtures.js';

const SUMMARY: FactoryResetSummary = {
  disabledReason: null,
  otherUsers: 4,
  organizations: 1,
  storageObjects: 12,
  jobs: 30,
  categories: [{ id: 'files', label: 'Files', count: 12 }],
};

describe('FactoryResetPage', () => {
  it('warns, links to the backup page first, and shows the counts', async () => {
    renderWithHost(hostWith({ 'GET /admin/factory-reset/summary': SUMMARY }), <FactoryResetPage />);
    expect(screen.getByText(/cannot be undone/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Database Backup' })).toHaveAttribute('href', '/admin/settings/db-backup');
    expect(await screen.findByText('Other users: 4')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'What is kept' })).toBeInTheDocument();
  });

  it('renders the static lists when the summary fails', async () => {
    renderWithHost(hostWith({ 'GET /admin/factory-reset/summary': () => Promise.reject(createTestApiError(500, 'down')) }), <FactoryResetPage />);
    expect(await screen.findByText(/Could not load the summary/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'What is deleted' })).toBeInTheDocument();
  });

  it('is off in saas mode, saying why', async () => {
    renderWithHost(hostWith({ 'GET /admin/factory-reset/summary': { ...SUMMARY, disabledReason: 'FACTORY_RESET_DISABLED_IN_SAAS' } }), <FactoryResetPage />);
    expect(await screen.findByText(/disabled in SaaS mode/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Factory reset' })).toBeDisabled();
  });

  it('needs the checkbox and FACTORY RESET exactly, then shows the result', async () => {
    const user = userEvent.setup();
    const host = hostWith({
      'GET /admin/factory-reset/summary': SUMMARY,
      'POST /admin/factory-reset': { jobId: 'j', status: 'pending' },
      'GET /admin/factory-reset/j': { jobId: 'j', status: 'succeeded', result: { counts: { users: 4, storageObjectsDeleted: 12, storageObjectsFailed: 0 } }, error: null },
    });
    renderWithHost(host, <FactoryResetPage pollIntervalMs={10} />);
    await screen.findByText('Other users: 4');
    await user.click(screen.getByRole('button', { name: 'Factory reset' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Factory reset' });
    await user.type(within(dialog).getByLabelText(/Type FACTORY RESET/), 'FACTORY RESET');
    expect(confirm).toBeDisabled();
    await user.click(within(dialog).getByRole('checkbox'));
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(await within(dialog).findByText('Done.', undefined, { timeout: 8000 })).toBeInTheDocument();
    expect(within(dialog).getByText('Users')).toBeInTheDocument();
    expect(within(dialog).queryByText(/could not be deleted/)).not.toBeInTheDocument();
    expect(host.requests.find((r) => r.method === 'POST')?.body).toEqual({ confirmation: 'FACTORY RESET' });
  });

  it('re-reads the viewer through the host after the reset, and still calls the app callback', async () => {
    const user = userEvent.setup();
    const base = hostWith({
      'GET /admin/factory-reset/summary': SUMMARY,
      'POST /admin/factory-reset': { jobId: 'j', status: 'pending' },
      'GET /admin/factory-reset/j': { jobId: 'j', status: 'succeeded', result: { counts: { users: 4 } }, error: null },
    });
    const refresh = vi.fn().mockResolvedValue(undefined);
    const onCompleted = vi.fn();
    const host = { ...base, viewer: { ...base.viewer, refresh } } as typeof base;
    renderWithHost(host, <FactoryResetPage pollIntervalMs={10} onCompleted={onCompleted} />);
    await screen.findByText('Other users: 4');
    await user.click(screen.getByRole('button', { name: 'Factory reset' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Type FACTORY RESET/), 'FACTORY RESET');
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Factory reset' }));
    await within(dialog).findByText('Done.', undefined, { timeout: 8000 });
    expect(onCompleted).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
