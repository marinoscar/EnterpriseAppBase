/**
 * PP-14.24b: an app extends the packaged "Download your data" page through its
 * `slots`: a notice under the header (`BeforeContent`) and the exports list's
 * `Columns` and `RowActions`, forwarded by the page.
 *
 * `apps/web/src/platform-extensions/exports/DataExportPageSlots.example.tsx` is
 * the example; this renders the REAL `DataExportPage` with it, and without, over
 * a test platform host shaped like the API.
 */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ExportSourceDescriptor, ExportView } from '@marinoscar/platform-contract/exports';
import { PlatformHostProvider } from '@marinoscar/platform-web/core';
import { DataExportPage } from '@marinoscar/platform-web/exports/ui';
import type { DataExportPageProps } from '@marinoscar/platform-web/exports/ui';
import { createTestPlatformHost } from '@marinoscar/platform-web/testing';

import { DATA_EXPORT_PAGE_SLOTS } from '../../../platform-extensions/exports/DataExportPageSlots.example';

const SOURCE: ExportSourceDescriptor = {
  id: 'user-data',
  scope: 'user',
  label: 'Example data',
  formats: [{ id: 'json', label: 'JSON', extension: 'json', mimeType: 'application/json' }],
  fields: [],
  crossOrg: false,
};

const READY: ExportView = {
  id: '7d1e5bb4-62a4-4c1f-9b3c-3f2d9a6c8e10',
  source: 'user-data',
  format: 'json',
  scope: 'user',
  orgId: null,
  status: 'ready',
  createdAt: '2026-10-08T10:00:00.000Z',
  completedAt: '2026-10-08T10:00:05.000Z',
  expiresAt: '2026-10-15T10:00:00.000Z',
  fileName: 'example-data.json',
  mimeType: 'application/json',
  sizeBytes: 2048,
  rowCounts: { notes: 12 },
  error: null,
  download: null,
};

function renderPage(slots?: DataExportPageProps['slots']) {
  const host = createTestPlatformHost({
    permissions: ['user_settings:read'],
    responses: { 'GET /exports/sources': { items: [SOURCE] }, 'GET /exports': { items: [READY] } },
  });
  return render(
    <MemoryRouter>
      <PlatformHostProvider host={host}>
        <DataExportPage {...(slots ? { slots } : {})} />
      </PlatformHostProvider>
    </MemoryRouter>,
  );
}

describe('the data export page with the app slots (PP-14.24b)', () => {
  it('draws the notice under the header and forwards the list columns and actions', async () => {
    renderPage(DATA_EXPORT_PAGE_SLOTS);
    const notice = screen.getByText(/stays available for 7 days/);
    const heading = screen.getByRole('heading', { level: 1, name: 'Download your data' });
    expect(heading.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const [row] = await screen.findAllByRole('listitem');
    expect(row).toHaveTextContent('12 rows');
    expect(within(row!).getByRole('button', { name: 'Copy name' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New export' })).toBeInTheDocument();
  });

  it('is the page it always was with no slots', async () => {
    renderPage();
    const [row] = await screen.findAllByRole('listitem');
    expect(screen.queryByText(/stays available for 7 days/)).toBeNull();
    expect(row).not.toHaveTextContent('rows');
    expect(within(row!).queryByRole('button', { name: 'Copy name' })).toBeNull();
  });
});
