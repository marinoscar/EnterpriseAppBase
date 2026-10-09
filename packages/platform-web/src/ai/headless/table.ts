// The table the AI pages render their lists in (issue #890).
//
// "Packages own behaviour, apps own appearance": the model catalogue and the
// usage breakdowns decide their columns, paging and row actions; the TABLE
// that draws them is the app's (the reference app hands its responsive
// `DataTable` in through the AI adapters). These types are the subset of that
// table's props the AI pages use, written so an app's richer table component
// is assignable to `AiDataTableComponent` without a cast. Without an app
// table the pages fall back to a plain MUI table. The jobs slice's table
// types are the model.

import type { ReactElement, ReactNode } from 'react';

/**
 * Where a column shows on a narrow screen: always (`primary`), on the card
 * (`secondary`) or only in the detail view (`detail`).
 *
 * @stability experimental
 */
export type AiTableColumnPriority = 'primary' | 'secondary' | 'detail';

/**
 * One column of an AI list.
 *
 * @typeParam Row - the row type.
 * @stability experimental
 */
export interface AiTableColumn<Row> {
  /** Stable id. */
  id: string;
  /** Header text. */
  label: string;
  /** Cell content; defaults to `value`. */
  render?: (row: Row) => ReactNode;
  /** The plain value (search, export, the fallback cell). */
  value?: (row: Row) => string | number | null;
  /** Cell and header alignment; default left. */
  align?: 'left' | 'center' | 'right';
  /** Narrow-screen placement. */
  priority: AiTableColumnPriority;
  /** Covered by the quick search. */
  searchable?: boolean;
  /** The viewer may hide it. */
  hideable?: boolean;
  /** Fixed width in pixels. */
  width?: number;
  /** Minimum width in pixels. */
  minWidth?: number;
  /** Flex grow factor. */
  flex?: number;
}

/**
 * A per-row action (a menu item or an icon button).
 *
 * @typeParam Row - the row type.
 * @stability experimental
 */
export interface AiTableRowAction<Row> {
  /** Stable id. */
  id: string;
  /** Text and accessible name. */
  label: string;
  /** Optional icon. */
  icon?: ReactNode;
  /** Runs the action. */
  onClick: (row: Row) => void;
  /** Disables it for a row. */
  disabled?: (row: Row) => boolean;
}

/**
 * The props an AI list passes to the table.
 *
 * @typeParam Row - the row type.
 * @stability experimental
 */
export interface AiDataTableProps<Row> {
  /** The columns, in order. */
  columns: AiTableColumn<Row>[];
  /** This page's rows. */
  rows: Row[];
  /** A row's stable id. */
  rowId: (row: Row) => string;
  /** A request is in flight. */
  loading?: boolean;
  /** Shown when there are no rows. */
  emptyState?: ReactNode;
  /** Server-side paging. */
  pagination?: {
    /** The page, zero-based. */
    page: number;
    /** The page size. */
    pageSize: number;
    /** Rows across all pages. */
    total: number;
    /** Called with the next page and size. */
    onPaginationChange: (next: {
      /** The page. */
      page: number;
      /** The page size. */
      pageSize: number;
    }) => void;
    /** The page sizes offered. */
    pageSizeOptions?: number[];
  };
  /** The quick search box. */
  quickSearch?: {
    /** The current text. */
    value: string;
    /** Called with the next text. */
    onChange: (next: string) => void;
    /** Placeholder text. */
    placeholder?: string;
    /** Accessible name. */
    ariaLabel?: string;
  };
  /** Per-row actions. */
  rowActions?: AiTableRowAction<Row>[];
  /** CSV export of the rows shown. */
  csvExport?: {
    /** File name without extension. */
    filename?: string;
  };
  /** Hides the export control. */
  disableExport?: boolean;
  /** Persisted layout key (column visibility, density). */
  tableId?: string;
  /** Accessible name of the table. */
  ariaLabel?: string;
  /** Test id. */
  'data-testid'?: string;
}

/**
 * The table component an app hands the AI pages: any component accepting
 * {@link AiDataTableProps} for every row type.
 *
 * @stability experimental
 */
export type AiDataTableComponent = <Row>(props: AiDataTableProps<Row>) => ReactElement | null;
