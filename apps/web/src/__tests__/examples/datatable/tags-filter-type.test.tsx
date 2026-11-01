/**
 * PP-14.20: an app adds a filter TYPE to the DataTable, with its own operand
 * editor, without a package edit.
 *
 * `apps/web/src/platform-extensions/datatable/TagsFilterType.example.tsx` is the
 * example. This renders the REAL packaged DataTable
 * (`@marinoscar/platform-web/datatable/ui`) with a `tags` column, adds a filter
 * through the chip editor (type, Enter, remove with the chip), and shows the page
 * receiving the normalized model and filtering its own rows with the type's
 * `matches` through `matchesFilters`. It also pins the URL round trip and that
 * the five built-in types still work beside it.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useState } from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import { DataTable } from '@marinoscar/platform-web/datatable/ui';
import {
  matchesFilters,
  readDataTableUrlState,
  writeDataTableUrlState,
  type DataTableColumn,
  type DataTableFilterModel,
} from '@marinoscar/platform-web/datatable/headless';
import { installLayoutStubs, resetContainerWidth, setInitialContainerWidth } from '@marinoscar/platform-web/datatable/testing';
import { render } from '../../utils/test-utils';
import {
  TAGS_FILTER_TYPE,
  matchesTags,
  registerTagsFilterType,
  tagsValue,
} from '../../../platform-extensions/datatable/TagsFilterType.example';

interface Ticket {
  id: string;
  title: string;
  tags: string[];
}

const TICKETS: Ticket[] = [
  { id: 't1', title: 'Disk full', tags: ['ops', 'urgent'] },
  { id: 't2', title: 'Typo on the pricing page', tags: ['web'] },
  { id: 't3', title: 'Rotate keys', tags: ['ops', 'security'] },
];

const COLUMNS: DataTableColumn<Ticket>[] = [
  { id: 'title', label: 'Title', priority: 'primary', value: (row) => row.title, filterable: true },
  { id: 'tags', label: 'Tags', priority: 'secondary', value: (row) => tagsValue(row.tags), filter: { type: TAGS_FILTER_TYPE } },
];

function Page() {
  const [filters, setFilters] = useState<DataTableFilterModel>([]);
  // The page owns the filtering (the table never filters rows); here it filters locally.
  const rows = TICKETS.filter((ticket) => matchesFilters(ticket, COLUMNS, filters));
  return (
    <>
      <output data-testid="model">{JSON.stringify(filters)}</output>
      <DataTable<Ticket>
        ariaLabel="Tickets"
        columns={COLUMNS}
        rows={rows}
        rowId={(row) => row.id}
        renderer="desktop"
        filters={filters}
        onFiltersChange={setFilters}
      />
    </>
  );
}

describe('the tags filter type (PP-14.20)', () => {
  let unregister: () => void;
  beforeAll(() => installLayoutStubs());
  beforeEach(() => {
    resetContainerWidth(1400);
    setInitialContainerWidth(1400);
    unregister = registerTagsFilterType();
  });
  afterEach(() => unregister());

  it('matches by the type rules', () => {
    expect(matchesTags('ops,urgent', 'hasAny', ['urgent', 'x'])).toBe(true);
    expect(matchesTags('ops,urgent', 'hasAll', ['ops', 'urgent'])).toBe(true);
    expect(matchesTags('ops', 'hasAll', ['ops', 'urgent'])).toBe(false);
    expect(matchesTags('ops', 'hasNone', ['web'])).toBe(true);
    expect(matchesTags('', 'hasAny', ['web'])).toBe(false);
  });

  it('adds a filter through the chip editor and the page filters its rows with the type', async () => {
    render(<Page />);
    await waitFor(() => expect(screen.getByText('Disk full')).toBeInTheDocument());

    const editor = screen.getByTestId('datatable-filter-editor');
    // Pick the Tags column, then the "has all of" operator.
    fireEvent.mouseDown(within(editor).getByLabelText('Column'));
    fireEvent.click(await screen.findByRole('option', { name: 'Tags' }));
    fireEvent.mouseDown(within(editor).getByLabelText('Operator'));
    fireEvent.click(await screen.findByRole('option', { name: 'has all of' }));

    const input = within(screen.getByTestId('tags-filter-editor')).getByLabelText('Add a tag');
    fireEvent.change(input, { target: { value: 'ops' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: 'urgent' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('ops')).toBeInTheDocument();
    expect(screen.getByText('urgent')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('datatable-filter-apply'));

    await waitFor(() =>
      expect(JSON.parse(screen.getByTestId('model').textContent ?? '[]')).toEqual([
        { columnId: 'tags', operator: 'hasAll', value: ['ops', 'urgent'] },
      ]),
    );
    await waitFor(() => expect(screen.queryByText('Rotate keys')).not.toBeInTheDocument());
    expect(screen.getByText('Disk full')).toBeInTheDocument();
    expect(screen.queryByText('Typo on the pricing page')).not.toBeInTheDocument();
    // The chip says what the type's operator and format say.
    expect(await screen.findByText(/Tags has all of #ops, #urgent/)).toBeInTheDocument();
  });

  it('removes a chip from the draft', async () => {
    render(<Page />);
    await waitFor(() => expect(screen.getByText('Disk full')).toBeInTheDocument());
    const editor = screen.getByTestId('datatable-filter-editor');
    fireEvent.mouseDown(within(editor).getByLabelText('Column'));
    fireEvent.click(await screen.findByRole('option', { name: 'Tags' }));
    const input = within(screen.getByTestId('tags-filter-editor')).getByLabelText('Add a tag');
    fireEvent.change(input, { target: { value: 'ops' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('datatable-filter-apply')).toBeEnabled();
    // Backspace on an empty box removes the last chip, which empties the operand.
    fireEvent.keyDown(within(screen.getByTestId('tags-filter-editor')).getByLabelText('Add a tag'), { key: 'Backspace' });
    expect(screen.getByTestId('datatable-filter-apply')).toBeDisabled();
  });

  it('round-trips the model through the URL', () => {
    const model: DataTableFilterModel = [{ columnId: 'tags', operator: 'hasAny', value: ['ops', 'a,b'] }];
    const params = writeDataTableUrlState(new URLSearchParams(), { filters: model });
    expect(readDataTableUrlState(params, { columns: COLUMNS }).filters).toEqual(model);
  });

  it('leaves the built-in types working beside it', () => {
    const rows = TICKETS.filter((ticket) => matchesFilters(ticket, COLUMNS, [{ columnId: 'title', operator: 'contains', value: 'KEYS' }]));
    expect(rows.map((ticket) => ticket.id)).toEqual(['t3']);
  });
});
