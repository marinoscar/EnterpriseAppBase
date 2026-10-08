// `@marinoscar/platform-web/shell/headless`: the app shell's navigation model,
// theme and providers composition, with no component (issue #868). Documented
// in ../README.md.

export {
  isDestinationVisible,
  owns,
  resolveActiveDestination,
  shellDestinationRoutes,
} from './navigation.js';
export type {
  ShellConsole,
  ShellDestination,
  ShellIcon,
  ShellNavigation,
  ShellRailPreference,
  ShellSettingsSurface,
} from './navigation.js';
export { useShellRailPreference } from './rail-preference.js';
export type { ShellRailPreferenceOptions, UseShellRailPreferenceResult } from './rail-preference.js';
export {
  createShellTheme,
  shellComponentOverrides,
  shellPalette,
  useOptionalShellTheme,
  useShellTheme,
} from './theme.js';
export type { ShellThemeContextValue, ShellThemeMode, ShellThemeOptions } from './theme.js';
export { ShellProviders } from './providers.js';
export type { ShellProvider } from './providers.js';
