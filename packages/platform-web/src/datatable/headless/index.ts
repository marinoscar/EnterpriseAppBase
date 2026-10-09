// `@marinoscar/platform-web/datatable/headless`: the DataTable's contract and
// logic without any drawing: the column and prop types, the filter operators,
// model and URL state, the layout-preference model and hook with its storage
// port, the CSV export model, and the virtualization planners. Documented in
// ../README.md.

export { extractColumnValue, formatColumnValue, rowAccessibleName } from './columns.js';
export {
  OPERATORS_BY_FILTER_TYPE,
  DEFAULT_FILTER_TYPE,
  operatorLabel,
  operatorArity,
  operatorsForColumn,
  defaultOperatorForColumn,
  filterTypeOf,
  isFilterableColumn,
  filterableColumns,
  searchableColumns,
} from './filter/operators.js';
export type { OperatorArity } from './filter/operators.js';
export {
  addFilter,
  removeFilterAt,
  replaceFilterAt,
  containsFilter,
  sameFilter,
  filterKey,
  filterChipLabel,
  describeFilterValue,
  isFilterComplete,
  draftFilterFor,
  blankValueFor,
  columnForFilter,
} from './filter/filterModel.js';
export {
  readDataTableUrlState,
  writeDataTableUrlState,
  encodeFilter,
  decodeFilter,
  DATATABLE_FILTER_PARAM,
  DATATABLE_SEARCH_PARAM,
} from './filter/filterUrl.js';
export type { DataTableUrlState, DataTableUrlOptions } from './filter/filterUrl.js';
export { useDataTableLayoutPrefs } from './layout/useDataTableLayoutPrefs.js';
export type {
  DataTableLayoutPrefs,
  UseDataTableLayoutPrefsOptions,
} from './layout/useDataTableLayoutPrefs.js';
export {
  CARD_DENSITY,
  DATA_TABLE_MAX_ID_LENGTH,
  DATA_TABLE_MAX_VISIBLE_COLUMNS,
  DATA_TABLE_PERSIST_DEBOUNCE_MS,
  DEFAULT_DENSITY,
  DENSITY_LABELS,
  DENSITY_OPTIONS,
  HIDDEN_COLUMN_PREFIX,
  cardDensityMetrics,
  decodeVisibility,
  encodeVisibility,
  isDensity,
  isEmptyStoredLayout,
  isHideable,
  layoutHidesColumn,
  pickerColumns,
  resolveStoredSort,
  resolveUserVisibleColumnIds,
  resolveVisibleColumnIds,
  sanitizeStoredLayout,
} from './layout/layoutModel.js';
export type {
  CardDensityMetrics,
  DataTablesSettings,
  DataTableStoredLayout,
  DataTableStoredSort,
  DecodedVisibility,
} from './layout/layoutModel.js';
export {
  CSV_BOM,
  CSV_FIELD_SEPARATOR,
  CSV_FORMULA_ESCAPE,
  CSV_FORMULA_PREFIXES,
  CSV_ROW_SEPARATOR,
  escapeCsvField,
  isFormulaText,
  neutralizeFormula,
  toCsv,
  toCsvFile,
  toCsvRow,
} from './export/csv.js';
export {
  DATA_TABLE_EXPORT_FETCH_PAGE_SIZE,
  DATA_TABLE_EXPORT_MAX_ROWS,
  ExportCancelledError,
  buildCsvForRows,
  buildExportMatrix,
  collectAllRows,
  downloadCsv,
  exportColumns,
  exportFilename,
  isExportableColumn,
  slugifyExportName,
} from './export/exportModel.js';
export type {
  CollectAllRowsOptions,
  CollectAllRowsResult,
  ExportMatrix,
} from './export/exportModel.js';
export {
  GRID_CHROME_HEIGHT,
  GRID_ROW_HEIGHT,
  GRID_VIRTUALIZATION_ROW_THRESHOLD,
  GRID_VIRTUALIZED_VISIBLE_ROWS,
  planGridVirtualization,
  virtualizedViewportHeight,
} from './virtualization/gridVirtualization.js';
export type {
  GridVirtualizationInput,
  GridVirtualizationPlan,
} from './virtualization/gridVirtualization.js';
export {
  CARD_FALLBACK_INTRINSIC_HEIGHT,
  CARD_VIRTUALIZATION_MIN_ROWS,
  containIntrinsicSize,
  shouldVirtualizeCards,
  useLazyImages,
  useMeasuredCardHeight,
} from './virtualization/cardVirtualization.js';
export type {
  DataTableColumn,
  DataTableColumnPriority,
  DataTableAlign,
  DataTableDensity,
  DataTableSortDirection,
  DataTableSortState,
  DataTableSortConfig,
  DataTablePaginationConfig,
  DataTableSelectionConfig,
  DataTableRowAction,
  DataTableBulkAction,
  DataTableConfirmOptions,
  DataTableProps,
  DataTableRendererProps,
  DataTableRendererMode,
  DataTableLayout,
  DataTableRendererKind,
  FilterOperator,
  DataTableFilterType,
  DataTableEnumValue,
  DataTableFilter,
  DataTableFilterModel,
  DataTableFilterValue,
  DataTableQuickSearchConfig,
  DataTableExportConfig,
  DataTableExportFetchPage,
} from './types.js';
// --- Layout preferences storage port -----------------------------------------
export {
  DataTablePreferencesProvider,
  createUserSettingsPreferencesPort,
  useDataTablePreferencesPort,
} from './layout/preferences.js';
export type { DataTablePreferencesPort } from './layout/preferences.js';
