import { afterEach, describe, expect, it } from 'vitest';

import {
  freezeTuiMenuRegistry,
  listTuiMenuNodes,
  registerTuiMenuNode,
  resetTuiMenuRegistryForTests,
  validateTuiMenuNodes,
  TUI_MENU_MAX_DEPTH,
  type TuiMenuNode,
} from './menu-registry.js';
import { registerTuiScreen, resetTuiScreenRegistryForTests } from './screen-registry.js';

afterEach(() => {
  resetTuiMenuRegistryForTests();
  resetTuiScreenRegistryForTests();
});

const section = (id: string, parent?: string): TuiMenuNode => ({ kind: 'section', id, label: id, order: 1, ...(parent === undefined ? {} : { parent }) });
const entry = (id: string, route: string, parent?: string): TuiMenuNode => ({ kind: 'entry', id, route, label: id, order: 1, ...(parent === undefined ? {} : { parent }) });

describe('registerTuiMenuNode', () => {
  it('lists nodes in registration order', () => {
    registerTuiMenuNode(section('node'));
    registerTuiMenuNode(entry('node-status', 'status', 'node'));
    expect(listTuiMenuNodes().map((node) => node.id)).toEqual(['node', 'node-status']);
  });

  it('refuses a malformed, reserved or duplicate id', () => {
    expect(() => registerTuiMenuNode(section('Bad Id'))).toThrow(/"Bad Id" is invalid/);
    expect(() => registerTuiMenuNode(section('root'))).toThrow(/reserved/);
    registerTuiMenuNode(section('a'));
    expect(() => registerTuiMenuNode(entry('a', 'status'))).toThrow(/"a" is already registered/);
  });

  it('refuses missing fields', () => {
    expect(() => registerTuiMenuNode({ ...section('a'), order: Number.NaN })).toThrow(/order/);
    expect(() => registerTuiMenuNode({ ...section('a'), label: '' })).toThrow(/label/);
    expect(() => registerTuiMenuNode({ kind: 'entry', id: 'a', label: 'x', order: 1 } as unknown as TuiMenuNode)).toThrow(/route/);
    expect(() => registerTuiMenuNode({ kind: 'nope', id: 'a', label: 'x', order: 1 } as unknown as TuiMenuNode)).toThrow(/kind/);
  });

  it('accepts parents and routes registered later (checked at freeze)', () => {
    registerTuiMenuNode(entry('child', 'status', 'later'));
    registerTuiMenuNode(section('later'));
    expect(() => freezeTuiMenuRegistry('test')).not.toThrow();
  });

  it('refuses registration after freeze', () => {
    freezeTuiMenuRegistry('createCli built the CLI');
    expect(() => registerTuiMenuNode(section('late'))).toThrow(/after createCli built the CLI/);
  });
});

describe('validation at freeze', () => {
  const routes = ['status', 'login'];

  it('names the node with an unknown parent', () => {
    expect(() => validateTuiMenuNodes([section('a', 'ghost')], routes)).toThrow(/"a" has unknown parent "ghost"/);
  });

  it('refuses an entry as a parent', () => {
    expect(() => validateTuiMenuNodes([entry('e', 'status'), entry('f', 'login', 'e')], routes)).toThrow(/"f".*which is an entry/);
  });

  it('names the entry with an unknown route', () => {
    expect(() => validateTuiMenuNodes([entry('e', 'nowhere')], routes)).toThrow(/"e" opens unknown screen route "nowhere"/);
  });

  it('rejects cycles, including a self-parent', () => {
    expect(() => validateTuiMenuNodes([section('a', 'b'), section('b', 'a')], routes)).toThrow(/cycle/);
    expect(() => validateTuiMenuNodes([section('a', 'a')], routes)).toThrow(/"a" is part of a cycle/);
  });

  it('caps the depth at 4 sections', () => {
    const chain = (n: number): TuiMenuNode[] => Array.from({ length: n }, (_, i) => section(`s${i + 1}`, i === 0 ? undefined : `s${i}`));
    expect(() => validateTuiMenuNodes(chain(TUI_MENU_MAX_DEPTH), routes)).not.toThrow();
    expect(() => validateTuiMenuNodes(chain(TUI_MENU_MAX_DEPTH + 1), routes)).toThrow(/"s5" nests 5 sections deep/);
  });

  it('a screen registered with registerTuiScreen is a valid route; built-ins too', () => {
    registerTuiScreen({ route: 'about', label: 'About', order: 70, load: async () => () => null });
    registerTuiMenuNode(entry('e1', 'about'));
    registerTuiMenuNode(entry('e2', 'login'));
    expect(() => freezeTuiMenuRegistry('test')).not.toThrow();
  });

  it('a failed freeze leaves the registry open', () => {
    registerTuiMenuNode(entry('e', 'nowhere'));
    expect(() => freezeTuiMenuRegistry('test')).toThrow(/nowhere/);
    expect(() => registerTuiMenuNode(section('still-open'))).not.toThrow();
  });
});
