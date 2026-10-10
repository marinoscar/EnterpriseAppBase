// The table the identity pages render their lists in (issue #727, PP-6.6).
//
// "Packages own behaviour, apps own appearance": the users, allowlist and
// token lists decide their columns, paging, sorting, filters and row actions;
// the TABLE that draws them is the app's (the reference app hands its
// responsive `DataTable` in through the identity adapters). These types are
// the subset of that table's props the identity pages use, written so an
// app's richer table component is assignable to `IdentityDataTableComponent`
// without a cast. Without an app table the pages fall back to a plain MUI
// table.

import type { ReactElement, ReactNode } from 'react';

/**
 * Where a column shows on a narrow screen: always (`primary`), on the card
 * (`secondary`) or only in the detail view (`detail`).
 *
 * @stability experimental
 */
export type IdentityTableColumnPriority = 'primary' | 'secondary' | 'detail';

/**
 * The filter operators the identity lists use (`is` on an enum column).
 *
 * @stability experimental
 */
export type IdentityTableFilterOperator = 'is';

/**
 * One choice of an enum filter.
 *
 * @stability experimental
 */
export interface IdentityTableEnumValue {
  /** The filter value. */
  value: string;
  /** What the filter shows. */
  label: string;
}

/**
 * One column of an identity list.
 *
 * @typeParam Row - the row type.
 * @stability experimental
 */
export interface IdentityTableColumn<Row> {
  /** Stable id (also the sort field for a sortable column). */
  id: string;
  /** Header text. */
  label: string;
  /** Cell content; defaults to `value`. */
  render?: (row: Row) => ReactNode;
  /** The plain value (search, export, the fallback cell). */
  value?: (row: Row) => string | number | null;
  /** Narrow-screen placement. */
  priority: IdentityTableColumnPriority;
  /** The API can sort by it. */
  sortable?: boolean;
  /** The API can filter by it, with these operators. */
  filterable?: boolean | IdentityTableFilterOperator[];
  /** The filter's input type. */
  filterType?: 'enum';
  /** The choices of an enum filter. */
  enumValues?: IdentityTableEnumValue[];
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
export interface IdentityTableRowAction<Row> {
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
export interface IdentityTableSortState {
  /** The sorted column's id. */
  field: string;
  /** The direction. */
  direction: 'asc' | 'desc';
}

/**
 * Every operator a table's filter model may hold (the identity lists only
 * read `is`). The same union as the reference app's `DataTable`, so its
 * filter model is assignable here and back.
 *
 * @stability experimental
 */
export type IdentityTableFilterModelOperator =
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
export interface IdentityTableFilter {
  /** The filtered column's id. */
  columnId: string;
  /** The operator. */
  operator: IdentityTableFilterModelOperator;
  /** The value. */
  value: string | number | boolean | (string | number)[] | null;
}

/**
 * The props an identity list passes to the table.
 *
 * @typeParam Row - the row type.
 * @stability experimental
 */
export interface IdentityDataTableProps<Row> {
  /** The columns, in order. */
  columns: IdentityTableColumn<Row>[];
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
    sort: IdentityTableSortState | null;
    /** Called with the next sort. */
    onSortChange: (next: IdentityTableSortState | null) => void;
  };
  /** Row selection. */
  selection?: {
    /** The selected row ids. */
    selectedIds: Set<string>;
    /** Called with the next selection. */
    onSelectionChange: (next: Set<string>) => void;
  };
  /** The active filters. */
  filters?: IdentityTableFilter[];
  /** Called with the next filters. */
  onFiltersChange?: (next: IdentityTableFilter[]) => void;
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
  rowActions?: IdentityTableRowAction<Row>[];
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
 * The table component an app hands the identity pages: any component
 * accepting {@link IdentityDataTableProps} for every row type.
 *
 * @stability experimental
 */
export type IdentityDataTableComponent = <Row>(props: IdentityDataTableProps<Row>) => ReactElement | null;
