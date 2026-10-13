/**
 * PP-14.20: saved views through the DataTable `Toolbar` slot and the stored
 * layout's `extra`, with no package edit.
 *
 * `apps/web/src/platform-extensions/datatable/SavedViewsToolbar.example.tsx` is
 * the example. The REAL DataTable runs with a `tableId` over a preferences port
 * that records what the table persists: saving a view stores the layout and the
 * filter model (in `extra`) as ONE debounced write, applying it hands the filters
 * back through the page's `onFiltersChange`, and the stored copy (untrusted) is
 * sanitised on the way in.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';

import { DataTable } from '@marinoscar/platform-web/datatable/ui';
import {
  DataTablePreferencesProvider,
  type DataTableColumn,
  type DataTableFilterModel,
  type DataTablePreferencesPort,
  type DataTableStoredLayout,
} from '@marinoscar/platform-web/datatable/headless';
import { installLayoutStubs, resetContainerWidth, setInitialContainerWidth } from '@marinoscar/platform-web/datatable/testing';
import { render } from '../../utils/test-utils';
import { SavedViewsToolbar, filtersOfView } from '../../../platform-extensions/datatable/SavedViewsToolbar.example';

interface Row {
  id: string;
  name: string;
}
const COLUMNS: DataTableColumn<Row>[] = [{ id: 'name', label: 'Name', priority: 'primary', value: (row) => row.name, filterable: true }];

function Page({ port }: { port: DataTablePreferencesPort }) {
  const [filters, setFilters] = useState<DataTableFilterModel>([{ columnId: 'name', operator: 'contains', value: 'a' }]);
  return (
    <DataTablePreferencesProvider port={port}>
      <output data-testid="model">{JSON.stringify(filters)}</output>
      <button type="button" onClick={() => setFilters([])}>
        Clear
      </button>
      <DataTable<Row>
        tableId="tickets"
        ariaLabel="Things"
        columns={COLUMNS}
        rows={[{ id: 'r1', name: 'Alpha' }]}
        rowId={(row) => row.id}
        renderer="desktop"
        filters={filters}
        onFiltersChange={setFilters}
        slots={{ Toolbar: SavedViewsToolbar }}
      />
    </DataTablePreferencesProvider>
  );
}

describe('saved views (PP-14.20)', () => {
  let stored: Record<string, unknown>;
  let saves: Array<[string, DataTableStoredLayout | null]>;
  let port: DataTablePreferencesPort;

  beforeAll(() => installLayoutStubs());
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    resetContainerWidth(1400);
    setInitialContainerWidth(1400);
    stored = {};
    saves = [];
    port = { load: async () => stored, save: async (id, entry) => void saves.push([id, entry]) };
  });
  afterEach(() => vi.useRealTimers());

  it('saves the layout with the filter model in extra, in one debounced write', async () => {
    render(<Page port={port} />);
    fireEvent.change(await screen.findByLabelText('View name'), { target: { value: 'Alpha only' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save view' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(saves).toHaveLength(1);
    expect(saves[0]![0]).toBe('tickets');
    expect(saves[0]![1]!.savedViews).toEqual([
      { id: 'alpha-only', name: 'Alpha only', layout: { extra: { filters: [{ columnId: 'name', operator: 'contains', value: 'a' }] } } },
    ]);
  });

  it('applies a stored view: the page gets its filters back', async () => {
    stored = {
      tickets: {
        savedViews: [{ id: 'beta', name: 'Beta only', layout: { extra: { filters: [{ columnId: 'name', operator: 'contains', value: 'beta' }] } } }],
      },
    };
    render(<Page port={port} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Clear' }));
    expect(screen.getByTestId('model').textContent).toBe('[]');
    fireEvent.mouseDown(await screen.findByLabelText('Saved views'));
    fireEvent.click(await screen.findByRole('option', { name: 'Beta only' }));
    await waitFor(() => expect(screen.getByTestId('model').textContent).toContain('"beta"'));
  });

  it('refuses a blank name and reads only an array of filters from a view', async () => {
    render(<Page port={port} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Save view' }));
    expect(await screen.findByText(/Give the view a name/)).toBeInTheDocument();
    expect(saves).toHaveLength(0);
    expect(filtersOfView(undefined)).toEqual([]);
    expect(filtersOfView({ filters: 'oops' })).toEqual([]);
    expect(filtersOfView({ filters: [{ columnId: 'a', operator: 'is', value: 1 }] })).toHaveLength(1);
  });
});
