import { Box, Text, useApp, useInput } from 'ink';
import { useCallback, useState, type ReactNode } from 'react';

import { allTuiScreens } from './builtin-screens.js';
import { useTerminalSize } from './layout.js';
import { MENU_ROUTE, type Route } from './routes.js';
import { MenuScreen } from './screens/menu.js';

// =============================================================================
// The app root  (issue #145, epic #110)
// =============================================================================
//
// Routing and nothing else. Each screen is mounted only while it is the current
// route, which is not merely a rendering detail — it is what keeps the keyboard
// unambiguous. Every screen registers its own `useInput`, and ink delivers each
// keystroke to EVERY mounted handler; screens kept alive off-screen would go on
// consuming keys, so `n` on the invoke screen would also fire the menu's
// shortcut. Conditional mounting means exactly one handler exists per key.
//
// It also means leaving a screen unmounts it, which is what fires the effect
// cleanups that abort in-flight requests and poll loops. That is the difference
// between pressing Esc during a login and the process quietly continuing to
// poll for the remaining fourteen minutes.
//
// THERE IS NO ROUTE HISTORY. Every screen returns to the menu and nowhere else,
// so "back" has one meaning everywhere and Esc never lands somewhere a user has
// to work out.
// =============================================================================

/**
 * Below this many columns, ink cannot lay anything out usefully.
 *
 * Ten is not a design decision, it is yoga's floor: a flex container narrower
 * than its own content collapses, and every `<Box>` in the tree starts
 * competing for columns that do not exist. Rather than render a smear, the app
 * says so in one line and waits — a RESIZE re-renders this component, so
 * widening the terminal brings the UI back with no keypress and no restart.
 * #145 asks for degrade, not crash; this is the last rung of the ladder that
 * starts in `Frame`.
 */
const UNRENDERABLE_COLUMNS = 10;

export function App(): ReactNode {
  const [route, setRoute] = useState<Route>(MENU_ROUTE);
  const { columns } = useTerminalSize();
  const { exit } = useApp();

  const toMenu = useCallback(() => {
    setRoute(MENU_ROUTE);
  }, []);

  // `useApp().exit()` is the ONLY way out, and it is the same path Ctrl-C
  // takes. It performs a real React unmount — every screen's effect cleanup
  // runs, aborting an in-flight poll loop or request — and then resolves the
  // promise `startTui` is awaiting, which is what lets the process end with a
  // restored terminal instead of a cleared frame over a live event loop.
  // Anything else (an `onExit` callback the host wires to `unmount()`, a
  // `process.exit`) either skips the cleanups or truncates ink's final write.
  const quit = useCallback(() => {
    exit();
  }, [exit]);

  // Ctrl-C is handled by ink itself (`exitOnCtrlC`, on by default): in raw mode
  // the terminal does NOT generate SIGINT, so the ^C arrives as a byte and ink
  // unmounts on it, running every screen's cleanup on the way out. It is not
  // intercepted here — a handler that swallowed it would make the app
  // unkillable from the keyboard, which is the worst thing a full-screen
  // program can be.
  useInput(() => {
    /* Present so the app holds stdin in raw mode even on a screen with no
       bindings of its own; without a mounted handler ink would release it and
       the first keypress after a screen transition could be echoed to the
       shell instead. */
  });

  if (columns < UNRENDERABLE_COLUMNS) {
    return <Text>Terminal too narrow — widen it.</Text>;
  }

  if (route === MENU_ROUTE) return <MenuScreen onSelect={setRoute} onQuit={quit} />;

  // The built-in screens and every app screen (`registerTuiScreen`, #715).
  const Screen = allTuiScreens().find((screen) => screen.route === route)?.component;
  if (Screen !== undefined) return <Screen onDone={toMenu} />;

  // Unreachable while the menu lists only registered routes, and present so
  // that a route without a screen is a blank frame with an explanation rather
  // than an app that renders nothing and looks hung.
  return (
    <Box>
      <Text color="red">Unknown screen. Press ctrl-c to exit.</Text>
    </Box>
  );
}
