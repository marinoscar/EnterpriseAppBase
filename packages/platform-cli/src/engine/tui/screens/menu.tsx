import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { useMemo, type ReactNode } from 'react';

import { cliName } from '../../identity.js';
import { describeConfig, type ConfigSummary } from '../../config.js';
import { allTuiScreens } from '../builtin-screens.js';
import { Frame } from '../layout.js';
import type { Route } from '../routes.js';
import type { TuiMenuContext, TuiScreenRegistration } from '../screen-registry.js';

// =============================================================================
// The menu  (issue #145, epic #110)
// =============================================================================
//
// The list #145 specifies: Login, Call an endpoint, Status, Logout, Quit,
// plus Worker node and Deploy since; and since #715 every screen an app
// registers (`registerTuiScreen`), sorted by `order` then route id, with Quit
// always last.
//
// It is rebuilt on every mount rather than held as a module constant, because
// two of the five entries change with the login state — "Logout" is meaningless
// when nothing is stored, and "Call an endpoint" cannot work without a
// credential. They are DISABLED-BY-ANNOTATION rather than removed: a menu whose
// entries appear and disappear teaches the user nothing about why, whereas a
// greyed "(not logged in)" answers the question on the spot. Selecting one
// still navigates — the destination screen produces the real, specific error
// from `requireCredentials()`, which is better written than anything this
// screen could say.
// =============================================================================

export interface MenuScreenProps {
  onSelect: (route: Route) => void;
  onQuit: () => void;
}

/** One entry of the menu list. */
export interface MenuItem {
  /** `key` is what `ink-select-input` uses for reconciliation; label is display. */
  key: string;
  label: string;
  value: Route | 'quit';
}

/**
 * The menu list for a set of screens: each screen's label for the login
 * state, in the order given, then Quit. Pure, so the order is testable
 * without rendering.
 */
export function buildMenuItems(screens: readonly TuiScreenRegistration[], context: TuiMenuContext): MenuItem[] {
  return [
    ...screens.map((screen) => ({
      key: screen.route,
      label: typeof screen.label === 'function' ? screen.label(context) : screen.label,
      value: screen.route,
    })),
    { key: 'quit', label: 'Quit', value: 'quit' },
  ];
}

export function MenuScreen({ onSelect, onQuit }: MenuScreenProps): ReactNode {
  // Read ONCE per mount, not on every render. `describeConfig` hits the
  // filesystem, and the menu re-renders on every arrow keypress — re-reading
  // the config file ten times a second to decide whether to print "(not logged
  // in)" is a syscall storm for a label. Returning to the menu after a login or
  // a logout remounts this component, which is exactly when the value is stale.
  const summary = useMemo<ConfigSummary>(() => safeDescribeConfig(), []);
  const loggedIn = summary.tokenSource !== undefined;

  const items = useMemo<MenuItem[]>(() => buildMenuItems(allTuiScreens(), { loggedIn }), [loggedIn]);

  // `q` and Esc, in addition to the Quit entry. Safe on THIS screen and only
  // this screen: every other screen has a text field, where a bare `q` is a
  // character the user meant to type. That is why the shortcut lives here
  // rather than in the app root — a global handler would eat the `q` out of
  // `/api/query` on the invoke screen, and the bug would look like a broken
  // keyboard.
  useInput((input, key) => {
    if (input === 'q' || key.escape) onQuit();
  });

  return (
    <Frame
      title="Menu"
      hints={['↑↓ move', 'enter select', 'q quit', 'ctrl-c exit']}
    >
      <Box flexDirection="column" gap={1}>
        <Text dimColor>
          {summary.serverUrl === undefined
            ? `No server configured yet — start with Login, or run \`${cliName()} --help\`.`
            : `Server: ${summary.serverUrl}`}
        </Text>

        <SelectInput
          items={items}
          onSelect={(item) => {
            if (item.value === 'quit') {
              onQuit();
              return;
            }
            onSelect(item.value);
          }}
        />
      </Box>
    </Frame>
  );
}

/**
 * `describeConfig` can throw: a corrupt or unreadable `config.json` raises
 * ConfigError (see config.ts), and it would do so from inside a render.
 *
 * A throw during render unmounts the whole ink tree and takes the menu down
 * with it — so a hand-edited config file would make the CLI's interactive mode
 * impossible to open, including the Logout entry that is the way to clear the
 * bad file. Degrading to "nothing configured" keeps every route reachable, and
 * the Status screen reports the real error in the one place a user goes to
 * look for it.
 */
function safeDescribeConfig(): ConfigSummary {
  try {
    return describeConfig();
  } catch {
    return {
      serverUrl: undefined,
      serverUrlSource: undefined,
      tokenHint: '(none)',
      tokenSource: undefined,
      tokenName: undefined,
      tokenId: undefined,
      expiresAt: undefined,
      expired: undefined,
      updatedAt: undefined,
      path: '',
      fileExists: false,
    };
  }
}
