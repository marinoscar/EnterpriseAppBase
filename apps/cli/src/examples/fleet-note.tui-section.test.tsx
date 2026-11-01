import { PassThrough } from 'node:stream';

import { createCli } from '@marinoscar/platform-cli';
import { listTuiScreenSections, registerTuiScreenSection } from '@marinoscar/platform-cli/tui';
import { resetCliForTests } from '@marinoscar/platform-cli/testing';
import { render } from 'ink';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { APP_CLI_OPTIONS } from '../app.js';

import { FleetNote } from './fleet-note.tui-section.js';

// The registerTuiScreenSection example (PP-14.22).

beforeEach(() => resetCliForTests());
afterEach(() => resetCliForTests());

describe('FleetNote', () => {
  it('is not a section of the shipped TUI', () => {
    createCli(APP_CLI_OPTIONS);
    expect(listTuiScreenSections('node')).toEqual([]);
  });

  it('is registered for the node screen once passed in tuiSections, and for no other screen', () => {
    createCli({ ...APP_CLI_OPTIONS, tuiSections: [{ screen: 'node', id: 'fleet-note', component: FleetNote }] });
    expect(listTuiScreenSections('node').map((section) => section.id)).toEqual(['fleet-note']);
    expect(listTuiScreenSections('deploy')).toEqual([]);
  });

  it('refuses an app screen as a target: a screen composes its own content', () => {
    expect(() => registerTuiScreenSection('about', FleetNote)).toThrow(/no section slot/);
  });

  it('renders one dim line naming the screen', async () => {
    const stdout = Object.assign(new PassThrough(), { columns: 100, rows: 20, isTTY: true });
    let output = '';
    stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => undefined, ref: () => undefined, unref: () => undefined });
    const app = render(<FleetNote screen="node" />, {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    app.unmount();
    expect(output).toContain('COACH_WORKERS');
    expect(output).toContain('node screen');
  });
});
