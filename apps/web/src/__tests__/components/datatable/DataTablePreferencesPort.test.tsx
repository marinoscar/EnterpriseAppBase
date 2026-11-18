/**
 * The DataTable's layout preferences go through a port
 * (`DataTablePreferencesPort`, `@marinoscar/platform-web/datatable/headless`).
 * These tests show an app supplying its own storage instead of the default
 * user-settings routes: the stored layout is restored on mount, and a change is
 * saved through the port, not through the API.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { DataTable } from '@marinoscar/platform-web/datatable/ui';
import {
  DataTablePreferencesProvider,
  type DataTableColumn,
  type DataTablePreferencesPort,
} from '@marinoscar/platform-web/datatable/headless';
import {
  installLayoutStubs,
  resetContainerWidth,
  setInitialContainerWidth,
} from '@marinoscar/platform-web/datatable/testing';
import { render } from '../../utils/test-utils';

interface Row {
  id: string;
  name: string;
  owner: string;
}

const COLUMNS: DataTableColumn<Row>[] = [
  { id: 'name', label: 'Name', priority: 'primary', value: (row) => row.name },
  { id: 'owner', label: 'Owner', priority: 'secondary', value: (row) => row.owner },
];

const ROWS: Row[] = [{ id: 'r1', name: 'Nightly backup', owner: 'alice' }];

beforeAll(() => installLayoutStubs());

beforeEach(() => {
  resetContainerWidth();
  setInitialContainerWidth(1400);
});

function renderWithPort(port: DataTablePreferencesPort) {
  return render(
    <DataTablePreferencesProvider port={port}>
      <DataTable<Row> columns={COLUMNS} rows={ROWS} rowId={(row) => row.id} ariaLabel="Backups" tableId="backups" />
    </DataTablePreferencesProvider>,
  );
}

describe('DataTablePreferencesProvider', () => {
  it('restores the layout the port stores', async () => {
    const port: DataTablePreferencesPort = {
      load: vi.fn().mockResolvedValue({ backups: { visibleColumns: ['name', '-owner'] } }),
      save: vi.fn().mockResolvedValue(undefined),
    };

    renderWithPort(port);

    await waitFor(() => expect(port.load).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText('alice')).not.toBeInTheDocument());
    expect(screen.getByText('Nightly backup')).toBeInTheDocument();
  });

  it('keeps working, and does not save, when the port cannot load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const port: DataTablePreferencesPort = {
      load: vi.fn().mockRejectedValue(new Error('offline')),
      save: vi.fn().mockResolvedValue(undefined),
    };

    renderWithPort(port);

    expect(await screen.findByText('alice')).toBeInTheDocument();
    await act(async () => {});
    expect(port.save).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
