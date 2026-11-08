import { describe, expect, it } from 'vitest';

import type { TuiMenuNode } from './menu-registry.js';
import {
  buildTuiMenuTree,
  tuiBreadcrumb,
  tuiMenuColor,
  tuiMenuItemLabel,
  tuiParentSectionId,
  tuiRouteRequiresLogin,
  visibleTuiMenuChildren,
  type TuiMenuScreenInfo,
} from './menu-tree.js';
import { resolveTuiTheme } from './theme.js';

const SCREENS: TuiMenuScreenInfo[] = [
  { route: 'login', label: 'Login', order: 10 },
  { route: 'status', label: 'Status', order: 30 },
  { route: 'dash', label: 'Dashboard', order: 100 },
  { route: 'reset', label: 'Reset', order: 101 },
  { route: 'tool', label: 'Tool', order: 102 },
];
const section = (id: string, extra: Partial<TuiMenuNode> = {}): TuiMenuNode =>
  ({ kind: 'section', id, label: id.toUpperCase(), order: 1, ...extra }) as TuiMenuNode;
const entry = (id: string, route: string, extra: Partial<TuiMenuNode> = {}): TuiMenuNode =>
  ({ kind: 'entry', id, route, label: id, order: 1, ...extra }) as TuiMenuNode;
const ids = (nodes: { id: string }[]): string[] => nodes.map((node) => node.id);
const out = { loggedIn: false };
const inn = { loggedIn: true };

describe('buildTuiMenuTree', () => {
  it('with no nodes lists every screen at the root, by order then id, all visible logged out', () => {
    const tree = buildTuiMenuTree([], SCREENS);
    expect(tree.customised).toBe(false);
    expect(visibleTuiMenuChildren('root', out, tree).map((n) => (n.kind === 'entry' ? n.route : n.id))).toEqual(['login', 'status', 'dash', 'reset', 'tool']);
    expect(tuiRouteRequiresLogin('status', tree)).toBe(false);
  });

  it('removes a referenced screen from the synthesised root list so it appears once', () => {
    const tree = buildTuiMenuTree([section('ops'), entry('ops-dash', 'dash', { parent: 'ops' })], SCREENS);
    const rootRoutes = tree.root.children.map((n) => (n.kind === 'entry' ? n.route : n.id));
    expect(rootRoutes).toContain('ops');
    expect(rootRoutes).not.toContain('dash');
    expect(tree.entries.filter((e) => e.route === 'dash')).toHaveLength(1);
  });

  it('sorts siblings by order, ties by id', () => {
    const tree = buildTuiMenuTree(
      [section('s'), entry('b', 'dash', { parent: 's', order: 5 }), entry('a', 'reset', { parent: 's', order: 5 }), entry('c', 'tool', { parent: 's', order: 1 })],
      [],
    );
    expect(ids(tree.sections.get('s')?.children ?? [])).toEqual(['c', 'a', 'b']);
  });

  it('a section can sort among the root screens', () => {
    const tree = buildTuiMenuTree([section('ops', { order: 35 }), entry('x', 'dash', { parent: 'ops', loggedOut: true })], SCREENS);
    expect(tree.root.children.map((n) => (n.kind === 'entry' ? n.route : n.id)).slice(0, 3)).toEqual(['login', 'status', 'ops']);
  });
});

describe('visibleTuiMenuChildren', () => {
  const nodes = [
    section('offline', { loggedOut: true }),
    entry('o1', 'dash', { parent: 'offline' }),
    entry('o2', 'reset', { parent: 'offline', loggedOut: false }),
    section('online'),
    entry('n1', 'tool', { parent: 'online' }),
    entry('hello', 'login', { hideWhenLoggedIn: true, loggedOut: true }),
  ];
  const tree = buildTuiMenuTree(nodes, []);

  it('cascades loggedOut to descendants and honours an explicit false opt-out', () => {
    expect(ids(visibleTuiMenuChildren('offline', out, tree))).toEqual(['o1']);
    expect(ids(visibleTuiMenuChildren('offline', inn, tree))).toEqual(['o1', 'o2']);
  });

  it('hides a section with no visible descendant when logged out', () => {
    expect(ids(visibleTuiMenuChildren('root', out, tree))).toEqual(['hello', 'offline']);
    expect(ids(visibleTuiMenuChildren('root', inn, tree))).toEqual(['offline', 'online']);
  });

  it('hideWhenLoggedIn hides an entry after login', () => {
    expect(ids(visibleTuiMenuChildren('root', out, tree))).toContain('hello');
    expect(ids(visibleTuiMenuChildren('root', inn, tree))).not.toContain('hello');
  });

  it('cascades through nested sections', () => {
    const deep = buildTuiMenuTree([section('a', { loggedOut: true }), section('b', { parent: 'a' }), entry('e', 'dash', { parent: 'b' })], []);
    expect(ids(visibleTuiMenuChildren('b', out, deep))).toEqual(['e']);
    expect(ids(visibleTuiMenuChildren('root', out, deep))).toEqual(['a']);
  });

  it('is empty for an unknown section', () => {
    expect(visibleTuiMenuChildren('ghost', out, tree)).toEqual([]);
  });
});

describe('tuiMenuItemLabel', () => {
  const tree = buildTuiMenuTree(
    [section('s', { label: ({ loggedIn }) => (loggedIn ? 'Yes' : 'No') }), entry('e', 'dash', { ellipsis: true, label: 'Reset' }), entry('p', 'tool', { label: 'Plain' })],
    [],
  );
  const get = (id: string) => tree.root.children.find((n) => n.id === id)!;

  it('decorates sections, ellipsis entries and plain entries', () => {
    expect(tuiMenuItemLabel(get('s'))).toBe('No ▸');
    expect(tuiMenuItemLabel(get('e'))).toBe('Reset…');
    expect(tuiMenuItemLabel(get('p'))).toBe('Plain');
  });

  it('resolves a label function against the login state', () => {
    expect(tuiMenuItemLabel(get('s'), undefined, inn)).toBe('Yes ▸');
  });

  it('adds the 1-9 accelerator, then equal-width padding', () => {
    expect(tuiMenuItemLabel(get('p'), 1)).toBe('1. Plain');
    expect(tuiMenuItemLabel(get('p'), 9)).toBe('9. Plain');
    expect(tuiMenuItemLabel(get('p'), 10)).toBe('   Plain');
  });
});

describe('tuiBreadcrumb and tuiParentSectionId', () => {
  const tree = buildTuiMenuTree([section('node', { label: 'Worker node' }), section('svc', { parent: 'node', label: 'Service' })], []);

  it('joins the labels from Home', () => {
    expect(tuiBreadcrumb('svc', out, tree)).toBe('Home › Worker node › Service');
    expect(tuiBreadcrumb('node', out, tree)).toBe('Home › Worker node');
    expect(tuiBreadcrumb('root', out, tree)).toBe('Home');
    expect(tuiBreadcrumb('ghost', out, tree)).toBe('Home');
  });

  it('finds the parent, root for top-level', () => {
    expect(tuiParentSectionId('svc', tree)).toBe('node');
    expect(tuiParentSectionId('node', tree)).toBe('root');
    expect(tuiParentSectionId('root', tree)).toBe('root');
  });
});

describe('tuiRouteRequiresLogin', () => {
  it('derives from the logged-out rule unless requiresLogin is explicit', () => {
    const tree = buildTuiMenuTree(
      [
        section('off', { loggedOut: true }),
        entry('a', 'dash', { parent: 'off' }),
        entry('b', 'reset', { parent: 'off', requiresLogin: true }),
        section('on'),
        entry('c', 'tool', { parent: 'on' }),
        entry('d', 'status', { parent: 'on', requiresLogin: false }),
      ],
      [],
    );
    expect(tuiRouteRequiresLogin('dash', tree)).toBe(false);
    expect(tuiRouteRequiresLogin('reset', tree)).toBe(true);
    expect(tuiRouteRequiresLogin('tool', tree)).toBe(true);
    expect(tuiRouteRequiresLogin('status', tree)).toBe(false);
    expect(tuiRouteRequiresLogin('nowhere', tree)).toBe(false);
  });

  it('is false when another entry opens the same route without a gate', () => {
    const tree = buildTuiMenuTree([entry('a', 'dash'), entry('b', 'dash', { loggedOut: true })], []);
    expect(tuiRouteRequiresLogin('dash', tree)).toBe(false);
  });
});

describe('tuiMenuColor', () => {
  const theme = resolveTuiTheme({ env: {}, noColor: false, overrides: { error: 'redBright' } });
  it('maps theme tokens and basic colour names through the theme', () => {
    expect(tuiMenuColor(theme, 'error')).toBe('redBright');
    expect(tuiMenuColor(theme, 'red')).toBe('redBright');
    expect(tuiMenuColor(theme, 'magenta')).toBe(theme.accent);
  });
  it('passes other colours through, and drops all of them when colour is off', () => {
    expect(tuiMenuColor(theme, '#ff8800')).toBe('#ff8800');
    expect(tuiMenuColor(theme, undefined)).toBeUndefined();
    const plain = resolveTuiTheme({ env: {}, noColor: true });
    expect(tuiMenuColor(plain, 'red')).toBeUndefined();
    expect(tuiMenuColor(plain, '#ff8800')).toBeUndefined();
  });
});
