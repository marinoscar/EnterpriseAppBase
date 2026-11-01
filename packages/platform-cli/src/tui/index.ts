// `@marinoscar/platform-cli/tui`: the TUI's screen and section registries (#715).
// Importing it never loads ink: a screen is an ordinary ink component the
// app writes (best loaded lazily with `load`), given `TuiScreenProps`.
export {
  BUILTIN_TUI_SCREENS,
  TUI_SECTION_SCREENS,
  listRegisteredTuiScreens,
  listTuiScreenSections,
  registerTuiScreen,
  registerTuiScreenSection,
  sortTuiScreens,
} from '../engine/index.js';
export type {
  TuiMenuContext,
  TuiScreenOrder,
  TuiScreenProps,
  TuiScreenRegistration,
  TuiSectionProps,
  TuiSectionRegistration,
} from '../engine/index.js';
