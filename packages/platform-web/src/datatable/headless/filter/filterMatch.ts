/**
 * DataTable — client-side filter matching, for pages that need it.
 *
 * The table NEVER filters the rows it is given: filtering is the server's.
 * These helpers exist for the places that have no server to ask — a mock
 * endpoint in a test, a fixture-backed Storybook page, a page that filters an
 * already-loaded list — and they use the same per-type rules a registered
 * filter type declares (`DataTableFilterTypeDef.matches`), so a custom type is
 * matched the way its author defined.
 */

import { extractColumnValue } from '../columns.js';
import type { DataTableColumn, DataTableFilter, DataTableFilterModel, DataTableFilterValue, FilterOperator } from '../types.js';
import { getDataTableFilterType } from './filterTypes.js';
import { filterTypeOf } from './operators.js';

/**
 * Whether a value satisfies one comparison under a filter type's rules.
 *
 * @param type - the filter type id.
 * @param value - the scalar behind the cell.
 * @param operator - the operator.
 * @param operand - the operand.
 * @returns `true` when it matches; `false` for an unregistered type.
 *
 * @stability experimental
 */
export function matchesFilterValue(
  type: string,
  value: unknown,
  operator: FilterOperator,
  operand: DataTableFilterValue,
): boolean {
  const def = getDataTableFilterType(type);
  return def ? def.matches(value, operator, operand) : false;
}

/**
 * Whether a row satisfies every filter of a model (they are AND-ed). A filter
 * naming a column the table no longer declares is ignored, as the chips do.
 *
 * @param row - the row.
 * @param columns - the table's columns.
 * @param model - the filter model.
 * @returns `true` when the row matches all of them.
 *
 * @stability experimental
 */
export function matchesFilters<Row>(row: Row, columns: DataTableColumn<Row>[], model: DataTableFilterModel): boolean {
  return model.every((filter: DataTableFilter) => {
    const column = columns.find((candidate) => candidate.id === filter.columnId);
    if (!column) return true;
    return matchesFilterValue(filterTypeOf(column), extractColumnValue(column, row), filter.operator, filter.value);
  });
}
