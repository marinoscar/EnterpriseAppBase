// `@marinoscar/platform-cli/tui`: the TUI's screen registry (#715).
// Importing it never loads ink: a screen is an ordinary ink component the
// app writes (best loaded lazily with `load`), given `TuiScreenProps`.
export {
  BUILTIN_TUI_SCREENS,
  listRegisteredTuiScreens,
  registerTuiScreen,
  sortTuiScreens,
} from '../engine/index.js';
export type { TuiMenuContext, TuiScreenOrder, TuiScreenProps, TuiScreenRegistration } from '../engine/index.js';
