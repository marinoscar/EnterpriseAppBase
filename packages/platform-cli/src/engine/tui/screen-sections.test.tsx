import { PassThrough } from 'node:stream';

import { Text, render } from 'ink';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { TuiScreenSections } from './screen-sections.js';
import { DeployScreen } from './screens/deploy/index.js';
import { NodeScreen } from './screens/node.js';
import {
  freezeTuiSectionRegistry,
  listTuiScreenSections,
  registerTuiScreenSection,
  resetTuiSectionRegistryForTests,
  type TuiSectionProps,
} from './section-registry.js';

// =============================================================================
// Sections of the node and deploy TUI screens  (PP-14.22)
// =============================================================================

afterEach(() => resetTuiSectionRegistryForTests());

function FleetNote({ screen }: TuiSectionProps): ReactNode {
  return <Text>fleet note on {screen}</Text>;
}

const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

async function mount(tree: ReactNode): Promise<{ frame: () => string; unmount: () => void }> {
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
  await settle(200);
  return { frame: () => output, unmount: () => app.unmount() };
}

async function eventually(frame: () => string, text: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!frame().includes(text) && Date.now() < deadline) await settle(25);
  expect(frame()).toContain(text);
}

describe('registerTuiScreenSection', () => {
  it('lists sections per screen in registration order, naming a component by its function', () => {
    registerTuiScreenSection('node', FleetNote);
    registerTuiScreenSection('node', FleetNote, { id: 'second' });
    registerTuiScreenSection('deploy', { id: 'hint', load: async () => FleetNote });
    expect(listTuiScreenSections('node').map((section) => section.id)).toEqual(['fleet-note', 'second']);
    expect(listTuiScreenSections('deploy').map((section) => section.id)).toEqual(['hint']);
  });

  it('refuses a screen with no slot, a taken or malformed id, and a late registration', () => {
    expect(() => registerTuiScreenSection('status', FleetNote)).toThrow(/no section slot.*node, deploy/);
    registerTuiScreenSection('node', FleetNote);
    expect(() => registerTuiScreenSection('node', FleetNote)).toThrow(/already registered/);
    expect(() => registerTuiScreenSection('node', FleetNote, { id: 'Bad Id' })).toThrow(/invalid/);
    freezeTuiSectionRegistry('createCli built the CLI');
    expect(() => registerTuiScreenSection('deploy', FleetNote, { id: 'late' })).toThrow(/after createCli built the CLI/);
  });
});

describe('TuiScreenSections', () => {
  it('renders nothing when there are none', async () => {
    const view = await mount(<TuiScreenSections screen="node" />);
    expect(view.frame().trim()).toBe('');
    view.unmount();
  });

  it('renders a component and a lazily loaded one, each for its own screen', async () => {
    registerTuiScreenSection('node', FleetNote);
    registerTuiScreenSection('node', { id: 'lazy', load: async () => ({ screen }: TuiSectionProps) => <Text>lazy on {screen}</Text> });
    registerTuiScreenSection('deploy', FleetNote, { id: 'other' });
    const view = await mount(<TuiScreenSections screen="node" />);
    await eventually(view.frame, 'lazy on node');
    expect(view.frame()).toContain('fleet note on node');
    expect(view.frame()).not.toContain('on deploy');
    view.unmount();
  });

  it('keeps the screen working when a section throws or fails to load', async () => {
    registerTuiScreenSection('node', () => {
      throw new Error('boom');
    }, { id: 'throws' });
    registerTuiScreenSection('node', { id: 'rejects', load: async () => Promise.reject(new Error('no module')) });
    registerTuiScreenSection('node', FleetNote);
    const view = await mount(<TuiScreenSections screen="node" />);
    await eventually(view.frame, 'section node:rejects failed to load: no module');
    expect(view.frame()).toContain('section node:throws failed: boom');
    expect(view.frame()).toContain('fleet note on node');
    view.unmount();
  });
});

describe('inside the built-in screens', () => {
  it('shows a node section below the worker-node list', async () => {
    registerTuiScreenSection('node', FleetNote);
    const view = await mount(<NodeScreen onDone={() => undefined} />);
    await eventually(view.frame, 'fleet note on node');
    expect(view.frame()).toContain('Worker node');
    view.unmount();
  });

  it('shows a deploy section below the deploy actions, and none otherwise', async () => {
    const plain = await mount(<DeployScreen onDone={() => undefined} />);
    expect(plain.frame()).not.toContain('fleet note');
    plain.unmount();

    registerTuiScreenSection('deploy', FleetNote);
    const view = await mount(<DeployScreen onDone={() => undefined} />);
    await eventually(view.frame, 'fleet note on deploy');
    expect(view.frame()).toContain('Doctor');
    view.unmount();
  });
});
