// `@marinoscar/platform-web/shell/headless`: the app shell's navigation model,
// theme and providers composition, with no component (issue #868). Documented
// in ../README.md.

export {
  groupDestinationRuns,
  isDestinationVisible,
  isExternalUrl,
  owns,
  resolveActiveDestination,
  shellDestinationRoutes,
} from './navigation.js';
export type {
  ShellConsole,
  ShellConsoleBack,
  ShellDestination,
  ShellDestinationRun,
  ShellIcon,
  ShellIconProps,
  ShellNavigation,
  ShellRailPreference,
  ShellSettingsSurface,
} from './navigation.js';
export {
  ShellPreferencesProvider,
  createLocalStorageShellPreferencesPort,
  useOptionalShellPreferencesPort,
} from './preferences.js';
export type { ShellPreferences, ShellPreferencesPort, ShellPreferencesProviderProps } from './preferences.js';
export { useShellRailPreference } from './rail-preference.js';
export type { ShellRailPreferenceOptions, UseShellRailPreferenceResult } from './rail-preference.js';
export {
  BUILTIN_SHELL_THEME_MODES,
  createShellTheme,
  isBuiltinThemeMode,
  listThemeModes,
  registerThemeMode,
  shellComponentOverrides,
  shellPalette,
  useOptionalShellTheme,
  useShellTheme,
} from './theme.js';
export type {
  ShellThemeContextValue,
  ShellThemeMode,
  ShellThemeModeDefinition,
  ShellThemeModeOption,
  ShellThemeOptions,
} from './theme.js';
export { ShellProviders } from './providers.js';
export type { ShellProvider, ShellProviderProps } from './providers.js';
