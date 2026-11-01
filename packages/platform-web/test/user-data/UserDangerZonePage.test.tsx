import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createTestApiError } from '../../src/testing/index.js';
import { UserDangerZonePage } from '../../src/user-data/ui/index.js';
import { SUMMARY, hostWith, renderWithHost } from './fixtures.js';

const JOB = 'job-1';

describe('UserDangerZonePage', () => {
  it('renders the specific layer with counts, disabled at zero, then the composite scopes under a divider', async () => {
    renderWithHost(hostWith({ 'GET /user-data/summary': SUMMARY }), <UserDangerZonePage />);
    const specific = await screen.findByRole('region', { name: 'Delete specific data' });
    const rows = within(specific).getAllByRole('button', { name: 'Delete' });
    expect(rows[0]).toBeDisabled(); // transcripts: 0
    expect(rows[1]).toBeEnabled(); // notes: 3
    const danger = screen.getByRole('region', { name: 'Danger zone' });
    expect(within(danger).getByRole('button', { name: 'Delete all my data' })).toBeInTheDocument();
    expect(screen.getByText(/Files: 2 \(2\.0 KB\)/)).toBeInTheDocument();
  });

  it('keeps the static lists and the built-in scopes when the summary fails', async () => {
    renderWithHost(hostWith({ 'GET /user-data/summary': () => Promise.reject(createTestApiError(500, 'boom')) }), <UserDangerZonePage />);
    expect(await screen.findByText(/Could not load what you own/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Always kept' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete all my data' })).toBeInTheDocument();
  });

  it('confirms only with the checkbox and the exact phrase, cannot close while running, then lists counts and warns on kept files', async () => {
    const user = userEvent.setup();
    let release = false;
    const onCompleted = vi.fn();
    const host = hostWith({
      'GET /user-data/summary': SUMMARY,
      'POST /user-data/deletions': { jobId: JOB, status: 'pending' },
      [`GET /user-data/deletions/${JOB}`]: () => {
        return !release
          ? { jobId: JOB, status: 'running', scope: 'everything', result: null, error: null }
          : {
              jobId: JOB,
              status: 'succeeded',
              scope: 'everything',
              result: { categories: { files: 2, notes: 3, credentials: 0 }, models: {}, storageObjectsDeleted: 1, storageObjectsFailed: 1, cancelledJobs: 0, delegatedJobs: 0 },
              error: null,
            };
      },
    });
    renderWithHost(host, <UserDangerZonePage onCompleted={onCompleted} pollIntervalMs={10} />);
    await user.click(await screen.findByRole('button', { name: 'Delete all my data' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Delete' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Type DELETE MY DATA/), 'delete my data');
    await user.click(within(dialog).getByRole('checkbox'));
    expect(confirm).toBeDisabled(); // wrong case
    await user.clear(within(dialog).getByLabelText(/Type DELETE MY DATA/));
    await user.type(within(dialog).getByLabelText(/Type DELETE MY DATA/), 'DELETE MY DATA');
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    expect(await within(dialog).findByRole('status')).toHaveTextContent(/Working/);
    await user.keyboard('{Escape}');
    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: 'Delete all my data' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    release = true;

    expect(await within(dialog).findByText('Done.', undefined, { timeout: 8000 })).toBeInTheDocument();
    const list = within(dialog).getByRole('list', { name: 'What was deleted' });
    expect(within(list).getByText('Files')).toBeInTheDocument();
    expect(within(list).queryByText('Access tokens')).not.toBeInTheDocument(); // zero rows hidden
    expect(within(dialog).getByText(/could not be deleted from object storage/)).toBeInTheDocument();
    expect(onCompleted).toHaveBeenCalledTimes(1);
    expect(host.requests.find((r) => r.method === 'POST')?.body).toEqual({ scope: 'everything', confirmation: 'DELETE MY DATA' });
  });

  it('shows the API error and offers a retry', async () => {
    const user = userEvent.setup();
    const host = hostWith({
      'GET /user-data/summary': SUMMARY,
      'POST /user-data/deletions': () => Promise.reject(createTestApiError(400, 'Type exactly "DELETE MY DATA" to confirm')),
    });
    renderWithHost(host, <UserDangerZonePage />);
    await user.click(await screen.findByRole('button', { name: 'Delete all my data' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('checkbox'));
    await user.type(within(dialog).getByLabelText(/Type DELETE MY DATA/), 'DELETE MY DATA');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent(/Type exactly "DELETE MY DATA" to confirm/));
    expect(within(dialog).getByRole('button', { name: 'Retry' })).toBeEnabled();
  });
});
