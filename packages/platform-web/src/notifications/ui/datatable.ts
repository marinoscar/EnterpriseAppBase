// The table the broadcasts page renders through (issue #738): the identity
// slice's table seam, reused rather than copied. The reference app's
// responsive `DataTable` arrives through the identity web adapters
// (`IdentityWebAdaptersProvider`), and a plain MUI table stands in without
// one. The column, filter and row-action shapes are the same contract.
// Slice-internal.

export { IdentityTable as DataTable } from '../../identity/index.js';
export type { IdentityTableRowAction as DataTableRowAction } from '../../identity/index.js';
import type { IdentityTableColumn, IdentityTableFilter } from '../../identity/index.js';

/**
 * One column. The identity column contract plus `align`, which the reference
 * app's `DataTable` honours (cell and header) and the fallback table ignores.
 */
export type DataTableColumn<Row> = IdentityTableColumn<Row> & {
  /** Cell and header alignment. Default `'left'`. */
  align?: 'left' | 'center' | 'right';
};

/** The table's filter model: one entry per active column filter. */
export type DataTableFilterModel = IdentityTableFilter[];
