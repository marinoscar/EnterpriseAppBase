import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { Text, render, useInput } from 'ink';
import { useEffect, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Router } from './app.js';
import { readTuiSelection } from '../config.js';
import {
  TuiAppProvider,
  useOptionalTuiApp,
  useTuiApp,
  useTuiSelection,
  useTuiState,
  type TuiAppContext,
  type TuiAppProviderProps,
} from './context.js';
import { Frame } from './layout.js';
import { registerTuiScreen, resetTuiScreenRegistryForTests, type TuiScreenProps } from './screen-registry.js';
import { resolveTuiTheme } from './theme.js';

// =============================================================================
// The shared TUI app context and navigation stack  (RETRO-G1.2, #1066)
// =============================================================================

const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

interface Mounted {
  frame: () => string;
  press: (key: string) => Promise<void>;
  unmount: () => void;
}

async function mount(tree: ReactNode): Promise<Mounted> {
  const stdout = Object.assign(new PassThrough(), { columns: 110, rows: 60, isTTY: true });
  let output = '';
  stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => undefined, ref: () => undefined, unref: () => undefined });
  const app = render(tree, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  await settle(120);
  return {
    // `debug` mode appends whole frames; the last one is the screen.
    frame: () => output.split('\n').slice(-40).join('\n'),
    press: async (key) => {
      stdin.write(key);
      await settle(80);
    },
    unmount: () => app.unmount(),
  };
}

async function eventually(check: () => boolean, message: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await settle(25);
  expect(check(), message).toBe(true);
}

/** A noisy base: every provider gets a logged-in session and no network. */
function provider(props: Partial<TuiAppProviderProps> & { children: ReactNode }): ReactNode {
  return (
    <TuiAppProvider
      readSession={() => ({ loggedIn: true, serverUrl: 'https://app.example.test' })}
      loadIdentity={async () => ({ email: 'person@example.test', displayName: 'Person A' })}
      theme={resolveTuiTheme({ env: { TERM: 'xterm' }, noColor: false })}
      selections={[]}
      stateLoaders={[]}
      {...props}
    />
  );
}

afterEach(() => resetTuiScreenRegistryForTests());

describe('useTuiApp', () => {
  it('throws a clear error outside a provider, while the optional form returns undefined', async () => {
    let caught = '';
    let optional: TuiAppContext | undefined | 'unset' = 'unset';
    function Probe(): ReactNode {
      optional = useOptionalTuiApp();
      try {
        useTuiApp();
      } catch (error) {
        caught = (error as Error).message;
      }
      return <Text>probe</Text>;
    }
    const app = await mount(<Probe />);
    expect(caught).toMatch(/outside a TuiAppProvider/);
    expect(optional).toBeUndefined();
    app.unmount();
  });

  it('returns session, nav, selection, theme and appState, and never the token', async () => {
    let seen: TuiAppContext | undefined;
    function Probe(): ReactNode {
      seen = useTuiApp();
      return <Text>{seen.session.identity?.email ?? 'no identity yet'}</Text>;
    }
    const app = await mount(provider({ children: <Probe /> }));
    await eventually(() => app.frame().includes('person@example.test'), 'identity arrives');
    expect(seen?.session).toMatchObject({ loggedIn: true, serverUrl: 'https://app.example.test' });
    expect(seen?.nav).toMatchObject({ depth: 1, current: { kind: 'menu' } });
    expect(seen?.theme.primary).toBe('cyan');
    expect(seen?.selection).toEqual({});
    expect(seen?.appState).toEqual({});
    expect(JSON.stringify(seen?.session)).not.toMatch(/token|pat_/i);
    app.unmount();
  });
});

describe('the navigation stack', () => {
  const log: string[] = [];
  beforeEach(() => {
    log.length = 0;
  });

  function ScreenA({ onDone, params }: TuiScreenProps): ReactNode {
    const { nav } = useTuiApp();
    useEffect(() => {
      log.push('A mounted');
      return () => {
        log.push('A cleaned up');
      };
    }, []);
    useInput((input) => {
      log.push(`A key ${input}`);
      if (input === 'p') nav.push('screen-b', { from: 'a' });
      if (input === 'd') onDone();
    });
    return <Text>{`SCREEN-A depth=${nav.depth} params=${JSON.stringify(params ?? null)}`}</Text>;
  }

  function ScreenB({ onDone, params }: TuiScreenProps): ReactNode {
    const { nav } = useTuiApp();
    useEffect(() => {
      log.push('B mounted');
      return () => {
        log.push('B cleaned up');
      };
    }, []);
    useInput((input) => {
      log.push(`B key ${input}`);
      if (input === 'd') onDone();
      if (input === 'm') nav.toMenu();
    });
    return <Text>{`SCREEN-B depth=${nav.depth} params=${JSON.stringify(params ?? null)}`}</Text>;
  }

  function register(): void {
    registerTuiScreen({ route: 'screen-a', label: 'A', order: 100, component: ScreenA });
    registerTuiScreen({ route: 'screen-b', label: 'B', order: 101, component: ScreenB });
  }

  const startOnA = (): ReactNode =>
    provider({
      initialStack: [{ kind: 'menu' }, { kind: 'screen', route: 'screen-a', params: { id: 7 } }],
      children: <Router />,
    });

  it('push A, push B, pop returns to A with its params; a left screen runs its cleanup', async () => {
    register();
    const app = await mount(startOnA());
    expect(app.frame()).toContain('SCREEN-A depth=2 params={"id":7}');

    await app.press('p');
    expect(app.frame()).toContain('SCREEN-B depth=3 params={"from":"a"}');
    expect(log).toContain('A cleaned up');

    log.length = 0;
    await app.press('d');
    expect(app.frame()).toContain('SCREEN-A depth=2 params={"id":7}');
    expect(log).toContain('B cleaned up');
    expect(log).toContain('A mounted');
    app.unmount();
  });

  it('mounts only the top frame: a hidden screen receives no keys', async () => {
    register();
    const app = await mount(startOnA());
    await app.press('p');
    log.length = 0;

    await app.press('x');
    expect(log).toEqual(['B key x']);
    app.unmount();
  });

  it('a screen that only calls onDone still goes back to the menu', async () => {
    register();
    const app = await mount(
      provider({ initialStack: [{ kind: 'menu' }, { kind: 'screen', route: 'screen-b' }], children: <Router /> }),
    );
    await app.press('d');
    await eventually(() => app.frame().includes('Server: https://app.example.test'), 'menu is back');
    app.unmount();
  });

  it('toMenu clears the whole stack', async () => {
    register();
    const app = await mount(startOnA());
    await app.press('p');
    await app.press('m');
    await eventually(() => app.frame().includes('Server: https://app.example.test'), 'menu is back');
    app.unmount();
  });

  it('pop on the menu is a no-op', async () => {
    let nav: TuiAppContext['nav'] | undefined;
    function Probe(): ReactNode {
      nav = useTuiApp().nav;
      return <Text>{`depth ${nav.depth}`}</Text>;
    }
    const app = await mount(provider({ children: <Probe /> }));
    nav?.pop();
    await settle();
    expect(app.frame()).toContain('depth 1');
    app.unmount();
  });

  it('says so, and lets Esc go back, when a frame names a route nobody registered', async () => {
    const app = await mount(
      provider({ initialStack: [{ kind: 'menu' }, { kind: 'screen', route: 'ghost' }], children: <Router /> }),
    );
    expect(app.frame()).toContain('Unknown screen "ghost"');
    await app.press('\u001b');
    await settle(150);
    await eventually(() => app.frame().includes('Server: https://app.example.test'), 'menu is back');
    app.unmount();
  });
});

describe('selections', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'appctl-tui-ctx-'));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  const projects = [
    { id: 'p-1', name: 'Alpha' },
    { id: 'p-2', name: 'Beta' },
  ];
  const registration = (persist: 'config' | 'none') => ({
    id: 'project',
    label: 'Project',
    persist,
    load: async () => projects,
    display: (item: unknown) => (item as (typeof projects)[number]).name,
    keyOf: (item: unknown) => (item as (typeof projects)[number]).id,
  });

  function Picker(): ReactNode {
    const project = useTuiSelection<(typeof projects)[number]>('project');
    return (
      <Frame title="Pick">
        <Text>{`current=${project.current?.name ?? 'none'} loading=${project.loading}`}</Text>
      </Frame>
    );
  }

  let selectFn: ((item: (typeof projects)[number]) => void) | undefined;
  function Capture(): ReactNode {
    selectFn = useTuiSelection<(typeof projects)[number]>('project').select;
    return null;
  }

  it('loads, shows a chip in the frame header and defaults to the first item', async () => {
    const app = await mount(
      provider({ selections: [registration('none')], configContext: { env: {}, home }, children: <Picker /> }),
    );
    await eventually(() => app.frame().includes('current=Alpha loading=false'), 'selection loaded');
    expect(app.frame()).toContain('[Project: Alpha]');
    app.unmount();
  });

  it('select() with persist config writes tui.selection.<id>, and the next run restores it', async () => {
    const configContext = { env: {}, home };
    const first = await mount(
      provider({ selections: [registration('config')], configContext, children: <><Capture /><Picker /></> }),
    );
    await eventually(() => first.frame().includes('current=Alpha'), 'first load');
    selectFn?.(projects[1] as (typeof projects)[number]);
    await eventually(() => first.frame().includes('current=Beta'), 'selected');
    expect(readTuiSelection('project', configContext)).toBe('p-2');
    first.unmount();

    const second = await mount(provider({ selections: [registration('config')], configContext, children: <Picker /> }));
    await eventually(() => second.frame().includes('current=Beta'), 'restored');
    second.unmount();
  });

  it('select() with persist none touches no file', async () => {
    const configContext = { env: {}, home };
    const app = await mount(
      provider({ selections: [registration('none')], configContext, children: <><Capture /><Picker /></> }),
    );
    await eventually(() => app.frame().includes('current=Alpha'), 'load');
    selectFn?.(projects[1] as (typeof projects)[number]);
    await eventually(() => app.frame().includes('current=Beta'), 'selected');
    expect(readTuiSelection('project', configContext)).toBeUndefined();
    app.unmount();
  });

  it('shows no chip when nothing is registered', async () => {
    const app = await mount(provider({ children: <Frame title="Plain"><Text>body</Text></Frame> }));
    expect(app.frame()).toContain('Plain');
    expect(app.frame()).not.toContain('[');
    app.unmount();
  });

  it('reports a failed load without a chip', async () => {
    function Err(): ReactNode {
      const project = useTuiSelection('project');
      return <Text>{`error=${project.error ?? 'none'}`}</Text>;
    }
    const app = await mount(
      provider({
        selections: [{ ...registration('none'), load: async () => Promise.reject(new Error('server down')) }],
        children: <Err />,
      }),
    );
    await eventually(() => app.frame().includes('error=server down'), 'error surfaced');
    app.unmount();
  });

  it('throws for an id nobody registered', async () => {
    let caught = '';
    function Probe(): ReactNode {
      try {
        useTuiSelection('nope');
      } catch (error) {
        caught = (error as Error).message;
      }
      return <Text>x</Text>;
    }
    const app = await mount(provider({ children: <Probe /> }));
    expect(caught).toMatch(/No TUI selection "nope"/);
    app.unmount();
  });
});

describe('state loaders', () => {
  it('runs once on mount and again, not before, on session.refresh()', async () => {
    let runs = 0;
    let refresh: (() => Promise<void>) | undefined;
    function Show(): ReactNode {
      const value = useTuiState<number>('counter');
      refresh = useTuiApp().session.refresh;
      return <Text>{`counter=${value ?? 'unset'}`}</Text>;
    }
    const app = await mount(
      provider({ stateLoaders: [{ id: 'counter', load: async () => ++runs }], children: <Show /> }),
    );
    await eventually(() => app.frame().includes('counter=1'), 'first run');
    await settle(150);
    expect(runs).toBe(1);

    await refresh?.();
    await eventually(() => app.frame().includes('counter=2'), 'second run after refresh');
    expect(runs).toBe(2);
    app.unmount();
  });

  it('records a failure under appStateErrors and leaves the value unset', async () => {
    function Show(): ReactNode {
      const { appState, appStateErrors } = useTuiApp();
      return <Text>{`value=${String(appState.broken)} error=${appStateErrors.broken ?? 'none'}`}</Text>;
    }
    const app = await mount(
      provider({ stateLoaders: [{ id: 'broken', load: async () => Promise.reject(new Error('no database')) }], children: <Show /> }),
    );
    await eventually(() => app.frame().includes('error=no database'), 'error recorded');
    expect(app.frame()).toContain('value=undefined');
    app.unmount();
  });

  it('refresh re-reads the stored session', async () => {
    let loggedIn = false;
    let refresh: (() => Promise<void>) | undefined;
    function Show(): ReactNode {
      const { session } = useTuiApp();
      refresh = session.refresh;
      return <Text>{`loggedIn=${session.loggedIn}`}</Text>;
    }
    const app = await mount(
      provider({ readSession: () => ({ loggedIn, serverUrl: 'https://app.example.test' }), children: <Show /> }),
    );
    expect(app.frame()).toContain('loggedIn=false');
    loggedIn = true;
    await refresh?.();
    await eventually(() => app.frame().includes('loggedIn=true'), 'session refreshed');
    app.unmount();
  });
});

describe('the theme in the context', () => {
  it('has no colour tokens under NO_COLOR', async () => {
    function Show(): ReactNode {
      const { theme } = useTuiApp();
      return <Text>{`color=${theme.color} primary=${String(theme.primary)} error=${String(theme.error)}`}</Text>;
    }
    const app = await mount(
      provider({ theme: resolveTuiTheme({ env: { TERM: 'xterm', NO_COLOR: '1' }, noColor: false }), children: <Show /> }),
    );
    expect(app.frame()).toContain('color=false primary=undefined error=undefined');
    app.unmount();
  });
});
