// The table the worker-node page renders its lists in (issue #881; same shape as
// the jobs slice's, which cannot be imported: the slices stay independent).
//
// "Packages own behaviour, apps own appearance": the job list, the per-type
// insights, the fleet and the credential list decide their columns, paging,
// filters and row actions; the TABLE that draws them is the app's (the
// reference app hands its responsive `DataTable` in through the nodes
// adapters). These types are the subset of that table's props the nodes page
// uses, written so an app's richer table component is assignable to
// `NodesDataTableComponent` without a cast. Without an app table the pages fall
// back to a plain MUI table. The identity slice's table types are the model;
// these add `align` and `filterOnly` (the job list's `scheduled` and
// `processedWithin` filters have no cell worth printing).

import type { ReactElement, ReactNode } from 'react';

/**
 * Where a column shows on a narrow screen: always (`primary`), on the card
 * (`secondary`) or only in the detail view (`detail`).
 *
 * @stability experimental
 */
export type NodesTableColumnPriority = 'primary' | 'secondary' | 'detail';

/**
 * The filter operators the node lists use (`is` on an enum column).
 *
 * @stability experimental
 */
export type NodesTableFilterOperator = 'is';

/**
 * One choice of an enum filter.
 *
 * @stability experimental
 */
export interface NodesTableEnumValue {
  /** The filter value. */
  value: string;
  /** What the filter shows. */
  label: string;
}

/**
 * One column of a node list.
 *
 * @typeParam Row - the row type.
 * @stability experimental
 */
export interface NodesTableColumn<Row> {
  /** Stable id (also the sort field for a sortable column). */
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
  priority: NodesTableColumnPriority;
  /** The API can sort by it. */
  sortable?: boolean;
  /** The API can filter by it, with these operators. */
  filterable?: boolean | NodesTableFilterOperator[];
  /** The filter's input type. */
  filterType?: 'enum';
  /** The choices of an enum filter. */
  enumValues?: NodesTableEnumValue[];
  /**
   * A query parameter with no cell: offered in the filter menu, never drawn
   * as a column (the job list's backoff and activity-window filters).
   */
  filterOnly?: boolean;
  /** Covered by the quick search. */
  searchable?: boolean;
  /** Included in a CSV export. */
  exportable?: boolean;
  /** The viewer may hide it. */
  hideable?: boolean;
  /** Truncate long values with an ellipsis. */
  truncate?: boolean;
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
export interface NodesTableRowAction<Row> {
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
  /** Why it is disabled, for a tooltip. */
  disabledReason?: (row: Row) => string | undefined;
  /** Styled as destructive. */
  destructive?: boolean;
  /** Ask for confirmation first. */
  confirm?: boolean | {
    /** Dialog title. */
    title?: string;
    /** Dialog text. */
    description?: string | ((row: Row) => string);
    /** Confirm button text. */
    confirmLabel?: string;
    /** Cancel button text. */
    cancelLabel?: string;
  };
}

/**
 * The current sort.
 *
 * @stability experimental
 */
export interface NodesTableSortState {
  /** The sorted column's id. */
  field: string;
  /** The direction. */
  direction: 'asc' | 'desc';
}

/**
 * Every operator a table's filter model may hold (the node lists only
 * read `is`). The same union as the reference app's `DataTable`, so its
 * filter model is assignable here and back.
 *
 * @stability experimental
 */
export type NodesTableFilterModelOperator =
  | 'equals'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'before'
  | 'after'
  | 'is'
  | 'isNot'
  | 'isAnyOf'
  | 'in'
  | 'isEmpty'
  | 'isNotEmpty';

/**
 * One active filter.
 *
 * @stability experimental
 */
export interface NodesTableFilter {
  /** The filtered column's id. */
  columnId: string;
  /** The operator. */
  operator: NodesTableFilterModelOperator;
  /** The value. */
  value: string | number | boolean | (string | number)[] | null;
}

/**
 * The props a node list passes to the table.
 *
 * @typeParam Row - the row type.
 * @stability experimental
 */
export interface NodesDataTableProps<Row> {
  /** The columns, in order. */
  columns: NodesTableColumn<Row>[];
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
    onPaginationChange: (next: { page: number; pageSize: number }) => void;
    /** The page sizes offered. */
    pageSizeOptions?: number[];
  };
  /** Server-side sorting. */
  sort?: {
    /** The current sort, or `null`. */
    sort: NodesTableSortState | null;
    /** Called with the next sort. */
    onSortChange: (next: NodesTableSortState | null) => void;
  };
  /** Row selection. */
  selection?: {
    /** The selected row ids. */
    selectedIds: Set<string>;
    /** Called with the next selection. */
    onSelectionChange: (next: Set<string>) => void;
  };
  /** The active filters. */
  filters?: NodesTableFilter[];
  /** Called with the next filters. */
  onFiltersChange?: (next: NodesTableFilter[]) => void;
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
  rowActions?: NodesTableRowAction<Row>[];
  /** CSV export of every page. */
  csvExport?: {
    /** File name without extension. */
    filename?: string;
    /** Reads one page of every row for the export (zero-based page). */
    fetchAllRows?: (params: { page: number; pageSize: number; signal?: AbortSignal }) => Promise<Row[]>;
  };
  /** Persisted layout key (column visibility, density). */
  tableId?: string;
  /** Row density. */
  density?: 'compact' | 'standard' | 'comfortable';
  /** Accessible name of the table. */
  ariaLabel?: string;
  /** Test id. */
  'data-testid'?: string;
}

/**
 * The table component an app hands the nodes pages: any component
 * accepting {@link NodesDataTableProps} for every row type.
 *
 * @stability experimental
 */
export type NodesDataTableComponent = <Row>(props: NodesDataTableProps<Row>) => ReactElement | null;
