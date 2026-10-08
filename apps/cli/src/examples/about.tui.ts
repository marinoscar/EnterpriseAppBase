import type { TuiScreenRegistration } from '@marinoscar/platform-cli/tui';

// The registration for the screen in `about.screen.tsx` (#715). `load` imports the
// component only when the screen is opened; registering it costs nothing on
// `appctl api ...` or `--help`. Order 70 puts it after Logout (60), before Quit.
//
// To use the pattern in a fork, add it to `APP_CLI_OPTIONS.tuiScreens` in
// `app.ts`:   tuiScreens: [aboutScreen],

/** The About screen, registered lazily. */
export const aboutScreen: TuiScreenRegistration = {
  route: 'about',
  label: 'About this app',
  order: 70,
  load: async () => (await import('./about.screen.js')).AboutScreen,
};
