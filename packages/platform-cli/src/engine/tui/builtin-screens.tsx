import { BUILTIN_TUI_SCREENS, listRegisteredTuiScreens, sortTuiScreens, type TuiScreenRegistration } from './screen-registry.js';
import { DeployScreen } from './screens/deploy.js';
import { InvokeScreen } from './screens/invoke.js';
import { LoginScreen } from './screens/login.js';
import { LogoutScreen } from './screens/logout.js';
import { NodeScreen } from './screens/node.js';
import { StatusScreen } from './screens/status.js';

// =============================================================================
// The platform's own TUI screens  (issue #145; registered since PP-8.9 #715)
// =============================================================================
//
// Only the ink app imports this module, so the components (and ink with them)
// load only once the TTY gate has said yes. The ids and orders come from
// `BUILTIN_TUI_SCREENS`, the list `registerTuiScreen` checks duplicates
// against.
// =============================================================================

const COMPONENTS: Record<string, TuiScreenRegistration['component']> = {
  login: LoginScreen,
  invoke: InvokeScreen,
  status: StatusScreen,
  node: NodeScreen,
  deploy: DeployScreen,
  logout: LogoutScreen,
};

const LABELS: Record<string, TuiScreenRegistration['label']> = {
  login: ({ loggedIn }) => (loggedIn ? 'Login  (replace the stored token)' : 'Login'),
  // Not removed when logged out: a greyed "(not logged in)" answers why on
  // the spot, and the screen itself produces the real, specific error.
  invoke: ({ loggedIn }) => (loggedIn ? 'Call an endpoint' : 'Call an endpoint  (not logged in)'),
  status: 'Status',
  // Not gated on being logged in either: Enroll is exactly what an
  // unconfigured machine needs, and hiding the entry would hide the fix.
  node: 'Worker node  (this machine)',
  // Not gated on being logged in: deploying acts on THIS SERVER, not on the
  // API, so a stored token is irrelevant to it.
  deploy: 'Deploy  (this server)',
  logout: ({ loggedIn }) => (loggedIn ? 'Logout' : 'Logout  (nothing stored)'),
};

/** The platform's screens, with their components, in menu order. */
export function builtinTuiScreens(): TuiScreenRegistration[] {
  return BUILTIN_TUI_SCREENS.map(({ route, order }) => {
    const component = COMPONENTS[route];
    const label = LABELS[route];
    if (component === undefined || label === undefined) {
      throw new Error(`The built-in TUI screen "${route}" has no component or label.`);
    }
    return { route, order, label, component };
  });
}

/** Every screen the menu lists: the built-ins, then the app's, sorted by order then route id. */
export function allTuiScreens(): TuiScreenRegistration[] {
  return sortTuiScreens([...builtinTuiScreens(), ...listRegisteredTuiScreens()]);
}
