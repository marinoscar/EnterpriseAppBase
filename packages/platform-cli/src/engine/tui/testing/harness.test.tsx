import { Text, useInput } from 'ink';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { useTerminalSize } from '../layout.js';
import { DashboardSource } from '../dashboard/source.js';
import { useTuiApp, useTuiState } from '../context.js';
import type { TuiScreenProps } from '../screen-registry.js';
import { registerTuiMenuNode, resetTuiMenuRegistryForTests } from '../menu-registry.js';
import { registerTuiScreen, resetTuiScreenRegistryForTests } from '../screen-registry.js';
import { fakeDaemonFeed, fakeEmitterFeed } from './feeds.js';
import { cleanup, frameLines, hasAnsi, renderTuiMenu, renderTuiRoute, renderTuiScreen, stripAnsi } from './harness.js';

// =============================================================================
// The TUI testing kit  (RETRO-G1.5, #1069)
// =============================================================================

afterEach(() => {
  cleanup();
  resetTuiMenuRegistryForTests();
  resetTuiScreenRegistryForTests();
});

function Counter({ onDone, params }: TuiScreenProps): ReactNode {
  const { session, nav, theme } = useTuiApp();
  const build = useTuiState<{ version: string }>('build');
  const [count, setCount] = useState(0);
  const [text, setText] = useState('');
  useInput((input, key) => {
    if (key.upArrow) setCount((value) => value + 1);
    else if (key.downArrow) setCount((value) => value - 1);
    else if (key.escape) onDone();
    else if (key.return) nav.push('detail', { from: 'counter' });
    else if (/^[0-9]$/.test(input)) setCount(Number(input));
    else if (input !== '') setText((value) => value + input);
  });
  return (
    <Text>{`count=${count} text=${text} login=${String(session.loggedIn)} depth=${nav.depth} params=${JSON.stringify(params)} build=${build?.version ?? '-'} color=${String(theme.color)}`}</Text>
  );
}

function Detail({ params, onDone }: TuiScreenProps): ReactNode {
  useInput((_input, key) => {
    if (key.escape) onDone();
  });
  return <Text>{`detail ${JSON.stringify(params)}`}</Text>;
}

function Width(): ReactNode {
  return <Text>{`width=${useTerminalSize().columns}`}</Text>;
}

describe('renderTuiScreen', () => {
  it('renders with the session, params and app state, and never touches a real config', async () => {
    const screen = await renderTuiScreen(Counter, {
      params: { id: 7 },
      appState: { build: { version: '1.2.3' } },
      session: { loggedIn: true, serverUrl: 'https://app.example.test' },
    });
    await screen.waitForFrame((frame) => frame.includes('build=1.2.3'));
    expect(stripAnsi(screen.lastFrame() ?? '')).toContain('login=true depth=2 params={"id":7}');
    screen.unmount();
  });

  it('presses named keys and digits, and types text', async () => {
    const screen = await renderTuiScreen(Counter);
    await screen.press('up');
    await screen.press('up');
    await screen.waitForFrame((frame) => frame.includes('count=2'));
    await screen.press('down');
    await screen.waitForFrame((frame) => frame.includes('count=1'));
    await screen.press('7');
    await screen.waitForFrame((frame) => frame.includes('count=7'));
    await screen.type('ab');
    await screen.waitForFrame((frame) => frame.includes('text=ab'));
    expect(screen.frames.length).toBeGreaterThan(3);
    screen.unmount();
  });

  it('tracks pushes to a screens map and the pop back to the menu', async () => {
    const screen = await renderTuiScreen(Counter, { screens: { detail: Detail } });
    expect(screen.nav.stack.map((frame) => frame.kind)).toEqual(['menu', 'screen']);
    await screen.press('enter');
    await screen.waitForFrame((frame) => frame.includes('detail {"from":"counter"}'));
    expect(screen.nav.stack).toHaveLength(3);
    await screen.press('esc');
    await screen.waitForFrame((frame) => frame.includes('count='));
    await screen.press('esc');
    await screen.waitForFrame((frame) => frame.includes('[back at the menu]'));
    expect(screen.nav.stack).toHaveLength(1);
    screen.unmount();
  });

  it('shows a marker for a route nobody gave it', async () => {
    const screen = await renderTuiScreen(Counter);
    await screen.press('enter');
    await screen.waitForFrame((frame) => frame.includes('[no screen registered for detail]'));
    screen.unmount();
  });

  it('renders at a chosen width and under the monochrome theme', async () => {
    const screen = await renderTuiScreen(Width, { columns: 30, theme: 'mono' });
    expect(screen.app().theme.color).toBe(false);
    expect(hasAnsi(screen.lastFrame() ?? '')).toBe(false);
    expect(frameLines(screen.lastFrame())).toEqual(['width=30']);
    await screen.resize(60);
    await screen.waitForFrame((frame) => frame.includes('width=60'));
    screen.unmount();
  });

  it('reports a screen that throws while rendering', async () => {
    function Boom(): ReactNode {
      throw new Error('broken screen');
    }
    const screen = await renderTuiScreen(Boom);
    expect(screen.crashed()).toBe('broken screen');
    expect(stripAnsi(screen.lastFrame() ?? '')).toContain('[screen crashed: broken screen]');
    screen.unmount();
  });

  it('fails waitForFrame with the last frame in the message', async () => {
    const screen = await renderTuiScreen(Counter);
    await expect(screen.waitForFrame((frame) => frame.includes('never'), 60)).rejects.toThrow(/last frame was:\ncount=0/);
    screen.unmount();
  });
});

describe('renderTuiMenu', () => {
  const screens = [
    { route: 'status', label: 'Status', order: 10 },
    { route: 'reset', label: 'Reset', order: 20 },
  ];

  it('lists the visible labels and the breadcrumb of a section, and opens an entry', async () => {
    const nodes = [
      { kind: 'section', id: 'tools', label: 'Tools', order: 5, loggedOut: true },
      { kind: 'entry', id: 'tools-reset', parent: 'tools', route: 'reset', label: 'Reset', order: 1, ellipsis: true },
    ] as const;
    const menu = await renderTuiMenu({ nodes, screens, loggedIn: false });
    expect(menu.labels()).toEqual(['Tools ▸', 'Status']);
    expect(menu.breadcrumb()).toBe('Home');
    await menu.press('1');
    await menu.waitForFrame((frame) => frame.includes('Home › Tools'));
    expect(menu.labels()).toEqual(['Reset…']);
    expect(menu.breadcrumb()).toBe('Home › Tools');
    await menu.press('enter');
    await menu.waitForFrame((frame) => frame.includes('[opened reset]'));
    menu.unmount();
  });

  it('shows logged-in-only entries only when logged in', async () => {
    const nodes = [{ kind: 'entry', id: 'reset-entry', route: 'reset', label: 'Reset', order: 1 }] as const;
    const out = await renderTuiMenu({ nodes, screens, loggedIn: false });
    expect(out.labels()).toEqual(['Status']);
    out.unmount();
    const inn = await renderTuiMenu({ nodes, screens, loggedIn: true });
    expect(inn.labels()).toEqual(['Reset', 'Status']);
    inn.unmount();
  });
});

describe('renderTuiRoute', () => {
  it('shows the shared notice for a gated route when logged out, and the screen when logged in', async () => {
    registerTuiScreen({ route: 'secret', label: 'Secret', order: 90, component: Counter });
    registerTuiMenuNode({ kind: 'entry', id: 'secret-entry', route: 'secret', label: 'Secret', order: 90 });
    const out = await renderTuiRoute('secret', { session: { loggedIn: false }, theme: 'mono' });
    await out.waitForFrame((frame) => /not logged in/i.test(frame));
    out.unmount();
    const inn = await renderTuiRoute('secret', { session: { loggedIn: true } });
    await inn.waitForFrame((frame) => frame.includes('count=0'));
    inn.unmount();
  });
});

describe('the fake feeds', () => {
  const reducer = {
    initial: () => ({ total: 0 }),
    hydrate: (state: { total: number }, snapshot: unknown) => ({ ...state, total: (snapshot as { total: number }).total }),
    reduce: (state: { total: number }, event: number) => ({ ...state, total: state.total + event }),
    parseEvent: (frame: unknown) => (typeof frame === 'number' ? frame : undefined),
  };

  it('drives a source frame by frame as a daemon would', async () => {
    const feed = fakeDaemonFeed<number>();
    const source = new DashboardSource(reducer, feed);
    expect(() => feed.connect()).toThrow(/has not been started/);
    await source.start();
    expect(feed.started).toBe(true);
    feed.attempt();
    feed.connect();
    feed.snapshot({ total: 10 });
    feed.frame(5);
    feed.frame('garbage');
    expect(source.getState()).toMatchObject({ total: 15, connected: true, attempts: 1, mode: 'attached' });
    feed.disconnect('lost');
    expect(source.getState()).toMatchObject({ connected: false, error: 'lost' });
    source.stop();
    expect(feed.stopped).toBe(true);
  });

  it('drives a source with typed events as an emitter would', async () => {
    const feed = fakeEmitterFeed<number>();
    const source = new DashboardSource(reducer, feed);
    await source.start();
    feed.event(2);
    feed.event(3);
    expect(source.getState()).toMatchObject({ total: 5, mode: 'embedded' });
    feed.error('boom');
    expect(source.getState().error).toBe('boom');
    source.stop();
  });
});
