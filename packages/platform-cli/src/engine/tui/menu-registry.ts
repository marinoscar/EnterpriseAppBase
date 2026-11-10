import { createCliRegistry } from '../../core/index.js';
import { BUILTIN_TUI_SCREENS, listRegisteredTuiScreens, type TuiMenuContext } from './screen-registry.js';
import type { TuiColor } from './theme.js';

// =============================================================================
// The TUI menu tree registry  (RETRO-G1.1, #1065)
// =============================================================================
//
// `registerTuiScreen` puts a screen in one flat list. A MENU NODE places things
// in a tree: a SECTION is a submenu (with a breadcrumb, a subtitle and a
// logged-out rule), an ENTRY opens a registered screen from inside a section.
// Nothing here is required: a screen that no entry references is shown at the
// root with its own label and order, exactly as before, so an app that never
// calls `registerTuiMenuNode` keeps today's menu.
//
// PURE ON PURPOSE, like screen-registry.ts: React is not imported at all, so
// registering a node from `createCli` never loads ink. References (`parent`,
// `route`) are resolved when `createCli` freezes the registries, not when a
// node is registered, so the order of registration does not matter.
// =============================================================================

/**
 * The id of the implicit root section. Reserved.
 *
 * @stability experimental
 */
export const TUI_MENU_ROOT = 'root';

/**
 * The deepest a section may nest (a section directly under the root is level 1).
 *
 * @stability experimental
 */
export const TUI_MENU_MAX_DEPTH = 4;

/**
 * A menu label: fixed, or a function of the login state.
 *
 * @stability experimental
 */
export type TuiMenuLabel = string | ((context: TuiMenuContext) => string);

/**
 * Fields both node kinds share.
 *
 * @stability experimental
 */
export interface TuiMenuNodeBase {
  /** Unique across sections and entries: lowercase `[a-z][a-z0-9-]*`; `root` is reserved. */
  id: string;
  /** The section it sits in. Default `root`. */
  parent?: string | undefined;
  /** What the menu shows; a function gets `{ loggedIn }`. */
  label: TuiMenuLabel;
  /** Position among its siblings: lower first; ties sort by id. */
  order: number;
  /**
   * Visible when logged out. Omitted means INHERITED from the nearest ancestor
   * that sets it (default false: hidden until login). An explicit `false`
   * opts one child out of an offline section.
   */
  loggedOut?: boolean | undefined;
  /** Hide the node once logged in (a "Login" entry that moves elsewhere). */
  hideWhenLoggedIn?: boolean | undefined;
  /** A theme token name (`error`, `success`, ...) or a plain colour such as `red`. Presentation only. */
  color?: TuiColor;
}

/**
 * What a menu slot's content function is given.
 *
 * @stability experimental
 */
export interface TuiMenuSlotContext {
  /** Whether a token is stored. */
  loggedIn: boolean;
  /** The terminal width, so wide header art can fall back to a short title. */
  columns: number;
  /** The section the menu shows (`root` at the top). */
  sectionId: string;
  /** What the app's state loaders loaded (`useTuiState`), by loader id; empty until they settle. */
  state: Readonly<Record<string, unknown>>;
}

/**
 * A slot's text: a line, several lines (a string may also hold `\n`), or a
 * function of {@link TuiMenuSlotContext} returning either (`undefined` or an
 * empty list draws nothing). Plain text only, so registering it never loads
 * ink and it reads the same in monochrome.
 *
 * @stability experimental
 */
export type TuiMenuSlotContent =
  | string
  | readonly string[]
  | ((context: TuiMenuSlotContext) => string | readonly string[] | undefined);

/**
 * A banner or footnote of a menu (seam #1115). Each line is truncated to the
 * terminal width rather than wrapped, so header art never smears at 40 or 24
 * columns; give a function that checks `columns` to draw something shorter.
 *
 * @stability experimental
 */
export interface TuiMenuSlot {
  /** The text. */
  content: TuiMenuSlotContent;
  /**
   * A theme token name or a plain colour, resolved like a node's `color` (no
   * colour under `NO_COLOR`). Default `banner` for a banner, `dim` for a footnote.
   */
  color?: TuiColor;
}

/**
 * The optional slots of a menu: a banner above the entries and a footnote
 * below them (header art, "update available", a support line).
 *
 * @stability experimental
 */
export interface TuiMenuSlots {
  /** Drawn at the top of the menu, above the subtitle line. */
  banner?: TuiMenuSlot | undefined;
  /** Drawn under the entries. */
  footnote?: TuiMenuSlot | undefined;
}

/**
 * A submenu.
 *
 * @stability experimental
 */
export interface TuiMenuSection extends TuiMenuNodeBase, TuiMenuSlots {
  /** Discriminant. */
  kind: 'section';
  /** Shown under the breadcrumb instead of the default hint. */
  subtitle?: string | undefined;
}

/**
 * A menu line that opens a registered screen.
 *
 * @stability experimental
 */
export interface TuiMenuEntry extends TuiMenuNodeBase {
  /** Discriminant. */
  kind: 'entry';
  /** A registered screen route (built-in or `registerTuiScreen`). */
  route: string;
  /** The screen asks for a further input step first; rendered with a trailing `…`. */
  ellipsis?: boolean | undefined;
  /**
   * Opening the screen while logged out shows the shared "not logged in"
   * notice instead. Default: true unless the entry is visible when logged out.
   */
  requiresLogin?: boolean | undefined;
}

/**
 * A node of the menu tree.
 *
 * @stability experimental
 */
export type TuiMenuNode = TuiMenuSection | TuiMenuEntry;

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

function validateSlot(where: string, name: string, slot: unknown): void {
  if (slot === undefined) return;
  const content = (slot as { content?: unknown } | null)?.content;
  const ok =
    typeof content === 'string' ||
    typeof content === 'function' ||
    (Array.isArray(content) && content.every((line) => typeof line === 'string'));
  if (typeof slot !== 'object' || slot === null || !ok) {
    throw new Error(`${where} has an invalid ${name}: pass \`{ content }\` with a string, a list of strings or a function returning one.`);
  }
}

let rootSlots: TuiMenuSlots = {};
let rootSlotsFrozenBy: string | undefined;

const registry = createCliRegistry<TuiMenuNode>({
  name: 'TUI menu node',
  registerFn: 'registerTuiMenuNode',
  idOf: (node) => node.id,
  validate: (node) => {
    const id = (node as { id?: unknown }).id;
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
      throw new Error(`TUI menu node id "${String(id)}" is invalid: use lowercase letters, digits and hyphens.`);
    }
    if (id === TUI_MENU_ROOT) {
      throw new Error(`TUI menu node id "${TUI_MENU_ROOT}" is reserved for the menu root.`);
    }
    if (node.kind !== 'section' && node.kind !== 'entry') {
      throw new Error(`TUI menu node "${id}" needs kind "section" or "entry".`);
    }
    if (typeof node.order !== 'number' || !Number.isFinite(node.order)) {
      throw new Error(`TUI menu node "${id}" needs a finite numeric order.`);
    }
    if (typeof node.label !== 'string' && typeof node.label !== 'function') {
      throw new Error(`TUI menu node "${id}" needs a label (a string or a function of the login state).`);
    }
    if (typeof node.label === 'string' && node.label.trim() === '') {
      throw new Error(`TUI menu node "${id}" needs a non-empty label.`);
    }
    if (node.parent !== undefined && (typeof node.parent !== 'string' || node.parent === '')) {
      throw new Error(`TUI menu node "${id}" has an invalid parent.`);
    }
    if (node.kind === 'entry' && (typeof node.route !== 'string' || node.route === '')) {
      throw new Error(`TUI menu entry "${id}" needs the route of a registered screen.`);
    }
    if (node.kind === 'section') {
      validateSlot(`TUI menu section "${id}"`, 'banner', node.banner);
      validateSlot(`TUI menu section "${id}"`, 'footnote', node.footnote);
    }
  },
});

/**
 * Sets the root menu's banner and footnote (seam #1115); a section takes its
 * own through `banner` and `footnote` on the node. A second call replaces the
 * first. Same as `createCli({ tuiMenuRoot })`.
 *
 * @param slots - The banner and the footnote; `{}` or `undefined` removes both.
 * @throws Error when a slot has no valid `content`, or when `createCli` has already built the CLI.
 * @stability experimental
 * @extensionPoint slot
 * @example
 * ```ts
 * setTuiRootMenuSlots({
 *   banner: { content: ({ columns }) => (columns >= 40 ? ['╔═╗ Product X', '╚═╝ control panel'] : 'Product X') },
 *   footnote: { content: ({ state }) => (state['update'] === undefined ? undefined : 'An update is available.'), color: 'warning' },
 * });
 * ```
 */
export function setTuiRootMenuSlots(slots: TuiMenuSlots | undefined): void {
  if (rootSlotsFrozenBy !== undefined) {
    throw new Error(`The TUI root menu slots were set after ${rootSlotsFrozenBy}; set them before (or pass tuiMenuRoot to createCli).`);
  }
  validateSlot('The TUI root menu', 'banner', slots?.banner);
  validateSlot('The TUI root menu', 'footnote', slots?.footnote);
  rootSlots = Object.freeze({ ...(slots ?? {}) });
}

/**
 * The root menu's slots set with {@link setTuiRootMenuSlots}.
 *
 * @returns The slots (`{}` when none are set).
 * @stability experimental
 */
export function getTuiRootMenuSlots(): TuiMenuSlots {
  return rootSlots;
}

/**
 * Adds a section or an entry to the TUI menu tree.
 *
 * Unknown `parent` and unknown `route` are rejected when `createCli` builds
 * the CLI (so registration order is free), together with cycles and nesting
 * deeper than {@link TUI_MENU_MAX_DEPTH}.
 *
 * @param node - A section (`kind: 'section'`) or an entry (`kind: 'entry'`, with a `route`).
 * @throws Error when the id is malformed, reserved or taken, a field is missing, or `createCli` has already built the CLI.
 * @stability experimental
 * @extensionPoint registry
 * @example
 * ```ts
 * registerTuiMenuNode({ kind: 'section', id: 'node', label: 'Worker node', order: 40 });
 * registerTuiMenuNode({ kind: 'entry', id: 'node-dashboard', parent: 'node', route: 'node-dashboard', label: 'Dashboard', order: 10 });
 * ```
 */
export function registerTuiMenuNode(node: TuiMenuNode): void {
  registry.register(Object.freeze({ ...node }) as TuiMenuNode);
}

/**
 * The menu nodes registered so far, in registration order.
 *
 * @returns A frozen copy.
 * @stability experimental
 */
export function listTuiMenuNodes(): readonly TuiMenuNode[] {
  return registry.list();
}

/**
 * Checks the references between nodes and screens.
 *
 * @param nodes - The registered nodes.
 * @param routes - Every screen route that exists.
 * @throws Error naming the offending node id for an unknown or non-section parent, an unknown route, a cycle, or nesting deeper than {@link TUI_MENU_MAX_DEPTH}.
 * @stability experimental
 */
export function validateTuiMenuNodes(nodes: readonly TuiMenuNode[], routes: readonly string[]): void {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    const parent = node.parent ?? TUI_MENU_ROOT;
    if (parent !== TUI_MENU_ROOT) {
      const found = byId.get(parent);
      if (found === undefined) {
        throw new Error(`TUI menu node "${node.id}" has unknown parent "${parent}".`);
      }
      if (found.kind !== 'section') {
        throw new Error(`TUI menu node "${node.id}" has parent "${parent}", which is an entry; a parent must be a section.`);
      }
    }
    if (node.kind === 'entry' && !routes.includes(node.route)) {
      throw new Error(`TUI menu entry "${node.id}" opens unknown screen route "${node.route}"; register it with registerTuiScreen.`);
    }
  }
  for (const node of nodes) {
    // Walk up; the chain must reach the root within the cap without repeating.
    const seen = new Set<string>([node.id]);
    let level = node.kind === 'section' ? 1 : 0;
    let parent = node.parent ?? TUI_MENU_ROOT;
    while (parent !== TUI_MENU_ROOT) {
      if (seen.has(parent)) {
        throw new Error(`TUI menu node "${node.id}" is part of a cycle through "${parent}".`);
      }
      seen.add(parent);
      level += 1;
      parent = byId.get(parent)?.parent ?? TUI_MENU_ROOT;
    }
    if (level > TUI_MENU_MAX_DEPTH) {
      throw new Error(`TUI menu node "${node.id}" nests ${level} sections deep; the limit is ${TUI_MENU_MAX_DEPTH}.`);
    }
  }
}

/**
 * Validates the registered nodes against the screens, then refuses later
 * registrations; `createCli` calls it.
 *
 * @throws Error from {@link validateTuiMenuNodes}; nothing is frozen then.
 */
export function freezeTuiMenuRegistry(by: string): void {
  const routes = [...BUILTIN_TUI_SCREENS, ...listRegisteredTuiScreens()].map((screen) => screen.route);
  validateTuiMenuNodes(registry.list(), routes);
  registry.freeze(by);
  rootSlotsFrozenBy = by;
}

/** Empties the registry. Tests only. */
export function resetTuiMenuRegistryForTests(): void {
  registry.reset();
  rootSlots = {};
  rootSlotsFrozenBy = undefined;
}
