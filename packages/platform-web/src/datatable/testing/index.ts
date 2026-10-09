// `@marinoscar/platform-web/datatable/testing`: the DataTable's test support.
// `runDataTableConformanceSuite` runs the mechanics suite against a fixture
// table (or a page's own columns), and `layoutStubs` gives jsdom a layout.
// Test-only: never import it from production code. Needs `vitest`,
// `@testing-library/react`, `@testing-library/user-event` and `vitest-axe`.
// Documented in ../README.md.

export {
  conformanceFixtureColumns,
  conformanceFixtureRowId,
  conformanceFixtureRows,
  runDataTableConformanceSuite,
} from './runDataTableConformanceSuite.js';
export type { ConformanceRow, DataTableConformanceOptions } from './runDataTableConformanceSuite.js';
export { assertNoInvisibleHitTargets } from './a11yGuards.js';
export {
  CARD_HEIGHT,
  VIEWPORT_HEIGHT,
  VIEWPORT_WIDTH,
  installLayoutStubs,
  resetContainerWidth,
  setContainerWidth,
  setInitialContainerWidth,
} from './layoutStubs.js';
