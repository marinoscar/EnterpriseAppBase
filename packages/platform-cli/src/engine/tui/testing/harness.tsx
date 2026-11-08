import { Text } from 'ink';
import { render, cleanup } from 'ink-testing-library';
import { Component, type ComponentType, type ErrorInfo, type ReactElement, type ReactNode } from 'react';

import { Router } from '../app.js';
import {
  TuiAppProvider,
  useTuiApp,
  type TuiAppContext,
  type TuiNavFrame,
  type TuiSessionIdentity,
} from '../context.js';
import { listTuiMenuNodes } from '../menu-registry.js';
import {
  buildTuiMenuTree,
  tuiBreadcrumb,
  tuiMenuItemLabel,
  visibleTuiMenuChildren,
  type TuiMenuScreenInfo,
} from '../menu-tree.js';
import { MenuScreen } from '../screens/menu.js';
import type { TuiMenuNode, TuiMenuSlots } from '../menu-registry.js';
import type { TuiScreenProps } from '../screen-registry.js';
import { resolveTuiTheme, type TuiTheme } from '../theme.js';

// =============================================================================
// The TUI testing kit  (RETRO-G1.5, #1069)
// =============================================================================
//
// One harness for an app's screens, instead of every test file wiring its own
// providers, fake stdout and key-press helper. It sits on `ink-testing-library`
// (an OPTIONAL peer of the package: only a test imports this file).
//
// THE HARNESS NEVER READS A REAL CLI CONFIG OR TOKEN. It always passes the
// provider an in-memory session, no identity lookup over the network, and empty
// selection and state-loader lists unless the test asks for specific values
// (`selection`, `appState`) or for the registered ones (`useRegistered`).
// =============================================================================

export { cleanup };

/** The bytes a terminal sends for the key names `press` understands (any other string is sent as typed). */
const TUI_TEST_KEYS: Readonly<Record<string, string>> = {
  esc: '\u001B',
  enter: '\r',
  up: '\u001B[A',
  down: '\u001B[B',
  right: '\u001B[C',
  left: '\u001B[D',
  tab: '\t',
  space: ' ',
  backspace: '\u007F',
  'ctrl-c': '\u0003',
};

/** The default width of ink-testing-library's fake terminal. */
const DEFAULT_COLUMNS = 100;

/**
 * Strips ANSI colour sequences.
 *
 * @param value - Text that may carry colour escapes.
 * @returns The text without them.
 * @stability experimental
 */
export function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, '');
}

/**
 * True when the text contains an ANSI colour sequence.
 *
 * @param value - The text.
 * @returns Whether it carries a colour escape.
 * @stability experimental
 */
export function hasAnsi(value: string): boolean {
  return /\u001B\[[0-9;]*m/.test(value);
}

/**
 * The lines of a frame, ANSI stripped, trailing blank lines dropped.
 *
 * @param frame - A frame (`lastFrame()`).
 * @returns Its lines.
 * @stability experimental
 */
export function frameLines(frame: string | undefined): string[] {
  const lines = stripAnsi(frame ?? '').split('\n');
  while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() === '') lines.pop();
  return lines;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The login state a test renders under. Never carries a token.
 *
 * @stability experimental
 */
export interface TuiTestSession {
  /** Default true for a screen, and for a route (so a gate test sets `false`). */
  loggedIn?: boolean | undefined;
  /** Default `https://app.example.test`. */
  serverUrl?: string | undefined;
  /** The identity `GET /auth/me` would return; default none. */
  identity?: TuiSessionIdentity | undefined;
}

/**
 * What every render function takes.
 *
 * @stability experimental
 */
export interface TuiRenderOptions {
  /** The login state. */
  session?: TuiTestSession | undefined;
  /** Selections by id: the items a selection loads; the first is current. */
  selection?: Readonly<Record<string, readonly unknown[]>> | undefined;
  /** State loader values by id (what `useTuiState(id)` returns). */
  appState?: Readonly<Record<string, unknown>> | undefined;
  /** A theme, or `'mono'` for the colourless theme (as under `NO_COLOR`). Default the colour theme. */
  theme?: TuiTheme | 'mono' | undefined;
  /** The fake terminal's width. Default 100 (ink-testing-library's own). */
  columns?: number | undefined;
  /**
   * Use the registered selections and state loaders (`registerTuiSelection`,
   * `registerTuiStateLoader`) instead of the empty lists. They may reach the
   * network; give them a fake in the test.
   */
  useRegistered?: boolean | undefined;
  /** How long `press` and `type` wait for ink to react. Default 40 ms. */
  settleMs?: number | undefined;
}

/**
 * Options of {@link renderTuiScreen}.
 *
 * @stability experimental
 */
export interface RenderTuiScreenOptions extends TuiRenderOptions {
  /** What the opener would pass to `nav.push`; the screen's `params`. */
  params?: unknown;
  /**
   * Components for routes the screen under test pushes (`nav.push('detail')`).
   * An unknown route renders a one-line marker instead of failing the render.
   */
  screens?: Readonly<Record<string, ComponentType<TuiScreenProps>>> | undefined;
}

/**
 * The fake terminal's input.
 *
 * @stability experimental
 */
export interface TuiTestStdin {
  /** Writes raw bytes, as the terminal would send them. */
  write: (data: string) => void;
}

/**
 * What a test can observe of navigation.
 *
 * @stability experimental
 */
export interface TuiTestNav {
  /** The stack, bottom first: the menu, then each screen opened. */
  readonly stack: readonly TuiNavFrame[];
}

/**
 * What a render returns.
 *
 * @stability experimental
 */
export interface TuiTestHandle {
  /** The latest frame as ink wrote it (may carry ANSI colour). */
  lastFrame: () => string | undefined;
  /** Every frame so far, as ink wrote them. */
  frames: string[];
  /** Raw stdin of the fake terminal. */
  stdin: TuiTestStdin;
  /** Sends a key (`'esc'`, `'enter'`, `'up'`, `'down'`, `'left'`, `'right'`, `'tab'`, `'space'`, `'backspace'`, `'ctrl-c'`, a digit or any character) and lets ink react. */
  press: (key: string) => Promise<void>;
  /** Types text as if pasted, then lets ink react. */
  type: (text: string) => Promise<void>;
  /**
   * Resolves with the first ANSI-stripped frame the predicate accepts; polls
   * the latest frame every 10 ms.
   *
   * @throws Error naming the last frame when `timeoutMs` (default 2000) passes.
   */
  waitForFrame: (predicate: (frame: string) => boolean, timeoutMs?: number) => Promise<string>;
  /** The navigation stack, bottom first, as far as it can be observed (the menu, then each screen opened). */
  nav: TuiTestNav;
  /** The app context as the last render saw it. */
  app: () => TuiAppContext;
  /** The message of an error the screen threw while rendering (the frame then shows `[screen crashed: ...]`), or `undefined`. */
  crashed: () => string | undefined;
  /** Resizes the fake terminal. */
  resize: (columns: number) => Promise<void>;
  /** Unmounts, running every effect cleanup. */
  unmount: () => void;
}

/**
 * The route the harness gives the component under test.
 *
 * @stability experimental
 */
export const TUI_TEST_SCREEN_ROUTE = 'screen-under-test';

const MENU_FRAME: TuiNavFrame = Object.freeze({ kind: 'menu' as const });

function resolveTheme(theme: TuiRenderOptions['theme']): TuiTheme {
  if (theme === 'mono') return resolveTuiTheme({ env: { TERM: 'xterm' }, noColor: true });
  return theme ?? resolveTuiTheme({ env: { TERM: 'xterm-256color' }, noColor: false });
}

function providerProps(options: TuiRenderOptions, loggedInDefault: boolean) {
  const session = options.session ?? {};
  const loggedIn = session.loggedIn ?? loggedInDefault;
  const serverUrl = session.serverUrl ?? 'https://app.example.test';
  const selections = Object.entries(options.selection ?? {}).map(([id, items]) => ({
    id,
    label: id,
    load: async () => items,
    display: (item: unknown) => (typeof item === 'string' ? item : JSON.stringify(item)),
  }));
  const stateLoaders = Object.entries(options.appState ?? {}).map(([id, value]) => ({ id, load: async () => value }));
  return {
    readSession: () => ({ loggedIn, serverUrl }),
    // Never the network: the identity is whatever the test says.
    loadIdentity: async () => session.identity,
    theme: resolveTheme(options.theme),
    ...(options.useRegistered === true ? {} : { selections, stateLoaders }),
  };
}

/** Observes the context and the navigation stack from inside the provider. */
class Tracker {
  context: TuiAppContext | undefined;
  /** The message of an error a screen threw while rendering, if one did. */
  crash: string | undefined;
  readonly stack: TuiNavFrame[];
  constructor(initial: readonly TuiNavFrame[]) {
    this.stack = [...initial];
  }
  observe(app: TuiAppContext): void {
    this.context = app;
    const { depth, current } = app.nav;
    // Only the top frame is visible; the stack below it is whatever was there
    // before. A push grows it, a pop shrinks it, anything else replaces the top.
    if (depth > this.stack.length) this.stack.push(current);
    else if (depth < this.stack.length) this.stack.length = depth;
    this.stack[depth - 1] = current;
  }
}

/** Catches a screen's render error, so the test can report it (ink would just clear the frame). */
class CrashBoundary extends Component<{ tracker: Tracker; children: ReactNode }, { message: string | undefined }> {
  override state = { message: undefined as string | undefined };
  static getDerivedStateFromError(error: unknown): { message: string } {
    return { message: error instanceof Error ? error.message : String(error) };
  }
  override componentDidCatch(error: unknown, _info: ErrorInfo): void {
    this.props.tracker.crash = error instanceof Error ? error.message : String(error);
  }
  override render(): ReactNode {
    return this.state.message === undefined ? this.props.children : <Text>{`[screen crashed: ${this.state.message}]`}</Text>;
  }
}

function Probe({ tracker, children }: { tracker: Tracker; children: ReactNode }): ReactNode {
  tracker.observe(useTuiApp());
  return <>{children}</>;
}

function ScreenHost({
  Screen,
  screens,
}: {
  Screen: ComponentType<TuiScreenProps>;
  screens: Readonly<Record<string, ComponentType<TuiScreenProps>>>;
}): ReactNode {
  const { nav } = useTuiApp();
  const frame = nav.current;
  if (frame.kind === 'menu') return <Text>[back at the menu]</Text>;
  const Current = frame.route === TUI_TEST_SCREEN_ROUTE ? Screen : screens[frame.route];
  if (Current === undefined) return <Text>{`[no screen registered for ${frame.route}]`}</Text>;
  return <Current onDone={nav.pop} params={frame.params} />;
}

interface MountArgs {
  element: (tracker: Tracker) => ReactElement;
  initialStack: readonly TuiNavFrame[];
  options: TuiRenderOptions;
}

async function mount({ element, initialStack, options }: MountArgs): Promise<TuiTestHandle> {
  const tracker = new Tracker(initialStack);
  const result = render(element(tracker));
  const settleMs = options.settleMs ?? 40;
  const columns = options.columns ?? DEFAULT_COLUMNS;

  // ink-testing-library's fake stdout is a fixed 100 columns wide. The kit
  // degrades by width, so shadow `columns` and emit `resize`, which both ink's
  // layout and `useTerminalSize` listen for.
  const resize = async (width: number): Promise<void> => {
    Object.defineProperty(result.stdout, 'columns', { value: width, configurable: true });
    result.stdout.emit('resize');
    await delay(30);
  };
  await resize(columns);
  await delay(settleMs);

  const keyOf = (key: string): string => (TUI_TEST_KEYS[key] ?? key);
  const latest = (): string => stripAnsi(result.lastFrame() ?? '');

  return {
    lastFrame: result.lastFrame,
    frames: result.frames,
    stdin: result.stdin,
    press: async (key) => {
      result.stdin.write(keyOf(key));
      await delay(settleMs);
    },
    type: async (text) => {
      result.stdin.write(text);
      await delay(settleMs);
    },
    waitForFrame: async (predicate, timeoutMs = 2000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const frame = latest();
        if (predicate(frame)) return frame;
        if (Date.now() >= deadline) {
          throw new Error(`waitForFrame: no frame matched within ${timeoutMs} ms. The last frame was:\n${frame}`);
        }
        await delay(10);
      }
    },
    nav: {
      get stack() {
        return [...tracker.stack];
      },
    },
    app: () => {
      if (tracker.context === undefined) throw new Error('The TUI app context has not rendered yet.');
      return tracker.context;
    },
    crashed: () => tracker.crash,
    resize,
    unmount: result.unmount,
  };
}

/**
 * Renders one screen component inside a `TuiAppProvider` in test mode.
 *
 * The screen is given `onDone` (which pops the navigation stack, as in the
 * app) and `params`. A pop below the screen shows `[back at the menu]`, and a
 * push to a route not in `screens` shows `[no screen registered for <route>]`;
 * `nav.stack` records both.
 *
 * @param Screen - The screen component.
 * @param options - Session, selection, appState, theme, columns, params.
 * @returns A handle: frames, `press`, `type`, `waitForFrame`, `nav`, `unmount`.
 * @stability experimental
 * @example
 * ```tsx
 * const screen = await renderTuiScreen(ProjectScreen, { appState: { build: { version: '1.0.0' } } });
 * await screen.press('down');
 * expect(stripAnsi(screen.lastFrame() ?? '')).toContain('Second project');
 * screen.unmount();
 * ```
 */
export async function renderTuiScreen(Screen: ComponentType<TuiScreenProps>, options: RenderTuiScreenOptions = {}): Promise<TuiTestHandle> {
  const initialStack: TuiNavFrame[] = [MENU_FRAME, { kind: 'screen', route: TUI_TEST_SCREEN_ROUTE, params: options.params }];
  const screens = options.screens ?? {};
  return mount({
    options,
    initialStack,
    element: (tracker) => (
      <TuiAppProvider {...providerProps(options, true)} initialStack={initialStack}>
        <Probe tracker={tracker}>
          <CrashBoundary tracker={tracker}>
            <ScreenHost Screen={Screen} screens={screens} />
          </CrashBoundary>
        </Probe>
      </TuiAppProvider>
    ),
  });
}

/**
 * Renders the app router at a registered route, the way the TUI would: with
 * the login gate, the lazy `load` of the screen and the real registries. For
 * testing a route as a user reaches it; use {@link renderTuiScreen} for a
 * component in isolation.
 *
 * @param route - A registered screen route (built-in or `registerTuiScreen`).
 * @param options - As {@link renderTuiScreen}; `session.loggedIn` defaults to true.
 * @returns The same handle.
 * @stability experimental
 */
export async function renderTuiRoute(route: string, options: RenderTuiScreenOptions = {}): Promise<TuiTestHandle> {
  const initialStack: TuiNavFrame[] = [MENU_FRAME, { kind: 'screen', route, params: options.params }];
  return mount({
    options,
    initialStack,
    element: (tracker) => (
      <TuiAppProvider {...providerProps(options, true)} initialStack={initialStack}>
        <Probe tracker={tracker}>
          <CrashBoundary tracker={tracker}>
            <Router />
          </CrashBoundary>
        </Probe>
      </TuiAppProvider>
    ),
  });
}

/**
 * Options of {@link renderTuiMenu}.
 *
 * @stability experimental
 */
export interface RenderTuiMenuOptions extends Omit<TuiRenderOptions, 'session'> {
  /** The menu nodes (what `registerTuiMenuNode` would have collected). Default: the registered ones. */
  nodes?: readonly TuiMenuNode[] | undefined;
  /** Every screen with its root label and order. */
  screens: readonly TuiMenuScreenInfo[];
  /** The login state. */
  loggedIn: boolean;
  /** Open at this section. Default the root. */
  section?: string | undefined;
  /** The root menu's banner and footnote. Default the ones `setTuiRootMenuSlots` set. */
  rootSlots?: TuiMenuSlots | undefined;
}

/**
 * What {@link renderTuiMenu} returns on top of the common handle.
 *
 * @stability experimental
 */
export interface TuiMenuHandle extends TuiTestHandle {
  /** The labels of the visible lines of the section on screen, decorations included (`Tools ▸`, `Reset…`). */
  labels: () => string[];
  /** The breadcrumb of the section on screen, e.g. `Home › Tools`. */
  breadcrumb: () => string;
}

/**
 * Renders the menu for a node list and a login state, to assert the visible
 * labels, the breadcrumb and navigation. Opening an entry pushes its route and
 * the frame shows a `[opened <route>]` marker (the real screens are not
 * mounted).
 *
 * @param options - Nodes, screens, login state.
 * @returns The common handle plus `labels()` and `breadcrumb()`.
 * @stability experimental
 */
export async function renderTuiMenu(options: RenderTuiMenuOptions): Promise<TuiMenuHandle> {
  const nodes = options.nodes ?? listTuiMenuNodes();
  const tree = buildTuiMenuTree(nodes, options.screens, options.rootSlots);
  const initialStack: TuiNavFrame[] = [
    options.section === undefined ? MENU_FRAME : { kind: 'menu', sectionId: options.section },
  ];
  const handle = await mount({
    options,
    initialStack,
    element: (tracker) => (
      <TuiAppProvider {...providerProps({ ...options, session: { loggedIn: options.loggedIn } }, options.loggedIn)} initialStack={initialStack}>
        <Probe tracker={tracker}>
          <MenuHost tree={tree} />
        </Probe>
      </TuiAppProvider>
    ),
  });
  const sectionId = (): string => {
    const frame = handle.app().nav.current;
    return frame.kind === 'menu' && frame.sectionId !== undefined && tree.sections.has(frame.sectionId) ? frame.sectionId : 'root';
  };
  return {
    ...handle,
    labels: () =>
      visibleTuiMenuChildren(sectionId(), { loggedIn: options.loggedIn }, tree).map((node) =>
        tuiMenuItemLabel(node, undefined, { loggedIn: options.loggedIn }),
      ),
    breadcrumb: () => tuiBreadcrumb(sectionId(), { loggedIn: options.loggedIn }, tree),
  };
}

function MenuHost({ tree }: { tree: ReturnType<typeof buildTuiMenuTree> }): ReactNode {
  const { nav } = useTuiApp();
  const frame = nav.current;
  if (frame.kind === 'screen') return <OpenedMarker route={frame.route} />;
  return <MenuScreen tree={tree} onSelect={(route) => nav.push(route)} onQuit={() => undefined} />;
}

function OpenedMarker({ route }: { route: string }): ReactNode {
  return <Text>{`[opened ${route}]`}</Text>;
}

/**
 * The latest frame of a {@link renderAt} render.
 *
 * @stability experimental
 */
export interface RenderedAt {
  /** The latest frame without trailing newline noise. */
  frame: () => string;
  /** Every line of the latest frame. */
  lines: () => string[];
  /** Unmounts. */
  unmount: () => void;
}

/**
 * Renders a bare element (no provider) at `columns` wide: for a kit component
 * that reads nothing from the app context. Monochrome is requested by setting
 * `NO_COLOR` around the first render, which is when `useTuiTheme()` resolves
 * the default theme.
 *
 * @param node - The element.
 * @param columns - The terminal width.
 * @param options - `noColor` renders as under `NO_COLOR`.
 * @returns Accessors for the latest frame.
 * @stability experimental
 */
export async function renderAt(node: ReactElement, columns: number, options: { noColor?: boolean } = {}): Promise<RenderedAt> {
  const before = process.env['NO_COLOR'];
  if (options.noColor === true) process.env['NO_COLOR'] = '1';
  else delete process.env['NO_COLOR'];
  let result: ReturnType<typeof render>;
  try {
    result = render(node);
  } finally {
    if (before === undefined) delete process.env['NO_COLOR'];
    else process.env['NO_COLOR'] = before;
  }
  Object.defineProperty(result.stdout, 'columns', { value: columns, configurable: true });
  result.stdout.emit('resize');
  await delay(30);
  const frame = (): string => result.lastFrame() ?? '';
  return { frame, lines: () => frame().split('\n'), unmount: result.unmount };
}
