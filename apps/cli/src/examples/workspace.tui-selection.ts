import type { TuiSelectionRegistration } from '@marinoscar/platform-cli/tui';

// A selection shown as a chip in the TUI header (RETRO-G1.2, #1066). The
// "active workspace" is invented: an app picks whatever it works inside of
// (a project, a tenant, a circle). `persist: 'config'` keeps the choice under
// `tui.selection.workspace` in the CLI config file, so the next run restores it.
//
// To use the pattern in a fork, add it to `APP_CLI_OPTIONS.tuiSelections` in
// `app.ts`:   tuiSelections: [workspaceSelection],
// and read it in a screen with `useTuiSelection<Workspace>('workspace')`.

/** An invented workspace. */
export interface Workspace {
  id: string;
  name: string;
}

/** The Workspace selection. */
export const workspaceSelection: TuiSelectionRegistration<Workspace> = {
  id: 'workspace',
  label: 'Workspace',
  persist: 'config',
  load: async () => [
    { id: 'ws-alpha', name: 'Workspace Alpha' },
    { id: 'ws-beta', name: 'Workspace Beta' },
  ],
  display: (workspace) => workspace.name,
  keyOf: (workspace) => workspace.id,
};
