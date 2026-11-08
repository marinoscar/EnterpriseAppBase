import { Box, Text, useApp, useInput } from 'ink';
import { lazy, Suspense, useCallback, type ComponentType, type ReactNode } from 'react';

import { allTuiScreens } from './builtin-screens.js';
import { TuiAppProvider, useTuiApp, type TuiAppProviderProps } from './context.js';
import { useTerminalSize } from './layout.js';
import { textColor } from './theme.js';
import type { TuiScreenProps, TuiScreenRegistration } from './screen-registry.js';
import { listTuiMenuNodes } from './menu-registry.js';
import { buildTuiMenuTree, tuiMenuItemLabel, tuiRouteRequiresLogin } from './menu-tree.js';
import { MenuScreen } from './screens/menu.js';
import { NotLoggedIn } from './screens/not-logged-in.js';

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
// THE STACK (RETRO-G1.2). Navigation is a stack of frames held by the app
// context (context.tsx): the menu is the root, `nav.push(route, params)` opens a
// screen on top, and `onDone` is `nav.pop()`. A screen opened from the menu
// therefore still goes back to the menu, exactly as before, while a screen can
// now open a sub-screen and return to it. Only the TOP frame is mounted; a
// frame below it is not rendered at all, so it receives no keys and its
// effects are cleaned up. Coming back remounts it with the same `params`.
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

/**
 * The app root: the context provider around the router.
 *
 * @param props - The provider's seams (tests only).
 */
export function App(props: Omit<TuiAppProviderProps, 'children'> = {}): ReactNode {
  return (
    <TuiAppProvider {...props}>
      <Router />
    </TuiAppProvider>
  );
}

/** Renders the top frame of the navigation stack and nothing else. */
export function Router(): ReactNode {
  const { nav, theme, session } = useTuiApp();
  const { columns } = useTerminalSize();
  const { exit } = useApp();

  const pop = useCallback(() => {
    nav.pop();
  }, [nav]);

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
  useInput((_input, key) => {
    // A frame pushed with a route nobody registered has no screen to handle
    // Esc, so the router does; every real screen binds its own.
    if (key.escape && nav.current.kind === 'screen' && !allTuiScreens().some((screen) => screen.route === (nav.current as { route: string }).route)) {
      nav.pop();
    }
    /* Present so the app holds stdin in raw mode even on a screen with no
       bindings of its own; without a mounted handler ink would release it and
       the first keypress after a screen transition could be echoed to the
       shell instead. */
  });

  if (columns < UNRENDERABLE_COLUMNS) {
    return <Text>Terminal too narrow — widen it.</Text>;
  }

  const frame = nav.current;
  if (frame.kind === 'menu') {
    return <MenuScreen onSelect={(route) => nav.push(route)} onQuit={quit} />;
  }

  // The built-in screens and every app screen (`registerTuiScreen`, #715).
  const registration = allTuiScreens().find((screen) => screen.route === frame.route);
  const Screen = registration === undefined ? undefined : screenComponent(registration);
  if (Screen !== undefined && registration !== undefined) {
    // THE LOGIN GATE (RETRO-G1.1): one guard here for every menu entry that
    // requires a login, so no screen carries its own. Presentation only; the
    // server still authorises every call the screen makes.
    if (!session.loggedIn) {
      const tree = buildTuiMenuTree(listTuiMenuNodes(), allTuiScreens());
      if (tuiRouteRequiresLogin(frame.route, tree)) {
        const entry = tree.entries.find((candidate) => candidate.route === frame.route);
        return (
          <NotLoggedIn
            title={entry === undefined ? frame.route : tuiMenuItemLabel(entry, undefined, { loggedIn: false })}
            onLogin={() => nav.push('login')}
            onBack={pop}
          />
        );
      }
    }
    return (
      <Suspense fallback={<Text dimColor>Loading…</Text>}>
        <Screen onDone={pop} params={frame.params} />
      </Suspense>
    );
  }

  // Unreachable while the menu lists only registered routes, and present so
  // that a route without a screen is a blank frame with an explanation rather
  // than an app that renders nothing and looks hung.
  return (
    <Box>
      <Text {...textColor(theme.error)}>Unknown screen "{frame.route}". Press esc to go back, or ctrl-c to exit.</Text>
    </Box>
  );
}

/** One lazy component per `load` screen, so reopening it does not reload it. */
const lazyScreens = new Map<string, ComponentType<TuiScreenProps>>();

function screenComponent(screen: TuiScreenRegistration): ComponentType<TuiScreenProps> | undefined {
  if (screen.component !== undefined) return screen.component;
  const load = screen.load;
  if (load === undefined) return undefined;
  let component = lazyScreens.get(screen.route);
  if (component === undefined) {
    component = lazy(async () => ({ default: await load() }));
    lazyScreens.set(screen.route, component);
  }
  return component;
}
