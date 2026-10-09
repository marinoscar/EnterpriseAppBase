// `@marinoscar/platform-web/datatable/ui`: the responsive DataTable (desktop
// grid, tablet grid, phone card list) with its filter bar, view bar, export
// control, bulk-action bar and row actions. Pure presentation: the types and
// logic are in `@marinoscar/platform-web/datatable/headless`. Documented in
// ../README.md.

export {
  DataTable,
  useDataTableRenderer,
  rendererForLayout,
  drawableColumns,
  shouldRenderViewBar,
} from './DataTable.js';
export type { ViewBarVisibilityInput } from './DataTable.js';
export { BulkActionBar } from './BulkActionBar.js';
export type { BulkActionBarProps } from './BulkActionBar.js';
export {
  useDataTableLayout,
  useContainerWidth,
  useViewportLayout,
  layoutForWidth,
  DEFAULT_BREAKPOINTS,
  DEFAULT_MOBILE_BREAKPOINT,
  DEFAULT_TABLET_BREAKPOINT,
} from './useContainerLayout.js';
export type { DataTableBreakpoints } from './useContainerLayout.js';
export { DesktopGridRenderer, ACTIONS_FIELD } from './desktop/DesktopGridRenderer.js';
export type { DesktopGridRendererProps } from './desktop/DesktopGridRenderer.js';
export { toGridColDef, toGridColumns, buildColumnVisibilityModel, DEFAULT_COLUMN_MIN_WIDTH } from './desktop/columnAdapter.js';
export { TruncatedCell, DataTableEmptyOverlay, DataTableLoadingOverlay } from './desktop/cells.js';
export type { TruncatedCellProps } from './desktop/cells.js';
export { RowActionsCell } from './desktop/RowActionsCell.js';
export type { RowActionsCellProps } from './desktop/RowActionsCell.js';
export {
  DetailRowPanel,
  EXPANDER_FIELD,
  detailRowHeight,
  detailRowId,
  isDetailRow,
} from './desktop/detailRow.js';
export type { DetailRow, DetailRowPanelProps } from './desktop/detailRow.js';
export { CardListRenderer } from './mobile/CardListRenderer.js';
export { DataCard } from './mobile/DataCard.js';
export type { DataCardProps } from './mobile/DataCard.js';
export { CardField, ExpandableValue, columnContent, columnText } from './mobile/CardField.js';
export type { CardFieldProps, ExpandableValueProps } from './mobile/CardField.js';
export { CompactPagination } from './mobile/CompactPagination.js';
export type { CompactPaginationProps } from './mobile/CompactPagination.js';
export { CardSortControl } from './mobile/CardSortControl.js';
export type { CardSortControlProps } from './mobile/CardSortControl.js';
export { DataTableFilterBar, FILTER_COUNT_CLASS } from './filter/DataTableFilterBar.js';
export type { DataTableFilterBarProps } from './filter/DataTableFilterBar.js';
export { FilterEditor } from './filter/FilterEditor.js';
export type { FilterEditorProps } from './filter/FilterEditor.js';
export { FilterChips } from './filter/FilterChips.js';
export type { FilterChipsProps } from './filter/FilterChips.js';
export { QuickSearchField, DEFAULT_QUICK_SEARCH_DEBOUNCE_MS } from './filter/QuickSearchField.js';
export type { QuickSearchFieldProps } from './filter/QuickSearchField.js';
export { DataTableViewBar, HIDDEN_COLUMN_COUNT_CLASS } from './layout/DataTableViewBar.js';
export type { DataTableViewBarProps } from './layout/DataTableViewBar.js';
export { DataTableExportControl } from './export/DataTableExportControl.js';
export type { DataTableExportControlProps } from './export/DataTableExportControl.js';
export { useRowActionConfirm, confirmCopy } from './shared/rowActionConfirm.js';
export type { RowActionConfirm } from './shared/rowActionConfirm.js';
