/**
 * The DataTable's `Toolbar` and `BulkBar` slots and a column's own filter
 * editor (PP-14.20). The markup with none of them is pinned by
 * `DataTable.builtin-dom.test.tsx`.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDataTableFilterType } from '../../src/datatable/headless/filter/filterTypes.js';
import type {
  DataTableBulkBarSlotProps,
  DataTableColumn,
  DataTableFilter,
  DataTableFilterModel,
  DataTableToolbarSlotProps,
  FilterValueEditorProps,
} from '../../src/datatable/headless/index.js';
import { installLayoutStubs, resetContainerWidth, setContainerWidth } from '../../src/datatable/testing/layoutStubs.js';
import { DataTable } from '../../src/datatable/ui/DataTable.js';
import { FilterEditor } from '../../src/datatable/ui/filter/FilterEditor.js';
import { render } from './render.js';

interface Row {
  id: string;
  name: string;
  tags: string;
}
const ROWS: Row[] = [
  { id: 'r1', name: 'Alpha', tags: 'a,b' },
  { id: 'r2', name: 'Beta', tags: 'b' },
];
const COLUMNS: DataTableColumn<Row>[] = [
  { id: 'name', label: 'Name', priority: 'primary', value: (row) => row.name, filterable: true },
  { id: 'tags', label: 'Tags', priority: 'secondary', value: (row) => row.tags, filter: { type: 'chips' } },
];

beforeAll(() => {
  installLayoutStubs();
});
beforeEach(() => {
  resetContainerWidth();
  setContainerWidth(1400);
});

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

describe('Toolbar slot', () => {
  it('is drawn inside the table wrapper, above the bars, with the table state', async () => {
    const seen: DataTableToolbarSlotProps<Row>[] = [];
    const Toolbar = (props: DataTableToolbarSlotProps<Row>): ReactElement => {
      seen.push(props);
      return <div data-testid="my-toolbar">toolbar</div>;
    };
    const onFiltersChange = vi.fn();
    const { container } = render(
      <DataTable<Row>
        ariaLabel="Things"
        columns={COLUMNS}
        rows={ROWS}
        rowId={(row) => row.id}
        renderer="desktop"
        filters={[{ columnId: 'name', operator: 'contains', value: 'a' }]}
        onFiltersChange={onFiltersChange}
        selection={{ selectedIds: new Set(['r1']), onSelectionChange: vi.fn() }}
        pagination={{ page: 0, pageSize: 25, total: 2, onPaginationChange: vi.fn() }}
        slots={{ Toolbar }}
      />,
    );
    const toolbar = await screen.findByTestId('my-toolbar');
    const root = container.firstElementChild!;
    expect(root.firstElementChild).toBe(toolbar);
    const last = seen.at(-1)!;
    expect(last.layout).toBe('desktop');
    expect(last.rowCount).toBe(2);
    expect(last.total).toBe(2);
    expect([...last.selectedIds]).toEqual(['r1']);
    expect(last.filters).toEqual([{ columnId: 'name', operator: 'contains', value: 'a' }]);
    expect(last.onFiltersChange).toBe(onFiltersChange);
    expect(last.columns.map((column) => column.id)).toEqual(['name', 'tags']);
    expect(typeof last.prefs.saveView).toBe('function');
  });

  it('a saved-views control: save the layout and the filters, apply them back through onFiltersChange', async () => {
    function SavedViews(props: DataTableToolbarSlotProps<Row>): ReactElement {
      const { prefs, filters, onFiltersChange } = props;
      return (
        <div>
          <button type="button" onClick={() => prefs.saveView('Mine', { filters })}>
            Save view
          </button>
          <ul aria-label="Views">
            {prefs.savedViews.map((view) => (
              <li key={view.id}>
                <button
                  type="button"
                  onClick={() => {
                    const applied = prefs.applyView(view.id);
                    onFiltersChange?.((applied?.layout.extra?.['filters'] as DataTableFilterModel) ?? []);
                  }}
                >
                  {view.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    function Page(): ReactElement {
      const [filters, setFilters] = useState<DataTableFilterModel>([{ columnId: 'name', operator: 'contains', value: 'a' }]);
      return (
        <>
          <output data-testid="active">{JSON.stringify(filters)}</output>
          <button type="button" onClick={() => setFilters([])}>
            Clear all
          </button>
          <DataTable<Row>
            ariaLabel="Things"
            columns={COLUMNS}
            rows={ROWS}
            rowId={(row) => row.id}
            renderer="desktop"
            filters={filters}
            onFiltersChange={setFilters}
            slots={{ Toolbar: SavedViews }}
          />
        </>
      );
    }
    render(<Page />);
    fireEvent.click(await screen.findByRole('button', { name: 'Save view' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(screen.getByTestId('active').textContent).toBe('[]');
    fireEvent.click(within(screen.getByRole('list', { name: 'Views' })).getByRole('button', { name: 'Mine' }));
    await waitFor(() => expect(screen.getByTestId('active').textContent).toContain('"contains"'));
  });
});

describe('BulkBar slot', () => {
  const bulk = [{ id: 'del', label: 'Delete', onClick: vi.fn() }];

  it('replaces the bulk-action bar while rows are selected, on both renderers', async () => {
    const seen: DataTableBulkBarSlotProps[] = [];
    const BulkBar = (props: DataTableBulkBarSlotProps): ReactElement => {
      seen.push(props);
      return (
        <div data-testid="my-bulk">
          {props.ids.length} chosen
          <button type="button" onClick={props.onClear}>
            Drop
          </button>
        </div>
      );
    };
    for (const renderer of ['desktop', 'mobile'] as const) {
      const onSelectionChange = vi.fn();
      const view = render(
        <DataTable<Row>
          ariaLabel="Things"
          columns={COLUMNS}
          rows={ROWS}
          rowId={(row) => row.id}
          renderer={renderer}
          selection={{ selectedIds: new Set(['r1', 'r2']), onSelectionChange }}
          bulkActions={bulk}
          slots={{ BulkBar }}
        />,
      );
      expect(await screen.findByTestId('my-bulk')).toHaveTextContent('2 chosen');
      expect(screen.queryByTestId('datatable-bulk-action-bar')).toBeNull();
      expect(seen.at(-1)).toMatchObject({ ids: ['r1', 'r2'], total: 2, actions: bulk });
      fireEvent.click(screen.getByRole('button', { name: 'Drop' }));
      expect(onSelectionChange).toHaveBeenCalledWith(new Set());
      view.unmount();
    }
  });

  it('is not drawn for an empty selection, and the built-in bar stays when no slot is given', async () => {
    const BulkBar = (): ReactElement => <div data-testid="my-bulk" />;
    const empty = render(
      <DataTable<Row>
        ariaLabel="Things"
        columns={COLUMNS}
        rows={ROWS}
        rowId={(row) => row.id}
        renderer="desktop"
        selection={{ selectedIds: new Set(), onSelectionChange: vi.fn() }}
        bulkActions={bulk}
        slots={{ BulkBar }}
      />,
    );
    await waitFor(() => expect(screen.getAllByRole('row').length).toBeGreaterThan(1));
    expect(screen.queryByTestId('my-bulk')).toBeNull();
    empty.unmount();

    render(
      <DataTable<Row>
        ariaLabel="Things"
        columns={COLUMNS}
        rows={ROWS}
        rowId={(row) => row.id}
        renderer="desktop"
        selection={{ selectedIds: new Set(['r1']), onSelectionChange: vi.fn() }}
        bulkActions={bulk}
      />,
    );
    expect(await screen.findByTestId('datatable-bulk-action-bar')).toBeInTheDocument();
  });
});

describe('a custom filter type with its own operand editor', () => {
  /** The chip editor of the issue's example: type a tag, press Enter, click a chip to remove it. */
  function ChipsEditor({ value, onChange }: FilterValueEditorProps<Row>): ReactElement {
    const tags = Array.isArray(value) ? value.map(String) : [];
    return (
      <div data-testid="chips-editor">
        {tags.map((tag) => (
          <button key={tag} type="button" aria-label={`Remove ${tag}`} onClick={() => onChange(tags.filter((t) => t !== tag))}>
            {tag}
          </button>
        ))}
        <input
          aria-label="Add tag"
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            const next = event.currentTarget.value.trim();
            if (next && !tags.includes(next)) onChange([...tags, next]);
            event.currentTarget.value = '';
          }}
        />
      </div>
    );
  }

  beforeEach(() => {
    cleanups.push(
      registerDataTableFilterType({
        type: 'chips',
        operators: [
          { id: 'hasAny', label: 'has any of', arity: 'many' },
          { id: 'hasAll', label: 'has all of', arity: 'many' },
        ],
        Editor: ChipsEditor,
        matches: () => true,
      }),
    );
  });

  function Harness({ onCommit }: { onCommit: (filter: DataTableFilter) => void }): ReactElement {
    const [draft, setDraft] = useState<DataTableFilter>({ columnId: 'tags', operator: 'hasAny', value: [] });
    return <FilterEditor<Row> columns={[COLUMNS[1]!]} draft={draft} onDraftChange={setDraft} onCommit={onCommit} />;
  }

  it('draws the type editor for the operand, offers the type operators and commits a complete filter', () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    expect(screen.getByTestId('chips-editor')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Value' })).toBeNull();
    const add = screen.getByTestId('datatable-filter-apply');
    expect(add).toBeDisabled();

    const input = screen.getByLabelText('Add tag');
    fireEvent.change(input, { target: { value: 'urgent' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(screen.getByLabelText('Add tag'), { target: { value: 'ops' } });
    fireEvent.keyDown(screen.getByLabelText('Add tag'), { key: 'Enter' });
    expect(screen.getByRole('button', { name: 'Remove urgent' })).toBeInTheDocument();
    expect(add).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove ops' }));
    fireEvent.click(add);
    expect(onCommit).toHaveBeenCalledWith({ columnId: 'tags', operator: 'hasAny', value: ['urgent'] });
  });

  it('a column editor overrides the type editor', () => {
    const Special = (): ReactElement => <div data-testid="special-editor" />;
    const column: DataTableColumn<Row> = { ...COLUMNS[1]!, filter: { type: 'chips', editor: Special } };
    render(
      <FilterEditor<Row>
        columns={[column]}
        draft={{ columnId: 'tags', operator: 'hasAll', value: [] }}
        onDraftChange={vi.fn()}
        onCommit={vi.fn()}
      />,
    );
    expect(screen.getByTestId('special-editor')).toBeInTheDocument();
    expect(screen.queryByTestId('chips-editor')).toBeNull();
  });

  it('a registered type without an editor falls back to a comma-separated text field for a set', () => {
    cleanups.push(
      registerDataTableFilterType({
        type: 'plainset',
        operators: [{ id: 'anyOfPlain', label: 'any of', arity: 'many' }],
        matches: () => true,
      }),
    );
    const onDraftChange = vi.fn();
    render(
      <FilterEditor<Row>
        columns={[{ id: 'tags', label: 'Tags', priority: 'secondary', filter: { type: 'plainset' } }]}
        draft={{ columnId: 'tags', operator: 'anyOfPlain', value: [] }}
        onDraftChange={onDraftChange}
        onCommit={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'a, b ,,c' } });
    expect(onDraftChange).toHaveBeenCalledWith({ columnId: 'tags', operator: 'anyOfPlain', value: ['a', 'b', 'c'] });
  });
});
