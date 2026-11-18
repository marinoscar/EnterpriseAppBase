import { Box, Text, useInput } from 'ink';
import { useMemo, useState, type ReactNode } from 'react';

import { cliName } from '../../identity.js';
import { allTuiScreens } from '../builtin-screens.js';
import { useTuiApp } from '../context.js';
import { Frame, useTerminalSize } from '../layout.js';
import { listTuiMenuNodes, TUI_MENU_ROOT } from '../menu-registry.js';
import {
  buildTuiMenuTree,
  resolveTuiMenuSlot,
  tuiBreadcrumb,
  tuiMenuColor,
  tuiMenuItemLabel,
  tuiParentSectionId,
  visibleTuiMenuChildren,
  type TuiMenuTree,
  type TuiMenuTreeNode,
} from '../menu-tree.js';
import type { Route } from '../routes.js';
import { textColor } from '../theme.js';
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
  /** The tree to draw; defaults to the registered nodes and screens. Tests only. */
  tree?: TuiMenuTree | undefined;
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

// THE TREE (RETRO-G1.1, #1065). The menu is a renderer over the menu tree
// (menu-tree.ts). A section is drawn from the `sectionId` of the navigation
// stack's menu frame; entering one is `nav.toMenu(id)`, Esc is `nav.toMenu(parent)`,
// and a screen opened from a section pops back to that same section. With no
// registered menu nodes the tree is the flat list above (every screen at the
// root, Quit last), and the lines are unchanged: no digit prefixes are drawn
// until an app opts in to the tree, though the digit keys already work.
// =============================================================================

export function MenuScreen({ onSelect, onQuit, tree: treeProp }: MenuScreenProps): ReactNode {
  // The session comes from the app context, which reads the config once and
  // again on `session.refresh()` (the login and logout screens call it). The
  // menu used to re-read the file on every mount for the same freshness.
  const { session, nav, theme, appState } = useTuiApp();
  const { columns } = useTerminalSize();
  const loggedIn = session.loggedIn;

  const tree = useMemo(() => treeProp ?? buildTuiMenuTree(listTuiMenuNodes(), allTuiScreens()), [treeProp]);
  const requested = nav.current.kind === 'menu' ? nav.current.sectionId : undefined;
  // A stale or unknown section id falls back to the root rather than a blank menu.
  const sectionId = requested !== undefined && tree.sections.has(requested) ? requested : TUI_MENU_ROOT;
  const atRoot = sectionId === TUI_MENU_ROOT;
  const section = tree.sections.get(sectionId) ?? tree.root;

  const children = useMemo(() => visibleTuiMenuChildren(sectionId, { loggedIn }, tree), [sectionId, loggedIn, tree]);
  // Quit closes the root menu only, always last, and is not a tree node.
  const rows = useMemo(
    () => [...children.map((node) => ({ key: node.id, node })), ...(atRoot ? [{ key: 'quit', node: undefined }] : [])],
    [children, atRoot],
  );

  const [cursor, setCursor] = useState(0);
  const index = Math.min(cursor, Math.max(rows.length - 1, 0));

  const activate = (node: TuiMenuTreeNode | undefined): void => {
    if (node === undefined) {
      onQuit();
    } else if (node.kind === 'section') {
      setCursor(0);
      nav.toMenu(node.id);
    } else {
      onSelect(node.route);
    }
  };

  const up = (): void => {
    setCursor(0);
    nav.toMenu(tuiParentSectionId(sectionId, tree) === TUI_MENU_ROOT ? undefined : tuiParentSectionId(sectionId, tree));
  };

  // `q` quits from the ROOT menu only; Esc goes up one level (and does
  // nothing at the root). Safe on THIS screen and only this screen: every
  // other screen has a text field, where a bare `q` is a character the user
  // meant to type. That is why the shortcuts live here rather than in the app
  // root: a global handler would eat the `q` out of `/api/query` on the invoke
  // screen, and the bug would look like a broken keyboard.
  useInput((input, key) => {
    if (key.upArrow) {
      setCursor((index - 1 + rows.length) % rows.length);
    } else if (key.downArrow) {
      setCursor((index + 1) % rows.length);
    } else if (key.return) {
      activate(rows[index]?.node);
    } else if (key.escape) {
      if (!atRoot) up();
    } else if (input === 'q') {
      if (atRoot) onQuit();
    } else if (/^[1-9]$/.test(input)) {
      const row = rows[Number(input) - 1];
      if (row !== undefined) activate(row.node);
    }
  });

  // THE SLOTS (seam #1115): a banner above the subtitle and a footnote under
  // the entries, plain text from the app. Each line is truncated, never
  // wrapped, so header art cannot smear at 40 or 24 columns, and the colour
  // goes through the theme, so `NO_COLOR` draws none.
  const slotContext = { loggedIn, columns, sectionId, state: appState };
  const banner = resolveTuiMenuSlot(section.banner, slotContext);
  const footnote = resolveTuiMenuSlot(section.footnote, slotContext);
  const bannerColour = tuiMenuColor(theme, section.banner?.color ?? 'banner');
  const footnoteColour = tuiMenuColor(theme, section.footnote?.color ?? 'dim');

  const accelerators = tree.customised;
  const hints = atRoot
    ? ['↑↓ move', 'enter select', ...(accelerators ? ['1-9 jump'] : []), 'q quit', 'ctrl-c exit']
    : ['↑↓ move', 'enter select', ...(accelerators ? ['1-9 jump'] : []), 'esc back', 'ctrl-c exit'];

  return (
    <Frame title={atRoot ? 'Menu' : tuiBreadcrumb(sectionId, { loggedIn }, tree)} hints={hints}>
      <Box flexDirection="column" gap={1}>
        {banner.length > 0 ? (
          <Box flexDirection="column">
            {banner.map((line, i) => (
              <Text key={`banner-${i}`} wrap="truncate-end" {...textColor(bannerColour)}>
                {line}
              </Text>
            ))}
          </Box>
        ) : null}
        <Text dimColor>
          {atRoot
            ? session.serverUrl === undefined
              ? `No server configured yet — start with Login, or run \`${cliName()} --help\`.`
              : `Server: ${session.serverUrl}${session.identity?.email === undefined ? '' : `  ·  ${session.identity.email}`}`
            : (section.subtitle ?? 'Choose an entry. Esc goes up one level.')}
        </Text>

        <Box flexDirection="column">
          {rows.map((row, i) => {
            const selected = i === index;
            const label =
              row.node === undefined
                ? 'Quit'
                : tuiMenuItemLabel(row.node, accelerators ? i + 1 : undefined, { loggedIn });
            const colour = row.node === undefined ? undefined : tuiMenuColor(theme, row.node.color);
            return (
              <Text key={row.key} bold={selected} {...textColor(colour ?? (selected ? theme.info : undefined))}>
                {selected ? '❯ ' : '  '}
                {label}
              </Text>
            );
          })}
        </Box>
        {footnote.length > 0 ? (
          <Box flexDirection="column">
            {footnote.map((line, i) => (
              <Text key={`footnote-${i}`} wrap="truncate-end" {...textColor(footnoteColour)}>
                {line}
              </Text>
            ))}
          </Box>
        ) : null}
      </Box>
    </Frame>
  );
}
