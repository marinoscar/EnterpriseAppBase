/**
 * The exports list's `Columns` and `RowActions` slots (PP-14.20). The markup
 * with no slot is pinned by `ExportsList.builtin-dom.test.tsx`.
 */
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ExportsList, type ExportsListColumn, type ExportsListSlots } from '../../src/exports/ui/index.js';
import { ID, USER_DATA, hostWith, renderWith, view } from './fixtures.js';

const READY = view({ id: ID, status: 'ready', sizeBytes: 2048, rowCounts: { account: 1, notes: 4 } });
const FAILED = view({ id: 'b', status: 'failed', error: 'boom' });

describe('ExportsList slots', () => {
  it('Columns receives the base columns and can add one per priority and a trailing one', () => {
    const seen: string[][] = [];
    const slots: ExportsListSlots = {
      Columns: (base) => {
        seen.push(base.map((column) => column.id));
        const rows: ExportsListColumn = {
          id: 'rows',
          label: 'Rows',
          priority: 'secondary',
          render: (row) => (row.rowCounts ? `${Object.values(row.rowCounts).reduce((a, b) => a + b, 0)} rows` : null),
        };
        const note: ExportsListColumn = { id: 'note', label: 'Note', priority: 'detail', render: () => <em>kept for 7 days</em> };
        const badge: ExportsListColumn = { id: 'badge', label: 'Badge', priority: 'secondary', placement: 'trailing', render: () => <span data-testid="badge">B</span> };
        return [...base, rows, note, badge];
      },
    };
    renderWith(hostWith({}), <ExportsList exports={[READY, FAILED]} sources={[USER_DATA]} slots={slots} />);
    expect(seen[0]).toEqual(['export', 'created', 'size', 'error', 'status']);
    const items = screen.getAllByRole('listitem');
    // the node-valued secondary column joins the string ones with middots
    expect(items[0]).toHaveTextContent('2.0 KB');
    expect(items[0]).toHaveTextContent('5 rows');
    expect(within(items[0]!).getByText('kept for 7 days')).toBeInTheDocument();
    expect(within(items[0]!).getByTestId('badge')).toBeInTheDocument();
    // a column returning null for a row draws nothing there
    expect(items[1]).not.toHaveTextContent('rows');
    expect(items[1]).toHaveTextContent('boom');
  });

  it('Columns can remove a column', () => {
    renderWith(
      hostWith({}),
      <ExportsList exports={[READY]} sources={[USER_DATA]} slots={{ Columns: (base) => base.filter((column) => column.id !== 'size') }} />,
    );
    expect(screen.getByRole('listitem')).not.toHaveTextContent('2.0 KB');
  });

  it('RowActions draws per export, after Download, and receives the export', () => {
    const onPick = vi.fn();
    const RowActions = ({ row }: { row: { id: string; source: string } }) => (
      <button type="button" onClick={() => onPick(row.id)}>
        Share {row.source}
      </button>
    );
    renderWith(hostWith({}), <ExportsList exports={[READY, FAILED]} sources={[USER_DATA]} slots={{ RowActions }} />);
    const [first] = screen.getAllByRole('listitem');
    const buttons = within(first!).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Download', 'Share user-data']);
    fireEvent.click(screen.getAllByRole('button', { name: /^Share/ })[1]!);
    expect(onPick).toHaveBeenCalledWith('b');
  });
});
