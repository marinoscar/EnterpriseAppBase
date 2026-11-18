import type { TuiStateLoaderRegistration } from '@marinoscar/platform-cli/tui';

// Data loaded ONCE for every TUI screen (RETRO-G1.2, #1066), read with
// `useTuiState<BuildInfo>('build-info')`. It runs when the TUI starts and again
// after `session.refresh()` (a login or logout); a failure is recorded under
// `appStateErrors['build-info']` and never stops the TUI.
//
// To use the pattern in a fork, add it to `APP_CLI_OPTIONS.tuiStateLoaders` in
// `app.ts`:   tuiStateLoaders: [buildInfoLoader],

/** Invented build facts. */
export interface BuildInfo {
  channel: string;
  folderCount: number;
}

/** The build-info loader. */
export const buildInfoLoader: TuiStateLoaderRegistration<BuildInfo> = {
  id: 'build-info',
  load: async ({ loggedIn }) => ({ channel: loggedIn ? 'stable' : 'offline', folderCount: 3 }),
};
