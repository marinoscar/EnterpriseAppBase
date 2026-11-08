import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { readTuiSelection, resolveConfig, saveTuiSelection, type ConfigContext } from '../config.js';
import { validateToken } from '../device-login.js';
import {
  listTuiSelections,
  listTuiStateLoaders,
  type TuiLoaderContext,
  type TuiSelectionRegistration,
  type TuiStateLoaderRegistration,
} from './app-registry.js';
import { resolveTuiTheme, type TuiTheme } from './theme.js';

// =============================================================================
// The shared TUI app context  (RETRO-G1.2, #1066)
// =============================================================================
//
// Before this, a screen received `{ onDone }` and nothing else: each one
// re-read the config itself, colours were inline, and "back" meant "the menu".
// `useTuiApp()` is the one place a screen reads the session, the app's
// selection, shared app data, the theme and the navigation stack.
//
// This module imports React but NOT ink: the provider is plain state, the
// frame header chip lives in layout.tsx, and the hooks are importable from
// `@marinoscar/platform-cli/tui` without loading the renderer.
//
// THE TOKEN IS NEVER IN THIS CONTEXT. The session carries `loggedIn` and the
// server URL; the one place the stored token is read (the identity lookup) is a
// local that goes into a request and nowhere else, as in screens/status.tsx.
// =============================================================================

/**
 * A frame of the navigation stack.
 *
 * @stability experimental
 */
export type TuiNavFrame = TuiMenuFrame | TuiScreenFrame;

/**
 * The menu frame, the root of the stack.
 *
 * @stability experimental
 */
export interface TuiMenuFrame {
  /** Discriminant. */
  readonly kind: 'menu';
  /** The menu section to open at, once the menu tree has sections. */
  readonly sectionId?: string | undefined;
}

/**
 * A screen frame.
 *
 * @stability experimental
 */
export interface TuiScreenFrame {
  /** Discriminant. */
  readonly kind: 'screen';
  /** The registered route id. */
  readonly route: string;
  /** What the opener passed to `nav.push`. */
  readonly params?: unknown;
}

/**
 * The signed-in user as the server described them.
 *
 * @stability experimental
 */
export interface TuiSessionIdentity {
  /** The account's email address. */
  email?: string | undefined;
  /** The display name, when the account has one. */
  displayName?: string | undefined;
}

/**
 * The stored login state.
 *
 * @stability experimental
 */
export interface TuiStoredSession {
  /** Whether a token and a server are stored. */
  loggedIn: boolean;
  /** The configured server, if any. */
  serverUrl?: string | undefined;
}

/**
 * Navigation. Only the top frame is mounted, so leaving a screen unmounts it
 * and runs its effect cleanups; coming back mounts it afresh with the same
 * `params`.
 *
 * @stability experimental
 */
export interface TuiNav {
  /** Opens a registered screen on top of the current one. */
  push(route: string, params?: unknown): void;
  /** Returns to the previous frame; on the menu (the root) it does nothing. */
  pop(): void;
  /** Clears the stack back to the menu, optionally at a menu section. */
  toMenu(sectionId?: string): void;
  /** The top frame, the only one mounted. */
  readonly current: TuiNavFrame;
  /** The stack's size: 1 on the menu. */
  readonly depth: number;
}

/**
 * Who is signed in, as far as the TUI knows. Never carries the token.
 *
 * @stability experimental
 */
export interface TuiSession {
  /** Whether a token is stored. */
  readonly loggedIn: boolean;
  /** The configured server, as the user typed it. */
  readonly serverUrl?: string | undefined;
  /** The signed-in user, once the server has answered `GET /auth/me`; absent offline or logged out. */
  readonly identity?: TuiSessionIdentity | undefined;
  /**
   * Re-reads the stored config and the identity, then re-runs every state
   * loader and selection loader. Call it after a login or a logout.
   */
  refresh(): Promise<void>;
}

/**
 * One registered selection, as a screen sees it.
 *
 * @typeParam T - The selectable item.
 * @stability experimental
 */
export interface TuiSelectionState<T = unknown> {
  /** The selection id. */
  readonly id: string;
  /** The chip label. */
  readonly label: string;
  /** The loaded choices; empty until loaded. */
  readonly items: readonly T[];
  /** The chosen item, if any. After a load: the persisted or previous choice, else the first item. */
  readonly current: T | undefined;
  /** The chip text for `current`. */
  readonly text: string | undefined;
  /** True while the choices load. */
  readonly loading: boolean;
  /** Why the load failed, if it did. */
  readonly error: string | undefined;
  /** Chooses an item and, for `persist: 'config'`, stores its key. */
  select(item: T): void;
}

/**
 * Everything a TUI screen can read.
 *
 * @stability experimental
 */
export interface TuiAppContext {
  /** The signed-in session. */
  readonly session: TuiSession;
  /** The navigation stack. */
  readonly nav: TuiNav;
  /** The app's registered selections by id. Empty when none is registered. */
  readonly selection: Readonly<Record<string, TuiSelectionState>>;
  /** Colour tokens and glyphs; colourless under `NO_COLOR` / `--no-color`. */
  readonly theme: TuiTheme;
  /** The app's registered state loaders' values by id; absent until loaded or after a failure. */
  readonly appState: Readonly<Record<string, unknown>>;
  /** Why a state loader failed, by id. */
  readonly appStateErrors: Readonly<Record<string, string>>;
}

const AppContext = createContext<TuiAppContext | undefined>(undefined);

/**
 * The app context, or `undefined` outside a {@link TuiAppProvider}. For
 * chrome that must also render in a bare test.
 *
 * @returns The context, if any.
 * @stability experimental
 */
export function useOptionalTuiApp(): TuiAppContext | undefined {
  return useContext(AppContext);
}

/**
 * The app context: session, navigation, selections, theme and shared state.
 *
 * @returns The context.
 * @throws Error when called outside a {@link TuiAppProvider} (the TUI app root mounts one).
 * @stability experimental
 * @example
 * ```tsx
 * function ProjectScreen(): ReactNode {
 *   const { session, nav, theme } = useTuiApp();
 *   return <Text color={theme.primary}>{session.serverUrl} <Text dimColor>esc: {nav.depth}</Text></Text>;
 * }
 * ```
 */
export function useTuiApp(): TuiAppContext {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useTuiApp() was called outside a TuiAppProvider; the TUI app root provides one.');
  }
  return context;
}

/**
 * The theme: the context's inside the TUI, the resolved default outside it.
 *
 * @returns The theme.
 * @stability experimental
 */
export function useTuiTheme(): TuiTheme {
  const context = useContext(AppContext);
  const fallback = useMemo(() => resolveTuiTheme(), []);
  return context?.theme ?? fallback;
}

/**
 * A registered selection.
 *
 * @typeParam T - The selectable item.
 * @param id - The id given to `registerTuiSelection`.
 * @returns Its choices, current item, chip text and `select`.
 * @throws Error when no selection has that id, or outside a provider.
 * @stability experimental
 */
export function useTuiSelection<T = unknown>(id: string): TuiSelectionState<T> {
  const state = useTuiApp().selection[id];
  if (state === undefined) throw new Error(`No TUI selection "${id}" is registered (registerTuiSelection).`);
  return state as TuiSelectionState<T>;
}

/**
 * A value loaded by a registered state loader.
 *
 * @typeParam T - The loaded value.
 * @param id - The id given to `registerTuiStateLoader`.
 * @returns The value, or `undefined` while loading or after a failed load.
 * @stability experimental
 */
export function useTuiState<T = unknown>(id: string): T | undefined {
  return useTuiApp().appState[id] as T | undefined;
}

// -----------------------------------------------------------------------------
// The provider
// -----------------------------------------------------------------------------

/**
 * What {@link TuiAppProvider} reads from the outside world; each defaults to
 * the real CLI config, and a test supplies its own.
 *
 * @stability experimental
 */
export interface TuiAppProviderProps {
  /** The tree that reads the context. */
  children: ReactNode;
  /** Reads the stored login state. Defaults to the CLI config (`resolveConfig`). */
  readSession?: (() => TuiStoredSession) | undefined;
  /** Asks the server who is signed in. Defaults to `GET /auth/me` with the stored token. Return `undefined` when unknown. */
  loadIdentity?: ((serverUrl: string, signal: AbortSignal) => Promise<TuiSessionIdentity | undefined>) | undefined;
  /** Replaces the resolved theme. */
  theme?: TuiTheme | undefined;
  /** Config location seam for persisted selections. */
  configContext?: ConfigContext | undefined;
  /** Replaces the registered selections (a test seam). */
  selections?: readonly TuiSelectionRegistration[] | undefined;
  /** Replaces the registered state loaders (a test seam). */
  stateLoaders?: readonly TuiStateLoaderRegistration[] | undefined;
  /** The stack to start with. Defaults to the menu. */
  initialStack?: readonly TuiNavFrame[] | undefined;
}

const MENU_FRAME: TuiNavFrame = Object.freeze({ kind: 'menu' as const });

function defaultReadSession(): TuiStoredSession {
  try {
    const config = resolveConfig();
    return { loggedIn: config.token !== undefined && config.serverUrl !== undefined, serverUrl: config.serverUrl };
  } catch {
    // A corrupt config must not take the TUI down (see screens/menu.tsx).
    return { loggedIn: false };
  }
}

async function defaultLoadIdentity(serverUrl: string, signal: AbortSignal): Promise<TuiSessionIdentity | undefined> {
  // The token is read here, bound to a local, and goes into the request only.
  const token = resolveConfig().token;
  if (token === undefined) return undefined;
  const user = await validateToken(serverUrl, token, { signal });
  return {
    email: user.email,
    ...(user.displayName === null ? {} : { displayName: user.displayName }),
  };
}

interface SelectionSlot {
  items: readonly unknown[];
  currentKey: string | undefined;
  loading: boolean;
  error: string | undefined;
}

function keyOf(registration: TuiSelectionRegistration, item: unknown): string {
  return (registration.keyOf ?? registration.display)(item);
}

/**
 * Provides {@link TuiAppContext} to the TUI. The app root mounts it.
 *
 * Loads once on mount: the session, the identity (best effort), every state
 * loader and every selection; `session.refresh()` repeats all of it.
 *
 * @param props - Children and, for tests, the seams.
 * @stability experimental
 */
export function TuiAppProvider(props: TuiAppProviderProps): ReactNode {
  const readSession = props.readSession ?? defaultReadSession;
  const loadIdentity = props.loadIdentity ?? defaultLoadIdentity;

  const [stack, setStack] = useState<readonly TuiNavFrame[]>(() =>
    props.initialStack !== undefined && props.initialStack.length > 0 ? props.initialStack : [MENU_FRAME],
  );
  const [base, setBase] = useState(readSession);
  const [identity, setIdentity] = useState<TuiSessionIdentity | undefined>(undefined);
  const [version, setVersion] = useState(0);
  const [slots, setSlots] = useState<Readonly<Record<string, SelectionSlot>>>({});
  const [appState, setAppState] = useState<Readonly<Record<string, unknown>>>({});
  const [appStateErrors, setAppStateErrors] = useState<Readonly<Record<string, string>>>({});

  const registrations = useMemo(() => props.selections ?? listTuiSelections(), [props.selections]);
  const loaders = useMemo(() => props.stateLoaders ?? listTuiStateLoaders(), [props.stateLoaders]);

  // Latest values for the async loaders, so an effect keyed on `version` does
  // not restart when an unrelated render changes them.
  const latest = useRef({ base, registrations, loaders, readSession, loadIdentity });
  latest.current = { base, registrations, loaders, readSession, loadIdentity };

  const selectionKeys = useRef<Record<string, string | undefined>>({});

  // Identity: best effort, aborted on unmount or refresh, and never an error
  // the user sees (the status screen is where a dead token is reported).
  useEffect(() => {
    setIdentity(undefined);
    if (!base.loggedIn || base.serverUrl === undefined) return;
    const controller = new AbortController();
    void latest.current
      .loadIdentity(base.serverUrl, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setIdentity(value);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [base.loggedIn, base.serverUrl, version]);

  // State loaders and selections: once on mount, again after a refresh.
  useEffect(() => {
    const controller = new AbortController();
    const { base: session, registrations: selectionRegs, loaders: stateRegs } = latest.current;
    const context: TuiLoaderContext = { loggedIn: session.loggedIn, serverUrl: session.serverUrl, signal: controller.signal };

    for (const registration of stateRegs) {
      void (async () => {
        try {
          const value = await registration.load(context);
          if (controller.signal.aborted) return;
          setAppState((previous) => ({ ...previous, [registration.id]: value }));
          setAppStateErrors((previous) => omit(previous, registration.id));
        } catch (error) {
          if (controller.signal.aborted) return;
          setAppStateErrors((previous) => ({ ...previous, [registration.id]: messageOf(error) }));
        }
      })();
    }

    for (const registration of selectionRegs) {
      setSlots((previous) => ({
        ...previous,
        [registration.id]: { items: previous[registration.id]?.items ?? [], currentKey: selectionKeys.current[registration.id], loading: true, error: undefined },
      }));
      void (async () => {
        try {
          const items = await registration.load(context);
          if (controller.signal.aborted) return;
          // Previous choice, else the persisted one, else the first item.
          const wanted =
            selectionKeys.current[registration.id] ??
            (registration.persist === 'config' ? readTuiSelection(registration.id, props.configContext) : undefined);
          const chosen = items.find((item) => keyOf(registration, item) === wanted) ?? items[0];
          const currentKey = chosen === undefined ? undefined : keyOf(registration, chosen);
          selectionKeys.current[registration.id] = currentKey;
          setSlots((previous) => ({ ...previous, [registration.id]: { items, currentKey, loading: false, error: undefined } }));
        } catch (error) {
          if (controller.signal.aborted) return;
          setSlots((previous) => ({
            ...previous,
            [registration.id]: { items: previous[registration.id]?.items ?? [], currentKey: selectionKeys.current[registration.id], loading: false, error: messageOf(error) },
          }));
        }
      })();
    }

    return () => controller.abort();
    // `version` is the only trigger; everything else is read through `latest`.
  }, [version]);

  const refresh = useCallback(async (): Promise<void> => {
    setBase(latest.current.readSession());
    setVersion((value) => value + 1);
  }, []);

  const nav = useMemo<TuiNav>(() => {
    const current = stack[stack.length - 1] ?? MENU_FRAME;
    return {
      push: (route, params) => setStack((frames) => [...frames, { kind: 'screen', route, params }]),
      pop: () => setStack((frames) => (frames.length > 1 ? frames.slice(0, -1) : frames)),
      toMenu: (sectionId) => setStack([sectionId === undefined ? MENU_FRAME : { kind: 'menu', sectionId }]),
      current,
      depth: stack.length,
    };
  }, [stack]);

  const session = useMemo<TuiSession>(
    () => ({ loggedIn: base.loggedIn, serverUrl: base.serverUrl, identity, refresh }),
    [base, identity, refresh],
  );

  const theme = useMemo(() => props.theme ?? resolveTuiTheme(), [props.theme]);

  const selection = useMemo(() => {
    const out: Record<string, TuiSelectionState> = {};
    for (const registration of registrations) {
      const slot = slots[registration.id];
      const items = slot?.items ?? [];
      const current = slot?.currentKey === undefined ? undefined : items.find((item) => keyOf(registration, item) === slot.currentKey);
      out[registration.id] = {
        id: registration.id,
        label: registration.label,
        items,
        current,
        text: current === undefined ? undefined : registration.display(current),
        loading: slot?.loading ?? true,
        error: slot?.error,
        select: (item) => {
          const key = keyOf(registration, item);
          selectionKeys.current[registration.id] = key;
          setSlots((previous) => ({
            ...previous,
            [registration.id]: { items: previous[registration.id]?.items ?? [], currentKey: key, loading: false, error: undefined },
          }));
          if (registration.persist === 'config') {
            try {
              saveTuiSelection(registration.id, key, props.configContext);
            } catch {
              // A selection is a convenience: an unwritable config keeps it for this run only.
            }
          }
        },
      };
    }
    return out;
  }, [slots, registrations]);

  const value = useMemo<TuiAppContext>(
    () => ({ session, nav, selection, theme, appState, appStateErrors }),
    [session, nav, selection, theme, appState, appStateErrors],
  );

  return <AppContext.Provider value={value}>{props.children}</AppContext.Provider>;
}

function omit(record: Readonly<Record<string, string>>, key: string): Readonly<Record<string, string>> {
  if (!(key in record)) return record;
  const { [key]: _removed, ...rest } = record;
  void _removed;
  return rest;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
