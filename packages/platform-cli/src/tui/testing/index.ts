// `@marinoscar/platform-cli/tui/testing`: the TUI testing kit (RETRO-G1.5, #1069).
// For tests only. Importing it loads ink and `ink-testing-library`, an OPTIONAL
// peer of the package: install it as a dev dependency of the app that tests screens.
//
// The kit lives in the engine slice (the `tui` conformance suite renders screens
// with it, and the engine cannot import `tui`). Like `tui/ui`, this one file
// reaches into the engine's `tui/testing` directory directly so `/tui` itself
// never has ink on its import graph.
/* eslint-disable boundaries/dependencies */
export {
  TUI_TEST_SCREEN_ROUTE,
  cleanup,
  frameLines,
  hasAnsi,
  renderTuiMenu,
  renderTuiRoute,
  renderAt,
  renderTuiScreen,
  stripAnsi,
} from '../../engine/tui/testing/harness.js';
export type {
  RenderTuiMenuOptions,
  RenderedAt,
  RenderTuiScreenOptions,
  TuiMenuHandle,
  TuiRenderOptions,
  TuiTestHandle,
  TuiTestNav,
  TuiTestStdin,
  TuiTestSession,
} from '../../engine/tui/testing/harness.js';
export { fakeDaemonFeed, fakeEmitterFeed } from '../../engine/tui/testing/feeds.js';
export type { FakeDashboardFeed } from '../../engine/tui/testing/feeds.js';
