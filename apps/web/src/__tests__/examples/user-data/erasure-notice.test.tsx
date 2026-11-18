/**
 * PP-14.24: an app extends the packaged Danger Zone and factory reset pages
 * with no package edit: the lists come from the API (the app's registered kept
 * model and factory reset step add a line each), the page takes `copy` and the
 * page-slot contract.
 *
 * `apps/web/src/platform-extensions/user-data/ErasureNotice.example.tsx` is the
 * example; `apps/api/src/examples/user-data/user-data.examples.ts` registers the
 * API half. This renders the REAL packaged pages over MSW answering as the API
 * would with those registrations.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { FactoryResetPage, UserDangerZonePage } from '@marinoscar/platform-web/user-data/ui';
import { render, mockAdminUser } from '../../utils/test-utils';
import { server } from '../../mocks/server';
import { ERASURE_COPY, RetentionNotice } from '../../../platform-extensions/user-data/ErasureNotice.example';

const PLATFORM_USER_KEPT = [
  'Your account, your sign-in identities and your roles',
  'Your organization and group memberships',
  'This browser session (you stay signed in)',
  'The audit log',
];

const USER_SUMMARY = {
  categories: [{ id: 'files', label: 'Files', description: 'Uploads.', content: true, count: 2, bytes: 2048 }],
  scopes: [
    { id: 'everything', label: 'Delete all my data', description: 'All.', layer: 'danger', confirmation: 'DELETE MY DATA', categories: ['files'] },
  ],
  kept: [...PLATFORM_USER_KEPT, 'Your example preferences'],
};

const RESET_SUMMARY = {
  disabledReason: null,
  otherUsers: 4,
  organizations: 0,
  storageObjects: 12,
  jobs: 30,
  categories: [],
  deleted: ['Every other user, their sessions and their access tokens', 'Finished example jobs'],
  kept: ['Your account and this session', 'Your example preferences'],
};

describe('the user-data pages with an app copy, slot and API-registered lines (PP-14.24)', () => {
  beforeEach(() => {
    server.resetHandlers();
    server.use(
      http.get('*/api/user-data/summary', () => HttpResponse.json({ data: USER_SUMMARY })),
      http.get('*/api/admin/factory-reset/summary', () => HttpResponse.json({ data: RESET_SUMMARY })),
    );
  });

  it('the Danger Zone prints the app line after the platform lines, with the app copy and notice', async () => {
    render(<UserDangerZonePage copy={ERASURE_COPY} slots={{ AfterContent: RetentionNotice }} />, {
      wrapperOptions: { user: mockAdminUser },
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Erase my data' })).toBeInTheDocument();
    const kept = await screen.findByRole('list', { name: 'Always kept' });
    await screen.findByText('Files: 2 (2.0 KB)');
    await within(kept).findByText('Your example preferences');
    expect(within(kept).getAllByRole('listitem').map((item) => item.textContent)).toEqual([...PLATFORM_USER_KEPT, 'Your example preferences']);
    expect(screen.getByRole('heading', { name: 'What we hold about you' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What we must keep' })).toBeInTheDocument();
    expect(screen.getByTestId('retention-notice')).toBeInTheDocument();
  });

  it('the factory reset page prints the app step and kept model lines', async () => {
    render(<FactoryResetPage />, { wrapperOptions: { user: mockAdminUser } });
    await screen.findByText('Other users: 4');
    expect(within(screen.getByRole('list', { name: 'What is deleted' })).getByText('Finished example jobs')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'What is kept' })).getByText('Your example preferences')).toBeInTheDocument();
  });

  it('keeps the platform wording and no notice without copy and slots', async () => {
    render(<UserDangerZonePage />, { wrapperOptions: { user: mockAdminUser } });
    expect(screen.getByRole('heading', { level: 1, name: 'Delete my data' })).toBeInTheDocument();
    await screen.findByText('Files: 2 (2.0 KB)');
    expect(screen.getByRole('heading', { name: 'What you own' })).toBeInTheDocument();
    expect(screen.queryByTestId('retention-notice')).not.toBeInTheDocument();
  });
});
