/**
 * DataTable — the operator catalog.
 *
 * One table maps a column's {@link DataTableFilterType} onto the operators the
 * filter UI offers for it, and one function decides how many operands each
 * operator takes. Everything else in `filter/` reads from here, so adding an
 * operator is a single-file change.
 *
 * ## Why a declared type, not an inferred one
 *
 * The operator set could have been inferred from the first row's value. It
 * isn't, because inference is unstable in exactly the cases that matter: an
 * empty page has nothing to infer from, and a nullable column whose first page
 * happens to be all nulls would silently offer text operators for a number.
 * A column declares `filterType` once and the UI is deterministic forever.
 *
 * ## Why the defaults are narrow
 *
 * The default sets are the ones issue #254 specifies, and they are short on
 * purpose — six operators on a text column is a menu nobody reads. A column
 * that genuinely needs more pins them explicitly:
 * `filterable: ['contains', 'endsWith', 'isNotEmpty']`.
 */

import type {
  BuiltinDataTableFilterType,
  DataTableColumn,
  DataTableFilterType,
  FilterOperator,
  FilterOperatorDef,
  OperatorArity,
} from '../types.js';
import {
  BUILTIN_OPERATORS,
  getDataTableFilterType,
  knownOperatorArity,
  learnColumnOperators,
} from './filterTypes.js';

export type { OperatorArity } from '../types.js';

/**
 * Assumed when a filterable column declares no `filterType`.
 *
 * @stability experimental
 */
export const DEFAULT_FILTER_TYPE: DataTableFilterType = 'text';

const BUILTIN_TYPE_IDS: readonly BuiltinDataTableFilterType[] = ['text', 'number', 'date', 'enum', 'boolean'];

function defaultsOf(type: BuiltinDataTableFilterType): FilterOperator[] {
  return getDataTableFilterType(type)!.operators.map((operator) => operator.id);
}

/**
 * The default operator set per BUILT-IN value type — issue #254's catalog,
 * verbatim. Order is the order the operator picker lists them in, so the first
 * entry is also the default operator for a fresh filter on that type. A type an
 * app registered (`registerDataTableFilterType`) is not listed here; ask
 * {@link operatorsForColumn}.
 *
 * @stability experimental
 */
export const OPERATORS_BY_FILTER_TYPE: Record<BuiltinDataTableFilterType, FilterOperator[]> = Object.fromEntries(
  BUILTIN_TYPE_IDS.map((type) => [type, defaultsOf(type)]),
) as Record<BuiltinDataTableFilterType, FilterOperator[]>;

/**
 * Number columns read `=`, `>`, `<` rather than "equals / is greater than / is
 * less than", which is how anyone scanning a numeric filter actually thinks
 * about it. Covers the pinned-only `gte` / `lte` too.
 */
const NUMBER_OPERATOR_LABELS: Partial<Record<string, string>> = {
  equals: '=',
  gt: '>',
  lt: '<',
  gte: '≥',
  lte: '≤',
};

/**
 * Display label for an operator, in the context of a value type: the type's
 * own word for it when it lists the operator, else the platform's.
 *
 * @stability experimental
 */
export function operatorLabel(
  operator: FilterOperator,
  filterType: DataTableFilterType = DEFAULT_FILTER_TYPE,
): string {
  const listed = getDataTableFilterType(filterType)?.operators.find((def) => def.id === operator);
  if (listed) return listed.label;
  if (filterType === 'number' && NUMBER_OPERATOR_LABELS[operator]) return NUMBER_OPERATOR_LABELS[operator]!;
  return (BUILTIN_OPERATORS as Record<string, FilterOperatorDef | undefined>)[operator]?.label ?? operator;
}

/**
 * The label of an operator as one COLUMN offers it: its own inline definition
 * (`filter.operators`) wins, then the column's type, then the platform's.
 *
 * @stability experimental
 */
export function columnOperatorLabel<Row>(column: DataTableColumn<Row>, operator: FilterOperator): string {
  const inline = column.filter?.operators?.find((def) => def.id === operator);
  return inline ? inline.label : operatorLabel(operator, filterTypeOf(column));
}

/**
 * How many values an operator takes (see {@link OperatorArity}). Knows the
 * platform's operators and every one a registered filter type or a column
 * declared; an id nobody declared takes one.
 *
 * @param operator - the filter operator.
 * @returns its arity.
 *
 * @stability experimental
 */
export function operatorArity(operator: FilterOperator): OperatorArity {
  return knownOperatorArity(operator);
}

/**
 * The value type a column filters as: `filter.type`, else `filterType`, else
 * `text`.
 *
 * @stability experimental
 */
export function filterTypeOf<Row>(column: DataTableColumn<Row>): DataTableFilterType {
  return column.filter?.type ?? column.filterType ?? DEFAULT_FILTER_TYPE;
}

/**
 * Whether a column offers filtering at all.
 *
 * A column is filterable when `filterable` is `true` or a non-empty operator
 * list, or when it declares a `filter` (unless `filterable` is `false`), AND
 * its type is registered. An `enum` column with no `enumValues` is treated as
 * NOT filterable: the operand picker would have nothing to list, and an
 * operator you cannot supply a value for is exactly the "looks live, does
 * nothing" affordance the contract refuses elsewhere (see `sortable`'s opt-in
 * rationale). A column naming a type nobody registered is not filterable
 * either, and says so once on the console.
 *
 * @stability experimental
 */
export function isFilterableColumn<Row>(column: DataTableColumn<Row>): boolean {
  const declared =
    column.filterable === true ||
    (Array.isArray(column.filterable) && column.filterable.length > 0) ||
    (column.filter !== undefined && column.filterable !== false);
  if (!declared) return false;
  learnColumnOperators(column.filter?.operators);
  const type = filterTypeOf(column);
  if (!getDataTableFilterType(type)) {
    warnUnknownType(type, column.id);
    return false;
  }
  if (type === 'enum') return (column.enumValues?.length ?? 0) > 0;
  return true;
}

const warnedTypes = new Set<string>();
function warnUnknownType(type: string, columnId: string): void {
  if (warnedTypes.has(type)) return;
  warnedTypes.add(type);
  console.warn(`DataTable column "${columnId}" filters as "${type}", which is not registered (registerDataTableFilterType); it is not filterable.`);
}

/**
 * Every filterable column, in declaration order.
 *
 * @stability experimental
 */
export function filterableColumns<Row>(
  columns: DataTableColumn<Row>[],
): DataTableColumn<Row>[] {
  return columns.filter(isFilterableColumn);
}

/**
 * The operators offered for a column: the explicit `filterable` array when one
 * is declared, else the column's inline `filter.operators`, else the default
 * set of its value type.
 *
 * @stability experimental
 */
export function operatorsForColumn<Row>(column: DataTableColumn<Row>): FilterOperator[] {
  if (Array.isArray(column.filterable) && column.filterable.length > 0) {
    learnColumnOperators(column.filter?.operators);
    return column.filterable;
  }
  if (column.filter?.operators && column.filter.operators.length > 0) {
    learnColumnOperators(column.filter.operators);
    return column.filter.operators.map((operator) => operator.id);
  }
  const type = getDataTableFilterType(filterTypeOf(column));
  return type ? type.operators.map((operator) => operator.id) : [];
}

/**
 * The operator a fresh filter on this column starts with.
 *
 * @stability experimental
 */
export function defaultOperatorForColumn<Row>(column: DataTableColumn<Row>): FilterOperator {
  return operatorsForColumn(column)[0]!;
}

/**
 * Every column marked `searchable`, in declaration order.
 *
 * @stability experimental
 */
export function searchableColumns<Row>(
  columns: DataTableColumn<Row>[],
): DataTableColumn<Row>[] {
  return columns.filter((column) => column.searchable === true);
}
