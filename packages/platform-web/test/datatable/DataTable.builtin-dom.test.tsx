/**
 * The DataTable's markup with NO slot, NO custom filter type and NO stored
 * extras did not move (PP-14.20).
 *
 * The table gained the `Toolbar` and `BulkBar` slots, an open filter-type
 * registry and a stored layout `extra`. The snapshot beside this file
 * (`__snapshots__/`) was RECORDED FROM THE TABLE AS IT WAS BEFORE THAT CHANGE
 * (the same fixtures, rendered by the old components), so passing means a table
 * that uses none of the new seams is, element for element and class for class,
 * the one it was.
 *
 * The only normalisation is React's generated ids (`_r_1f_`, `:r1:`), which
 * depend on render order. Re-record only for a deliberate change of the table.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { DataTable } from '../../src/datatable/ui/DataTable.js';
import { FilterEditor } from '../../src/datatable/ui/filter/FilterEditor.js';
import { installLayoutStubs, resetContainerWidth, setContainerWidth } from '../../src/datatable/testing/layoutStubs.js';
import type { DataTableColumn, DataTableFilter } from '../../src/datatable/headless/types.js';
import { render } from './render.js';

interface Row {
  id: string;
  name: string;
  attempts: number;
  status: string;
  active: boolean;
  created: string;
}

const ROWS: Row[] = [
  { id: 'r1', name: 'Alpha', attempts: 1, status: 'ok', active: true, created: '2026-01-02' },
  { id: 'r2', name: 'Beta', attempts: 4, status: 'failed', active: false, created: '2026-02-03' },
];

const COLUMNS: DataTableColumn<Row>[] = [
  { id: 'name', label: 'Name', priority: 'primary', value: (row) => row.name, sortable: true, filterable: true, searchable: true },
  { id: 'attempts', label: 'Attempts', priority: 'secondary', value: (row) => row.attempts, filterable: true, filterType: 'number' },
  {
    id: 'status',
    label: 'Status',
    priority: 'secondary',
    value: (row) => row.status,
    filterable: true,
    filterType: 'enum',
    enumValues: [
      { value: 'ok', label: 'OK' },
      { value: 'failed', label: 'Failed' },
    ],
  },
  { id: 'active', label: 'Active', priority: 'detail', value: (row) => (row.active ? 'yes' : 'no'), filterable: true, filterType: 'boolean' },
  { id: 'created', label: 'Created', priority: 'detail', value: (row) => row.created, filterable: true, filterType: 'date' },
];

/** The markup as one element per line, with generated ids neutralised. */
function markup(root: HTMLElement): string {
  return root.innerHTML
    .replace(/_r_[0-9a-z]+_/g, '_r_N_')
    .replace(/:r[0-9a-z]+:/g, ':rN:')
    .replace(/></g, '>\n<');
}

beforeAll(() => {
  installLayoutStubs();
});

beforeEach(() => {
  resetContainerWidth();
  setContainerWidth(1400);
});

describe('DataTable builtin markup', () => {
  it('desktop: filters, quick search, selection, bulk and row actions', async () => {
    const { container } = render(
      <DataTable<Row>
        ariaLabel="Things"
        columns={COLUMNS}
        rows={ROWS}
        rowId={(row) => row.id}
        renderer="desktop"
        filters={[
          { columnId: 'status', operator: 'is', value: 'failed' },
          { columnId: 'attempts', operator: 'between', value: [1, 5] },
        ]}
        onFiltersChange={vi.fn()}
        quickSearch={{ value: 'al', onChange: vi.fn() }}
        selection={{ selectedIds: new Set(['r1']), onSelectionChange: vi.fn() }}
        bulkActions={[{ id: 'del', label: 'Delete', destructive: true, onClick: vi.fn() }]}
        rowActions={[{ id: 'open', label: 'Open', onClick: vi.fn() }]}
        pagination={{ page: 0, pageSize: 25, total: 2, onPaginationChange: vi.fn() }}
        sort={{ sort: { field: 'name', direction: 'asc' }, onSortChange: vi.fn() }}
      />,
    );
    await waitFor(() => expect(screen.getAllByRole('row').length).toBeGreaterThan(1));
    expect(markup(container)).toMatchSnapshot();
  });

  it('mobile: card list with the same state', async () => {
    const { container } = render(
      <DataTable<Row>
        ariaLabel="Things"
        columns={COLUMNS}
        rows={ROWS}
        rowId={(row) => row.id}
        renderer="mobile"
        filters={[{ columnId: 'name', operator: 'contains', value: 'a' }]}
        onFiltersChange={vi.fn()}
        quickSearch={{ value: '', onChange: vi.fn() }}
        selection={{ selectedIds: new Set(['r2']), onSelectionChange: vi.fn() }}
        bulkActions={[{ id: 'del', label: 'Delete', onClick: vi.fn() }]}
        pagination={{ page: 0, pageSize: 25, total: 2, onPaginationChange: vi.fn() }}
        sort={{ sort: null, onSortChange: vi.fn() }}
      />,
    );
    await waitFor(() => expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0));
    expect(markup(container)).toMatchSnapshot();
  });

  it('the filter panel open on desktop', async () => {
    const { container } = render(
      <DataTable<Row>
        ariaLabel="Things"
        columns={COLUMNS}
        rows={ROWS}
        rowId={(row) => row.id}
        renderer="desktop"
        filters={[]}
        onFiltersChange={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getAllByRole('row').length).toBeGreaterThan(1));
    const open = screen.queryByRole('button', { name: /add filter|filters/i });
    if (open) fireEvent.click(open);
    expect(markup(container)).toMatchSnapshot();
  });
});

describe('FilterEditor builtin markup', () => {
  const DRAFTS: Array<[string, DataTableFilter]> = [
    ['text contains', { columnId: 'name', operator: 'contains', value: 'al' }],
    ['text isEmpty', { columnId: 'name', operator: 'isEmpty', value: null }],
    ['number between', { columnId: 'attempts', operator: 'between', value: [1, 5] }],
    ['number equals', { columnId: 'attempts', operator: 'equals', value: 3 }],
    ['date between', { columnId: 'created', operator: 'between', value: ['2026-01-01', '2026-02-01'] }],
    ['date before', { columnId: 'created', operator: 'before', value: '2026-01-01' }],
    ['enum is', { columnId: 'status', operator: 'is', value: 'ok' }],
    ['enum isAnyOf', { columnId: 'status', operator: 'isAnyOf', value: ['ok', 'failed'] }],
    ['boolean is', { columnId: 'active', operator: 'is', value: true }],
  ];

  for (const orientation of ['row', 'stacked'] as const) {
    it.each(DRAFTS)(`${orientation}: %s`, (_name, draft) => {
      const { container } = render(
        <FilterEditor<Row>
          columns={COLUMNS}
          draft={draft}
          onDraftChange={vi.fn()}
          onCommit={vi.fn()}
          orientation={orientation}
        />,
      );
      expect(markup(container)).toMatchSnapshot();
    });
  }
});
