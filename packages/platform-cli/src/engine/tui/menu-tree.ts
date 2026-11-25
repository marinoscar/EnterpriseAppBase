import {
  getTuiRootMenuSlots,
  listTuiMenuNodes,
  TUI_MENU_ROOT,
  type TuiMenuLabel,
  type TuiMenuNode,
  type TuiMenuSlot,
  type TuiMenuSlotContext,
  type TuiMenuSlots,
} from './menu-registry.js';
import { tuiMenuScreens, type TuiMenuContext } from './screen-registry.js';
import type { TuiColor, TuiTheme } from './theme.js';

// =============================================================================
// The TUI menu tree: pure helpers  (RETRO-G1.1, #1065)
// =============================================================================
//
// Everything a renderer needs to know about the menu, with no React and no ink:
// which children show for a login state, the exact text of a line, the
// breadcrumb, whether opening a route needs a login. Every renderer (the
// platform's `menu.tsx`, an app's own) calls these, so two menus cannot drift
// apart on the chevron, the ellipsis or the accelerator (the MemoriaHub #413
// lesson).
// =============================================================================

/**
 * What the tree needs to know about a screen: its route, its root label and its order.
 *
 * @stability experimental
 */
export interface TuiMenuScreenInfo {
  /** The screen's route id. */
  route: string;
  /** Its root menu label. */
  label: TuiMenuLabel;
  /** Its root menu order. */
  order: number;
  /** Not listed at the root when no entry opens it (`hideTuiScreen`, `hidden: true`). */
  hidden?: boolean | undefined;
}

/**
 * What both kinds of built tree node carry.
 *
 * @stability experimental
 */
export interface TuiMenuTreeNodeBase {
  /** The node id (`screen:<route>` for a synthesised root entry). */
  id: string;
  /** The section it sits in (`root` for a top-level node). */
  parentId: string;
  /** The label, or a function of the login state. */
  label: TuiMenuLabel;
  /** Position among its siblings. */
  order: number;
  /** The node's own logged-out flag; `undefined` inherits from the parent. */
  loggedOut: boolean | undefined;
  /** Hidden once logged in. */
  hideWhenLoggedIn: boolean;
  /** A theme token, colour name or colour; resolve it with {@link tuiMenuColor}. */
  color: TuiColor;
}

/**
 * A section in the built tree.
 *
 * @stability experimental
 */
export interface TuiMenuTreeSection extends TuiMenuTreeNodeBase {
  /** Discriminant. */
  kind: 'section';
  /** Replaces the default hint under the breadcrumb. */
  subtitle: string | undefined;
  /** Drawn above the subtitle line; resolve it with {@link resolveTuiMenuSlot}. */
  banner?: TuiMenuSlot | undefined;
  /** Drawn under the entries; resolve it with {@link resolveTuiMenuSlot}. */
  footnote?: TuiMenuSlot | undefined;
  /** Children, sorted by order then id. */
  children: TuiMenuTreeNode[];
}

/**
 * An entry in the built tree.
 *
 * @stability experimental
 */
export interface TuiMenuTreeEntry extends TuiMenuTreeNodeBase {
  /** Discriminant. */
  kind: 'entry';
  /** The screen it opens. */
  route: string;
  /** Rendered with a trailing `…`. */
  ellipsis: boolean;
  /** An explicit `requiresLogin`; `undefined` derives it from the logged-out rule. */
  requiresLogin: boolean | undefined;
  /** True for a screen no node references, shown at the root as it always was. */
  synthesised: boolean;
}

/**
 * A node of the built tree.
 *
 * @stability experimental
 */
export type TuiMenuTreeNode = TuiMenuTreeSection | TuiMenuTreeEntry;

/**
 * The built menu: the root section plus an index by id.
 *
 * @stability experimental
 */
export interface TuiMenuTree {
  /** The implicit root section (id `root`). */
  readonly root: TuiMenuTreeSection;
  /** Every section by id, the root included. */
  readonly sections: ReadonlyMap<string, TuiMenuTreeSection>;
  /** Every entry (synthesised ones too), in tree order. */
  readonly entries: readonly TuiMenuTreeEntry[];
  /** True when the app registered at least one menu node. */
  readonly customised: boolean;
}

/** Display name of the root in a breadcrumb. */
export const TUI_MENU_HOME_LABEL = 'Home';

function byOrder(a: { order: number; id: string }, b: { order: number; id: string }): number {
  return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Builds the menu tree from registered nodes and the screens.
 *
 * Every screen that no entry opens becomes a root entry with its own label and
 * order (visible when logged out, no login gate), so a CLI with no menu nodes
 * lists exactly the screens it always did; a screen flagged `hidden` is left
 * out instead. A screen that an entry opens is
 * left out of the root, so it appears once. Children sort by `order`, then id.
 * References are assumed valid (`createCli` checks them when it freezes); an
 * unresolvable node is placed at the root rather than lost.
 *
 * @param nodes - The registered nodes.
 * @param screens - Every screen (built-in and app) with its root label and order.
 * @param rootSlots - The root menu's banner and footnote. Default the ones `setTuiRootMenuSlots` set.
 * @returns The tree.
 * @stability experimental
 */
export function buildTuiMenuTree(
  nodes: readonly TuiMenuNode[],
  screens: readonly TuiMenuScreenInfo[],
  rootSlots: TuiMenuSlots = getTuiRootMenuSlots(),
): TuiMenuTree {
  const sections = new Map<string, TuiMenuTreeSection>();
  const root: TuiMenuTreeSection = {
    kind: 'section',
    id: TUI_MENU_ROOT,
    parentId: TUI_MENU_ROOT,
    label: TUI_MENU_HOME_LABEL,
    order: 0,
    loggedOut: undefined,
    hideWhenLoggedIn: false,
    color: undefined,
    subtitle: undefined,
    banner: rootSlots.banner,
    footnote: rootSlots.footnote,
    children: [],
  };
  sections.set(root.id, root);
  for (const node of nodes) {
    if (node.kind !== 'section') continue;
    sections.set(node.id, {
      kind: 'section',
      id: node.id,
      parentId: node.parent ?? TUI_MENU_ROOT,
      label: node.label,
      order: node.order,
      loggedOut: node.loggedOut,
      hideWhenLoggedIn: node.hideWhenLoggedIn === true,
      color: node.color,
      subtitle: node.subtitle,
      banner: node.banner,
      footnote: node.footnote,
      children: [],
    });
  }

  const entries: TuiMenuTreeEntry[] = [];
  const place = (child: TuiMenuTreeNode): void => {
    (sections.get(child.parentId) ?? root).children.push(child);
  };
  for (const section of sections.values()) {
    if (section !== root) place(section);
  }
  for (const node of nodes) {
    if (node.kind !== 'entry') continue;
    const entry: TuiMenuTreeEntry = {
      kind: 'entry',
      id: node.id,
      parentId: node.parent ?? TUI_MENU_ROOT,
      label: node.label,
      order: node.order,
      loggedOut: node.loggedOut,
      hideWhenLoggedIn: node.hideWhenLoggedIn === true,
      color: node.color,
      route: node.route,
      ellipsis: node.ellipsis === true,
      requiresLogin: node.requiresLogin,
      synthesised: false,
    };
    entries.push(entry);
    place(entry);
  }
  const referenced = new Set(entries.map((entry) => entry.route));
  for (const screen of screens) {
    if (referenced.has(screen.route) || screen.hidden === true) continue;
    const entry: TuiMenuTreeEntry = {
      kind: 'entry',
      // Not a valid registered id, so it can never collide with one.
      id: `screen:${screen.route}`,
      parentId: TUI_MENU_ROOT,
      label: screen.label,
      order: screen.order,
      loggedOut: true,
      hideWhenLoggedIn: false,
      color: undefined,
      route: screen.route,
      ellipsis: false,
      requiresLogin: false,
      synthesised: true,
    };
    entries.push(entry);
    place(entry);
  }
  for (const section of sections.values()) section.children.sort(byOrder);

  return { root, sections, entries, customised: nodes.length > 0 };
}

/** The tree from the registry, with built-in labels unknown (their route stands in): for pure callers and tests. */
function defaultTree(): TuiMenuTree {
  return buildTuiMenuTree(listTuiMenuNodes(), tuiMenuScreens());
}

/** The effective logged-out flag: the nearest explicit one, walking up; false at the root. */
function effectiveLoggedOut(node: TuiMenuTreeNode, tree: TuiMenuTree): boolean {
  let current: TuiMenuTreeNode | undefined = node;
  const guard = new Set<string>();
  while (current !== undefined && !guard.has(current.id)) {
    if (current.loggedOut !== undefined) return current.loggedOut;
    guard.add(current.id);
    current = current.id === TUI_MENU_ROOT ? undefined : tree.sections.get(current.parentId);
  }
  return false;
}

/**
 * The children of a section a user in this login state sees, in order.
 *
 * `loggedOut` CASCADES: a node with no explicit flag takes its parent's
 * effective value, so a child added to an offline section cannot vanish for
 * logged-out users by forgetting the flag; an explicit `false` opts one out.
 * `hideWhenLoggedIn` hides a node once logged in. A section shows only when it
 * has at least one visible descendant entry.
 *
 * @param sectionId - A section id; `root` for the top.
 * @param context - The login state.
 * @param tree - The tree (default: built from the registry, with built-in labels unresolved).
 * @returns The visible children; empty for an unknown section.
 * @stability experimental
 */
export function visibleTuiMenuChildren(sectionId: string, context: TuiMenuContext, tree: TuiMenuTree = defaultTree()): TuiMenuTreeNode[] {
  const section = tree.sections.get(sectionId);
  if (section === undefined) return [];
  return section.children.filter((child) => {
    if (context.loggedIn && child.hideWhenLoggedIn) return false;
    if (child.kind === 'entry') return effectiveLoggedOut(child, tree) || context.loggedIn;
    return visibleTuiMenuChildren(child.id, context, tree).length > 0;
  });
}

/**
 * The text of a menu line: the label for the login state, then the
 * decorations, which only this function adds: a section ends in ` ▸`, an
 * entry with `ellipsis` in `…`, and a 1-based `position` of 1 to 9 gets an
 * `N. ` accelerator (later positions get equal-width padding so the column
 * stays aligned).
 *
 * @param node - A tree node.
 * @param position - The node's 1-based place among the visible items; omit for no prefix.
 * @param context - The login state for a label function (default logged out).
 * @returns The line.
 * @stability experimental
 */
export function tuiMenuItemLabel(node: TuiMenuTreeNode, position?: number, context: TuiMenuContext = { loggedIn: false }): string {
  const text = typeof node.label === 'function' ? node.label(context) : node.label;
  const base = node.kind === 'section' ? `${text} ▸` : node.ellipsis ? `${text}…` : text;
  if (position === undefined) return base;
  return `${position >= 1 && position <= 9 ? `${position}. ` : '   '}${base}`;
}

/**
 * The path from the root to a section: `Home › Node › Settings`.
 *
 * @param sectionId - A section id; `root` or an unknown id gives `Home`.
 * @param context - The login state for label functions (default logged out).
 * @param tree - The tree (default: built from the registry).
 * @returns The labels joined with ` › `.
 * @stability experimental
 */
export function tuiBreadcrumb(sectionId: string, context: TuiMenuContext = { loggedIn: false }, tree: TuiMenuTree = defaultTree()): string {
  const trail: string[] = [];
  const guard = new Set<string>();
  let current = tree.sections.get(sectionId);
  while (current !== undefined && current.id !== TUI_MENU_ROOT && !guard.has(current.id)) {
    guard.add(current.id);
    trail.unshift(typeof current.label === 'function' ? current.label(context) : current.label);
    current = tree.sections.get(current.parentId);
  }
  return [TUI_MENU_HOME_LABEL, ...trail].join(' › ');
}

/**
 * The parent of a section (`root` for a top-level one and for the root itself).
 *
 * @param sectionId - A section id.
 * @param tree - The tree (default: built from the registry).
 * @returns The parent section id.
 * @stability experimental
 */
export function tuiParentSectionId(sectionId: string, tree: TuiMenuTree = defaultTree()): string {
  return tree.sections.get(sectionId)?.parentId ?? TUI_MENU_ROOT;
}

/**
 * Whether opening a route while logged out should show the "not logged in"
 * notice. True only when every entry that opens the route requires a login
 * (`requiresLogin`, else "not visible when logged out"); a route no entry
 * opens, or a synthesised root entry, never does.
 *
 * @param route - The screen route.
 * @param tree - The tree (default: built from the registry).
 * @returns Whether the route is login-gated.
 * @stability experimental
 */
export function tuiRouteRequiresLogin(route: string, tree: TuiMenuTree = defaultTree()): boolean {
  const opening = tree.entries.filter((entry) => entry.route === route);
  if (opening.length === 0) return false;
  return opening.every((entry) => entry.requiresLogin ?? !effectiveLoggedOut(entry, tree));
}

/**
 * The lines a menu slot draws: its content (or what its function returns)
 * split on newlines. A function that throws draws nothing, so a broken
 * banner can never take the menu down with it.
 *
 * @param slot - A banner or footnote; `undefined` draws nothing.
 * @param context - The login state, width, section and app state.
 * @returns The lines; empty for nothing.
 * @stability experimental
 */
export function resolveTuiMenuSlot(slot: TuiMenuSlot | undefined, context: TuiMenuSlotContext): string[] {
  if (slot === undefined) return [];
  let content: string | readonly string[] | undefined;
  try {
    content = typeof slot.content === 'function' ? slot.content(context) : slot.content;
  } catch {
    return [];
  }
  if (content === undefined) return [];
  return (typeof content === 'string' ? [content] : [...content]).flatMap((line) => String(line).split('\n'));
}

const NAMED_COLOURS: Readonly<Record<string, 'error' | 'success' | 'warning' | 'info' | 'dim' | 'accent' | 'primary'>> = {
  red: 'error',
  green: 'success',
  yellow: 'warning',
  blue: 'info',
  gray: 'dim',
  grey: 'dim',
  magenta: 'accent',
  cyan: 'primary',
};

const THEME_TOKENS = ['primary', 'success', 'warning', 'error', 'info', 'dim', 'accent', 'banner'] as const;

/**
 * Resolves a node's `color` for drawing: a theme token name or a basic colour
 * name maps through the theme (so an app's palette applies and `NO_COLOR`
 * yields no colour); any other string is used as written unless colour is off.
 *
 * @param theme - The app theme.
 * @param color - The node's `color`.
 * @returns A colour for ink, or `undefined` for none.
 * @stability experimental
 */
export function tuiMenuColor(theme: TuiTheme, color: TuiColor): TuiColor {
  if (color === undefined || !theme.color) return undefined;
  const token = (THEME_TOKENS as readonly string[]).includes(color) ? (color as (typeof THEME_TOKENS)[number]) : NAMED_COLOURS[color];
  return token === undefined ? color : theme[token];
}
