import { listTuiSelections, listTuiStateLoaders, registerTuiSelection, registerTuiStateLoader } from '@marinoscar/platform-cli/tui';
import { resetCliForTests } from '@marinoscar/platform-cli/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { buildInfoLoader } from './build-info.tui-state.js';
import { workspaceSelection } from './workspace.tui-selection.js';

afterEach(() => resetCliForTests());

describe('the workspace selection example', () => {
  it('registers, and offers two workspaces with stable keys', async () => {
    registerTuiSelection(workspaceSelection);
    const [registered] = listTuiSelections();
    expect(registered?.id).toBe('workspace');
    const items = await workspaceSelection.load({ loggedIn: true, serverUrl: undefined, signal: new AbortController().signal });
    expect(items.map((item) => workspaceSelection.keyOf?.(item))).toEqual(['ws-alpha', 'ws-beta']);
    expect(workspaceSelection.display(items[0] as (typeof items)[number])).toBe('Workspace Alpha');
  });
});

describe('the build-info loader example', () => {
  it('registers and loads from the login state', async () => {
    registerTuiStateLoader(buildInfoLoader);
    expect(listTuiStateLoaders().map((loader) => loader.id)).toEqual(['build-info']);
    const signal = new AbortController().signal;
    expect(await buildInfoLoader.load({ loggedIn: true, serverUrl: undefined, signal })).toMatchObject({ channel: 'stable' });
    expect(await buildInfoLoader.load({ loggedIn: false, serverUrl: undefined, signal })).toMatchObject({ channel: 'offline' });
  });
});
