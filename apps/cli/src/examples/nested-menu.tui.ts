import type { TuiMenuNode, TuiScreenRegistration } from '@marinoscar/platform-cli/tui';

// The registerTuiMenuNode example (RETRO-G1.1, #1065): a nested TUI menu.
//
// Without menu nodes the TUI lists screens flat, by `order`. A SECTION is a
// submenu (shown as `Label ▸`, with a `Home › Label` breadcrumb); an ENTRY
// opens a registered screen from inside one. A screen an entry opens leaves the
// root list, so it appears once. Both screens here reuse the About component.
//
// To use the pattern in a fork, add the screens and the nodes to
// `APP_CLI_OPTIONS` in `app.ts`:
//   tuiScreens: [...nestedMenuScreens],  tuiMenu: nestedMenuNodes,

const load = async () => (await import('./about.screen.js')).AboutScreen;

/** The screens the entries open. Their own `label` and `order` apply only if no entry opens them. */
export const nestedMenuScreens: TuiScreenRegistration[] = [
  { route: 'tools-inspect', label: 'Inspect', order: 80, load },
  { route: 'tools-reset', label: 'Reset', order: 81, load },
];

/** A "Tools" section after Logout (60), holding Inspect and a destructive Reset. */
export const nestedMenuNodes: TuiMenuNode[] = [
  { kind: 'section', id: 'tools', label: 'Tools', order: 70, subtitle: 'Local utilities (no login needed for Inspect)' },
  { kind: 'entry', id: 'tools-inspect', parent: 'tools', route: 'tools-inspect', label: 'Inspect', order: 10, loggedOut: true },
  // `ellipsis`: it opens a further input step; `color`: a theme token or colour name; `requiresLogin`: the shared notice when logged out.
  { kind: 'entry', id: 'tools-reset', parent: 'tools', route: 'tools-reset', label: 'Reset', order: 90, ellipsis: true, color: 'red', requiresLogin: true, loggedOut: true },
];
