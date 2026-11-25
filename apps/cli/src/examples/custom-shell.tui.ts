import type { CreateCliOptions } from '@marinoscar/platform-cli';
import type { TuiMenuSlots, TuiScreenRegistration } from '@marinoscar/platform-cli/tui';

// The hide / replace / banner example (seam #1115): an app that brings its own
// sign-in flow and does not want some of the platform's screens listed.
//
//   replaceBuiltin   the app's screen takes the built-in `login` route: the
//                    platform's Login is neither listed nor mounted, and every
//                    `nav.push('login')` (the "not logged in" notice's `[l]`)
//                    opens the app's screen instead.
//   tuiHiddenScreens keeps built-ins off the root menu. They stay routable, so
//                    a menu entry or `nav.push` still opens them, and the `tui`
//                    conformance suite does not report them.
//   tuiMenuRoot      a banner above the root menu and a one-line footnote under
//                    it. Plain text, truncated to the terminal width, coloured
//                    through the theme (none under NO_COLOR).
//
// To use the pattern in a fork, spread `customShellOptions` into
// `APP_CLI_OPTIONS` in `app.ts`.

/** The app's sign-in screen, in place of the platform's Login (reuses the About component here). */
export const appLoginScreen: TuiScreenRegistration = {
  route: 'login',
  label: ({ loggedIn }) => (loggedIn ? 'Switch account' : 'Sign in'),
  order: 10,
  replaceBuiltin: true,
  load: async () => (await import('./about.screen.js')).AboutScreen,
};

/** The root menu's banner and footnote. */
export const customShellSlots: TuiMenuSlots = {
  // Wide art at 40 columns and up; a short title on a narrow terminal.
  banner: { content: ({ columns }) => (columns >= 40 ? ['+-----------------------+', '|  Product X  console   |', '+-----------------------+'] : 'Product X') },
  // Shown only once the app's `update` state loader found a newer release.
  footnote: {
    content: ({ state }) => (state['update'] === undefined ? undefined : 'An update is available: run `appctl update`.'),
    color: 'warning',
  },
};

/** The `createCli` options of the pattern. */
export const customShellOptions: Pick<CreateCliOptions, 'tuiScreens' | 'tuiHiddenScreens' | 'tuiMenuRoot'> = {
  tuiScreens: [appLoginScreen],
  tuiHiddenScreens: ['invoke', 'jobs'],
  tuiMenuRoot: customShellSlots,
};
