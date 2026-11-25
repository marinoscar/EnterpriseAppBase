// The layout-preference port: the default over the user-settings routes, an
// app's own through the provider, and no persistence at all outside a host.
import { act, render as rtlRender, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { PlatformHostProvider } from '../../src/core/index.js';
import type { PlatformApiClient } from '../../src/core/index.js';
import {
  DataTablePreferencesProvider,
  createUserSettingsPreferencesPort,
  useDataTablePreferencesPort,
} from '../../src/datatable/headless/index.js';
import type { DataTableColumn, DataTablePreferencesPort } from '../../src/datatable/headless/index.js';
import { DataTable } from '../../src/datatable/ui/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';

function fakeApi(settings: unknown) {
  const get = vi.fn().mockResolvedValue(settings);
  const patch = vi.fn().mockResolvedValue({});
  return { api: { get, patch } as unknown as PlatformApiClient, get, patch };
}

describe('createUserSettingsPreferencesPort', () => {
  it('loads the dataTables namespace from GET /user-settings', async () => {
    const { api, get } = fakeApi({ theme: 'dark', dataTables: { jobs: { density: 'compact' } } });
    const port = createUserSettingsPreferencesPort(api);

    await expect(port.load()).resolves.toEqual({ jobs: { density: 'compact' } });
    expect(get).toHaveBeenCalledWith('/user-settings');
  });

  it('resolves to undefined when nothing is stored', async () => {
    const { api } = fakeApi({ theme: 'dark' });
    await expect(createUserSettingsPreferencesPort(api).load()).resolves.toBeUndefined();
  });

  it('saves one entry with PATCH, and a null entry deletes it, with no If-Match', async () => {
    const { api, patch } = fakeApi({});
    const port = createUserSettingsPreferencesPort(api);

    await port.save('jobs', { density: 'comfortable' });
    await port.save('jobs', null);

    expect(patch.mock.calls).toEqual([
      ['/user-settings', { dataTables: { jobs: { density: 'comfortable' } } }],
      ['/user-settings', { dataTables: { jobs: null } }],
    ]);
  });
});

describe('useDataTablePreferencesPort', () => {
  it('is null with neither a provider nor a host', () => {
    const { result } = renderHook(() => useDataTablePreferencesPort());
    expect(result.current).toBeNull();
  });

  it('is the user-settings port over the host transport, stable across renders', () => {
    const { api } = fakeApi({});
    const host = { ...createTestPlatformHost(), api };
    const wrapper = ({ children }: { children: ReactNode }) => <PlatformHostProvider host={host}>{children}</PlatformHostProvider>;
    const { result, rerender } = renderHook(() => useDataTablePreferencesPort(), { wrapper });

    const first = result.current;
    rerender();
    expect(first).not.toBeNull();
    expect(result.current).toBe(first);
  });

  it('prefers the provider over the host', () => {
    const { api } = fakeApi({});
    const host = { ...createTestPlatformHost(), api };
    const own: DataTablePreferencesPort = { load: vi.fn(), save: vi.fn() };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PlatformHostProvider host={host}>
        <DataTablePreferencesProvider port={own}>{children}</DataTablePreferencesProvider>
      </PlatformHostProvider>
    );
    const { result } = renderHook(() => useDataTablePreferencesPort(), { wrapper });
    expect(result.current).toBe(own);
  });
});

describe('DataTable preferences', () => {
  interface Row {
    id: string;
    name: string;
  }
  const columns: DataTableColumn<Row>[] = [{ id: 'name', label: 'Name', priority: 'primary', value: (row) => row.name }];

  it('saves nothing and does not wait for a load when there is no port', async () => {
    rtlRender(<DataTable<Row> columns={columns} rows={[{ id: 'a', name: 'Alpha' }]} rowId={(row) => row.id} ariaLabel="Things" tableId="things" />);

    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
    await act(async () => {});
  });
});
