/**
 * Component tests — the shared DataTable conformance suite (issue #257).
 *
 * This file's entire job is to invoke the reusable suite
 * (`src/datatable/testing/runDataTableConformanceSuite.tsx`) against the
 * built-in fixture table, under MUI's default light and dark themes. See that
 * module's docblock for the full contract this exercises, and for how a page
 * can invoke the same suite against its own columns, including the
 * accessibility contract and keyboard model this suite enforces.
 */

import { describe } from 'vitest';
import { runDataTableConformanceSuite } from '../../src/datatable/testing/runDataTableConformanceSuite.js';

describe('DataTable — shared conformance suite (issue #257)', () => {
  runDataTableConformanceSuite();
});
