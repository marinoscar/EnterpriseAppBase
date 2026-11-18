/**
 * Component tests — the shared DataTable conformance suite (issue #257).
 *
 * This file's entire job is to invoke the reusable suite
 * (`src/datatable/testing/runDataTableConformanceSuite.tsx`) against the
 * built-in fixture table, under MUI's default light and dark themes. See that
 * module's docblock for the full contract this exercises, and for how a page
 * can invoke the same suite against its own columns, including the
 * accessibility contract and keyboard model this suite enforces.
 *
 * The second run (issue #1109) is shaped like a real app table the suite used
 * to reject: no sortable column, and a `filterOnly` column ("Processed
 * within") that has no header. The sort-dependent cases skip and the
 * visibility case counts only drawn columns.
 */

import { describe } from 'vitest';
import {
  conformanceFixtureColumns,
  conformanceFixtureRowId,
  conformanceFixtureRows,
  runDataTableConformanceSuite,
} from '../../src/datatable/testing/runDataTableConformanceSuite.js';
import type { ConformanceRow } from '../../src/datatable/testing/runDataTableConformanceSuite.js';
import type { DataTableColumn } from '../../src/datatable/headless/types.js';

describe('DataTable — shared conformance suite (issue #257)', () => {
  runDataTableConformanceSuite();
});

/** The fixture with every `sortable` dropped and a `filterOnly` column added. */
const unsortableColumns: DataTableColumn<ConformanceRow>[] = [
  ...conformanceFixtureColumns.map(({ sortable: _sortable, ...column }) => column),
  {
    id: 'processedWithin',
    label: 'Processed within',
    priority: 'detail',
    filterOnly: true,
    filterable: true,
    filterType: 'enum',
    enumValues: [
      { value: '24h', label: 'Last 24 hours' },
      { value: '7d', label: 'Last 7 days' },
    ],
    value: () => null,
  },
];

describe('DataTable — conformance on a table with no sortable column and a filterOnly column (issue #1109)', () => {
  runDataTableConformanceSuite<ConformanceRow>({
    label: 'Unsortable',
    columns: unsortableColumns,
    rows: conformanceFixtureRows,
    rowId: conformanceFixtureRowId,
  });
});
