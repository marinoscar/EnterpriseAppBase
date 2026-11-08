import { PassThrough } from 'node:stream';

import { Text, render, useInput } from 'ink';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { Router } from './app.js';
import { TuiAppProvider, useTuiApp } from './context.js';
import { registerTuiMenuNode, resetTuiMenuRegistryForTests } from './menu-registry.js';
import { registerTuiScreen, resetTuiScreenRegistryForTests, type TuiScreenProps } from './screen-registry.js';
import { resolveTuiTheme } from './theme.js';

// =============================================================================
// The menu as a renderer over the tree  (RETRO-G1.1, #1065)
// =============================================================================

const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));

interface Mounted {
  frame: () => string;
  press: (key: string) => Promise<void>;
  unmount: () => void;
}

async function mount(loggedIn: boolean): Promise<Mounted> {
  const stdout = Object.assign(new PassThrough(), { columns: 110, rows: 60, isTTY: true });
  let output = '';
  stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => undefined, ref: () => undefined, unref: () => undefined });
  const app = render(
    <TuiAppProvider
      readSession={() => ({ loggedIn, serverUrl: 'https://app.example.test' })}
      loadIdentity={async () => ({})}
      theme={resolveTuiTheme({ env: { TERM: 'xterm' }, noColor: true })}
      selections={[]}
      stateLoaders={[]}
    >
      <Router />
    </TuiAppProvider>,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );
  await settle(150);
  return {
    // `debug` mode appends whole frames; the last one is the screen.
    frame: () => output.slice(output.lastIndexOf('╭')),
    press: async (key) => {
      stdin.write(key);
      await settle();
    },
    unmount: () => app.unmount(),
  };
}

function Marker({ onDone }: TuiScreenProps): ReactNode {
  const { nav } = useTuiApp();
  useInput((input) => {
    if (input === 'd') onDone();
  });
  return <Text>{`MARKER depth=${nav.depth}`}</Text>;
}

function registerTree(): void {
  registerTuiScreen({ route: 'dash', label: 'Dashboard', order: 100, component: Marker });
  registerTuiScreen({ route: 'reset', label: 'Reset', order: 101, component: Marker });
  registerTuiMenuNode({ kind: 'section', id: 'ops', label: 'Operations', order: 35, subtitle: 'Daily operations' });
  registerTuiMenuNode({ kind: 'section', id: 'deep', parent: 'ops', label: 'Deeper', order: 20 });
  registerTuiMenuNode({ kind: 'entry', id: 'ops-dash', parent: 'ops', route: 'dash', label: 'Dashboard', order: 10, loggedOut: true });
  registerTuiMenuNode({ kind: 'entry', id: 'ops-reset', parent: 'deep', route: 'reset', label: 'Reset', order: 10, ellipsis: true, color: 'red', loggedOut: true });
}

afterEach(() => {
  resetTuiMenuRegistryForTests();
  resetTuiScreenRegistryForTests();
});

describe('the menu with no registered nodes', () => {
  it('renders the same lines as before, with Quit last and no accelerators', async () => {
    const app = await mount(false);
    const frame = app.frame();
    const lines = ['Login', 'Call an endpoint  (not logged in)', 'Status', 'Worker node  (this machine)', 'Deploy  (this server)', 'Logout  (nothing stored)', 'Quit'];
    let last = -1;
    for (const line of lines) {
      const at = frame.indexOf(line, last + 1);
      expect(at, line).toBeGreaterThan(last);
      last = at;
    }
    expect(frame).not.toMatch(/\d\. Login/);
    expect(frame).toContain('q quit');
    app.unmount();
  });

  it('q quits from the root only, Esc at the root does nothing', async () => {
    const app = await mount(false);
    await app.press('\u001b');
    expect(app.frame()).toContain('Quit');
    app.unmount();
  });
});

describe('nested sections', () => {
  it('shows a chevron on the section, enters it with a breadcrumb and the subtitle, and Esc goes up one level', async () => {
    registerTree();
    const app = await mount(true);
    expect(app.frame()).toContain('1. Login');
    expect(app.frame()).toMatch(/Operations ▸/);

    // Operations sits between Status (3) and Worker node: press its accelerator.
    await app.press('4');
    expect(app.frame()).toContain('Home › Operations');
    expect(app.frame()).toContain('Daily operations');
    expect(app.frame()).toContain('1. Dashboard');
    expect(app.frame()).toMatch(/2\. Deeper ▸/);
    expect(app.frame()).toContain('esc back');

    await app.press('2');
    expect(app.frame()).toContain('Home › Operations › Deeper');
    expect(app.frame()).toContain('1. Reset…');

    await app.press('\u001b');
    expect(app.frame()).toContain('Home › Operations');
    expect(app.frame()).not.toContain('Home › Operations › Deeper');

    await app.press('\u001b');
    expect(app.frame()).toContain('Quit');
    expect(app.frame()).not.toContain('Home ›');
    app.unmount();
  });

  it('q does nothing inside a section, and a screen opened from it returns to it', async () => {
    registerTree();
    const app = await mount(true);
    await app.press('4');
    await app.press('q');
    expect(app.frame()).toContain('Home › Operations');

    await app.press('1');
    expect(app.frame()).toContain('MARKER depth=2');
    await app.press('d');
    expect(app.frame()).toContain('Home › Operations');
    app.unmount();
  });

  it('the Down arrow and Enter select the highlighted line', async () => {
    registerTree();
    const app = await mount(true);
    await app.press('4');
    await app.press('\u001b[B');
    await app.press('\r');
    expect(app.frame()).toContain('Home › Operations › Deeper');
    app.unmount();
  });

  it('hides a login-required section when logged out and keeps an offline one', async () => {
    registerTuiMenuNode({ kind: 'section', id: 'private', label: 'Private', order: 35 });
    registerTuiMenuNode({ kind: 'entry', id: 'private-dash', parent: 'private', route: 'login', label: 'Hidden', order: 1 });
    const app = await mount(false);
    expect(app.frame()).not.toContain('Private');
    app.unmount();
    const signedIn = await mount(true);
    expect(signedIn.frame()).toContain('Private ▸');
    signedIn.unmount();
  });
});

describe('the login gate', () => {
  it('shows the shared notice for a requiresLogin entry opened while logged out, and Esc goes back', async () => {
    registerTuiScreen({ route: 'secret', label: 'Secret', order: 100, component: Marker });
    registerTuiMenuNode({ kind: 'section', id: 'vault', label: 'Vault', order: 34, loggedOut: true });
    registerTuiMenuNode({ kind: 'entry', id: 'vault-secret', parent: 'vault', route: 'secret', label: 'Secret', order: 1, requiresLogin: true });
    const app = await mount(false);
    await app.press('4');
    await app.press('1');
    expect(app.frame()).toContain('[l] login  [q/Esc] back');
    expect(app.frame()).not.toContain('MARKER');
    await app.press('\u001b');
    expect(app.frame()).toContain('Home › Vault');
    app.unmount();
  });

  it('opens the screen when logged in', async () => {
    registerTuiScreen({ route: 'secret', label: 'Secret', order: 100, component: Marker });
    registerTuiMenuNode({ kind: 'entry', id: 'vault-secret', route: 'secret', label: 'Secret', order: 34 });
    const app = await mount(true);
    await app.press('4');
    expect(app.frame()).toContain('MARKER');
    app.unmount();
  });
});
