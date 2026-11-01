import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FactoryResetSummary } from '@marinoscar/platform-contract/user-data';

import { FactoryResetPage, UserDangerZonePage } from '../../src/user-data/ui/index.js';
import { LISTS, SUMMARY, hostWith, renderWithHost } from './fixtures.js';

// PP-14.24: the lists the pages print come from the summary routes, the page
// takes `copy` and the page-slot contract.

const RESET: FactoryResetSummary = {
  disabledReason: null,
  otherUsers: 4,
  organizations: 1,
  storageObjects: 12,
  jobs: 30,
  categories: [{ id: 'files', label: 'Files', count: 12 }],
  ...LISTS.reset,
};

describe('the lists come from the summary', () => {
  it('prints the kept lines the API returned, including an app line', async () => {
    renderWithHost(
      hostWith({ 'GET /user-data/summary': { ...SUMMARY, kept: [...LISTS.user.kept, 'Your saved searches'] } }),
      <UserDangerZonePage />,
    );
    const list = await screen.findByRole('list', { name: 'Always kept' });
    await screen.findByText('Files: 2 (2.0 KB)');
    expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      ...LISTS.user.kept,
      'Your saved searches',
    ]);
  });

  it('prints the deleted and kept lines the API returned on the factory reset page', async () => {
    renderWithHost(
      hostWith({
        'GET /admin/factory-reset/summary': {
          ...RESET,
          deleted: [...LISTS.reset.deleted, 'Every saved report'],
          kept: [...LISTS.reset.kept, 'Your brand kit'],
        },
      }),
      <FactoryResetPage />,
    );
    await screen.findByText('Other users: 4');
    expect(within(screen.getByRole('list', { name: 'What is deleted' })).getByText('Every saved report')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'What is kept' })).getByText('Your brand kit')).toBeInTheDocument();
  });

  it('prints the platform lines before the summary arrives', () => {
    renderWithHost(hostWith({ 'GET /admin/factory-reset/summary': () => new Promise(() => undefined) }), <FactoryResetPage />);
    expect(within(screen.getByRole('list', { name: 'What is deleted' })).getAllByRole('listitem')).toHaveLength(LISTS.reset.deleted.length);
    expect(within(screen.getByRole('list', { name: 'What is kept' })).getAllByRole('listitem')).toHaveLength(LISTS.reset.kept.length);
  });
});

describe('copy and slots', () => {
  it('the factory reset page takes copy and the base slots', async () => {
    renderWithHost(
      hostWith({ 'GET /admin/factory-reset/summary': RESET }),
      <FactoryResetPage
        copy={{ title: 'Reset the workspace', warning: 'Everything goes.', deletedHeading: 'Removed', keptHeading: 'Stays' }}
        slots={{
          BeforeContent: () => <p>announce first</p>,
          Sections: ({ position }) => <p>{`section ${position}`}</p>,
          AfterContent: () => <p>after</p>,
        }}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Reset the workspace' })).toBeInTheDocument();
    expect(screen.getByText('Everything goes.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Removed' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Stays' })).toBeInTheDocument();
    for (const text of ['announce first', 'section top', 'section bottom', 'after']) expect(screen.getByText(text)).toBeInTheDocument();
    await screen.findByText('Other users: 4');
  });

  it('the Danger Zone takes copy and a replacement Header', async () => {
    renderWithHost(
      hostWith({ 'GET /user-data/summary': SUMMARY }),
      <UserDangerZonePage
        copy={{ title: 'Erase my account data', description: 'Gone for good.', ownedHeading: 'Yours', keptHeading: 'Not deleted' }}
        slots={{ Header: ({ title, description }) => <h1>{`custom ${String(title)} / ${String(description)}`}</h1> }}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'custom Erase my account data / Gone for good.' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Yours' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Always kept' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Not deleted' })).toBeInTheDocument();
    await screen.findByText('Files: 2 (2.0 KB)');
  });
});
