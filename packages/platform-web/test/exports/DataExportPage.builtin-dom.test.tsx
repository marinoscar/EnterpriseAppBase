/**
 * The data export page's markup with NO slot did not move (PP-14.24b).
 *
 * `DataExportPage` gained the page-slot contract (`PageSlotsBase`) and forwards
 * the exports list's `Columns` and `RowActions`. The snapshot beside this file
 * (`__snapshots__/`) was RECORDED FROM THE PAGE AS IT WAS BEFORE THAT CHANGE
 * (the same fixtures, rendered by the old component), so passing means the page
 * a user sees with no slot passed is, element for element and class for class,
 * the one they had.
 *
 * The only normalisation is React's and MUI's generated ids. Re-record only for
 * a deliberate change of the page.
 */
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createTestApiError } from '../../src/testing/index.js';
import { DataExportPage } from '../../src/exports/ui/index.js';
import { ID, ORG_DATA, USER_DATA, hostWith, renderWith, view } from './fixtures.js';

function markup(root: HTMLElement): string {
  return root.innerHTML
    .replace(/_r_[0-9a-z]+_/g, '_r_N_')
    .replace(/:r[0-9a-z]+:/g, ':rN:')
    .replace(/></g, '>\n<');
}

const VIEWS = [
  view({ id: ID, status: 'ready', sizeBytes: 2048, createdAt: '2026-10-08T10:00:00.000Z' }),
  view({ id: 'b', source: 'org-data', scope: 'org', format: 'csv', status: 'failed', error: 'The file could not be built', createdAt: '2026-10-07T10:00:00.000Z' }),
];

describe('DataExportPage builtin markup', () => {
  it('loaded, with exports', async () => {
    const host = hostWith({ 'GET /exports/sources': { items: [USER_DATA, ORG_DATA] }, 'GET /exports': { items: VIEWS } });
    const { container } = renderWith(host, <DataExportPage />);
    await screen.findByText('Ready to download');
    expect(markup(container)).toMatchSnapshot();
  });

  it('loaded, nothing exported yet', async () => {
    const host = hostWith({ 'GET /exports/sources': { items: [USER_DATA] }, 'GET /exports': { items: [] } });
    const { container } = renderWith(host, <DataExportPage />);
    await screen.findByText(/not exported anything/);
    expect(markup(container)).toMatchSnapshot();
  });

  it('while loading', () => {
    const host = hostWith({ 'GET /exports/sources': () => new Promise(() => undefined), 'GET /exports': () => new Promise(() => undefined) });
    const { container } = renderWith(host, <DataExportPage />);
    expect(markup(container)).toMatchSnapshot();
  });

  it('when the exports could not be read', async () => {
    const host = hostWith({
      'GET /exports/sources': { items: [USER_DATA] },
      'GET /exports': () => Promise.reject(createTestApiError(500, 'down')),
    });
    const { container } = renderWith(host, <DataExportPage />);
    await screen.findByRole('alert');
    expect(markup(container)).toMatchSnapshot();
  });
});
