/**
 * PP-14.20: an app adds a column and a per-export action to the packaged
 * exports list through `slots.Columns` and `slots.RowActions`.
 *
 * `apps/web/src/platform-extensions/exports/ExportsListSlots.example.tsx` is the
 * example; this renders the REAL `ExportsList` with it.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';

import type { ExportView } from '@marinoscar/platform-contract/exports';
import { ExportsList } from '@marinoscar/platform-web/exports/ui';
import { render, mockUser } from '../../utils/test-utils';
import { exportsListSlots, totalRows } from '../../../platform-extensions/exports/ExportsListSlots.example';

const VIEW: ExportView = {
  id: '7d1e5bb4-62a4-4c1f-9b3c-3f2d9a6c8e10',
  source: 'user-data',
  format: 'json',
  scope: 'user',
  orgId: null,
  status: 'ready',
  createdAt: '2026-10-08T10:00:00.000Z',
  completedAt: '2026-10-08T10:00:05.000Z',
  expiresAt: '2026-10-15T10:00:00.000Z',
  fileName: 'example-user-data-2026-10-08.json',
  mimeType: 'application/json',
  sizeBytes: 2048,
  rowCounts: { account: 1, notes: 1240 },
  error: null,
  download: null,
};

describe('the exports list with the app slots (PP-14.20)', () => {
  it('sums the datasets', () => {
    expect(totalRows(VIEW)).toBe(1241);
    expect(totalRows({ rowCounts: null })).toBeNull();
  });

  it('draws a Rows column after the size and a Copy name action, and leaves the list otherwise as it was', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<ExportsList exports={[VIEW, { ...VIEW, id: 'b', status: 'failed', fileName: null, rowCounts: null, error: 'boom' }]} slots={exportsListSlots} />, {
      wrapperOptions: { user: mockUser },
    });
    const [ready, failed] = screen.getAllByRole('listitem');
    expect(ready).toHaveTextContent('2.0 KB · 1,241 rows');
    expect(within(ready!).getByRole('button', { name: /^Download/ })).toBeInTheDocument();
    fireEvent.click(within(ready!).getByRole('button', { name: 'Copy name' }));
    expect(writeText).toHaveBeenCalledWith('example-user-data-2026-10-08.json');
    expect(failed).not.toHaveTextContent('rows');
    expect(within(failed!).queryByRole('button', { name: 'Copy name' })).toBeNull();
  });
});
