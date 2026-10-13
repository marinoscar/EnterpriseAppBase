// The table half of the page-slot contract (PP-14.23): `useTableSlotColumns`
// returns the page's columns untouched when no table slot is set, and otherwise
// appends the `RowActions` and `DetailPanel` columns before `Columns` sees them.

import { render, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  PageSlotsFrame,
  SLOT_DETAIL_PANEL_COLUMN_ID,
  SLOT_ROW_ACTIONS_COLUMN_ID,
  useTableSlotColumns,
} from '../../src/core/index.js';
import type { SlotTableColumn, TableSlots } from '../../src/core/index.js';

interface Row {
  id: string;
}

const BASE: SlotTableColumn<Row>[] = [{ id: 'name', label: 'Name', priority: 'primary' }];

describe('useTableSlotColumns', () => {
  it('returns the very same array when no table slot is set', () => {
    const { result } = renderHook(() => useTableSlotColumns<Row, SlotTableColumn<Row>>(BASE, undefined));
    expect(result.current).toBe(BASE);

    const { result: empty } = renderHook(() => useTableSlotColumns<Row, SlotTableColumn<Row>>(BASE, {}));
    expect(empty.current).toBe(BASE);
  });

  it('appends a "More actions" column that draws RowActions for the row', () => {
    const slots: TableSlots<Row> = { RowActions: ({ row }) => <button type="button">act {row.id}</button> };
    const { result } = renderHook(() => useTableSlotColumns<Row, SlotTableColumn<Row>>(BASE, slots));

    expect(result.current.map((column) => column.id)).toEqual(['name', SLOT_ROW_ACTIONS_COLUMN_ID]);
    const column = result.current[1] as SlotTableColumn<Row> & { exportable?: boolean; hideable?: boolean };
    expect(column).toMatchObject({ label: 'More actions', priority: 'secondary', exportable: false, hideable: false });
    const { getByRole } = render(<>{column.render?.({ id: 'r1' })}</>);
    expect(getByRole('button', { name: 'act r1' })).toBeInTheDocument();
  });

  it('appends a detail-priority "Details" column for DetailPanel', () => {
    const slots: TableSlots<Row> = { DetailPanel: ({ row }) => <p>detail {row.id}</p> };
    const { result } = renderHook(() => useTableSlotColumns<Row, SlotTableColumn<Row>>(BASE, slots));

    expect(result.current.map((column) => column.id)).toEqual(['name', SLOT_DETAIL_PANEL_COLUMN_ID]);
    expect(result.current[1]).toMatchObject({ label: 'Details', priority: 'detail' });
    const { getByText } = render(<>{result.current[1]?.render?.({ id: 'r2' })}</>);
    expect(getByText('detail r2')).toBeInTheDocument();
  });

  it('hands the result, slot columns included, to Columns last', () => {
    const seen: string[][] = [];
    const slots: TableSlots<Row> = {
      RowActions: () => null,
      DetailPanel: () => null,
      Columns: (base) => {
        seen.push(base.map((column) => column.id));
        return [...base].reverse();
      },
    };
    const { result } = renderHook(() => useTableSlotColumns<Row, SlotTableColumn<Row>>(BASE, slots));

    expect(seen[0]).toEqual(['name', SLOT_ROW_ACTIONS_COLUMN_ID, SLOT_DETAIL_PANEL_COLUMN_ID]);
    expect(result.current.map((column) => column.id)).toEqual([
      SLOT_DETAIL_PANEL_COLUMN_ID,
      SLOT_ROW_ACTIONS_COLUMN_ID,
      'name',
    ]);
  });

  it('lets Columns alone add or remove columns', () => {
    const slots: TableSlots<Row> = { Columns: () => [{ id: 'only', label: 'Only', priority: 'primary' }] };
    const { result } = renderHook(() => useTableSlotColumns<Row, SlotTableColumn<Row>>(BASE, slots));
    expect(result.current.map((column) => column.id)).toEqual(['only']);
  });

  it('keeps its result while the inputs are unchanged', () => {
    const slots: TableSlots<Row> = { RowActions: () => null };
    const { result, rerender } = renderHook(() => useTableSlotColumns<Row, SlotTableColumn<Row>>(BASE, slots));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});


describe('PageSlotsFrame', () => {
  const headerProps = { title: 'Example', description: 'About it', readOnly: false, actions: null };

  it('renders the page header and body with no wrapper when no slot is set', () => {
    const { container } = render(
      <PageSlotsFrame slots={undefined} header={<h1>Own header</h1>} headerProps={headerProps}>
        <p>body</p>
      </PageSlotsFrame>,
    );
    expect(container.innerHTML).toBe('<h1>Own header</h1><p>body</p>');
  });

  it('draws the slots in the contract order, Sections at both ends, Header replacing the page header', () => {
    const { container } = render(
      <PageSlotsFrame
        slots={{
          Header: ({ title }) => <h1>custom {title}</h1>,
          BeforeContent: () => <i>before</i>,
          Sections: ({ position }) => <b>{position}</b>,
          AfterContent: () => <u>after</u>,
        }}
        header={<h1>Own header</h1>}
        headerProps={headerProps}
      >
        <p>body</p>
      </PageSlotsFrame>,
    );
    expect(container.innerHTML).toBe('<h1>custom Example</h1><i>before</i><b>top</b><p>body</p><b>bottom</b><u>after</u>');
  });
});
