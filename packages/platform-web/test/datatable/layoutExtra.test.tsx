/**
 * The stored layout's app-facing fields (PP-14.20): `extra` (bounded JSON) and
 * `savedViews` (at most 20), through the sanitiser and the layout hook, with
 * the preferences port as the persistence boundary.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DATA_TABLE_ENTRY_MAX_BYTES,
  DATA_TABLE_EXTRA_MAX_BYTES,
  DATA_TABLE_MAX_SAVED_VIEWS,
  DATA_TABLE_PERSIST_DEBOUNCE_MS,
  DATA_TABLE_VIEW_NAME_MAX_LENGTH,
  DataTablePreferencesProvider,
  isEmptyStoredLayout,
  isValidStoredExtra,
  sanitizeStoredLayout,
  useDataTableLayoutPrefs,
  type DataTableColumn,
  type DataTablePreferencesPort,
  type DataTableStoredLayout,
} from '../../src/datatable/headless/index.js';

describe('sanitizeStoredLayout: extra and savedViews', () => {
  it('keeps bounded extra and well-formed views', () => {
    const stored = {
      pageSize: 25,
      extra: { filters: [{ columnId: 'tags', operator: 'hasAny', value: ['a'] }] },
      savedViews: [{ id: 'mine', name: ' Mine ', layout: { density: 'compact', extra: { chart: true }, savedViews: [{ id: 'nested' }] } }],
    };
    expect(sanitizeStoredLayout(stored)).toEqual({
      pageSize: 25,
      extra: stored.extra,
      savedViews: [{ id: 'mine', name: 'Mine', layout: { density: 'compact', extra: { chart: true } } }],
    });
  });

  it('drops what the API would refuse instead of echoing it back', () => {
    const poisoned = JSON.parse('{"a":{"__proto__":{"x":1}}}');
    const out = sanitizeStoredLayout({
      extra: poisoned,
      savedViews: [
        { id: 'Bad Id', name: 'x', layout: {} },
        { id: 'dup', name: 'one', layout: {} },
        { id: 'dup', name: 'two', layout: {} },
        { id: 'blank', name: '   ', layout: {} },
        { id: 'long', name: 'x'.repeat(DATA_TABLE_VIEW_NAME_MAX_LENGTH + 1), layout: {} },
        'garbage',
        { id: 'fine', name: 'Fine', layout: { extra: 'not-an-object', density: 'nope' } },
      ],
    });
    expect(out.extra).toBeUndefined();
    expect(out.savedViews).toEqual([
      { id: 'dup', name: 'one', layout: {} },
      { id: 'fine', name: 'Fine', layout: {} },
    ]);
  });

  it('caps the views at 20 and drops the app-owned parts of an entry over the byte bound', () => {
    const many = Array.from({ length: DATA_TABLE_MAX_SAVED_VIEWS + 5 }, (_, i) => ({ id: `v${i}`, name: `V${i}`, layout: {} }));
    expect(sanitizeStoredLayout({ savedViews: many }).savedViews).toHaveLength(DATA_TABLE_MAX_SAVED_VIEWS);

    const fat = Array.from({ length: DATA_TABLE_MAX_SAVED_VIEWS }, (_, i) => ({
      id: `v${i}`,
      name: `V${i}`,
      layout: { extra: { blob: 'x'.repeat(DATA_TABLE_EXTRA_MAX_BYTES - 100) } },
    }));
    const out = sanitizeStoredLayout({ density: 'compact', extra: { a: 1 }, savedViews: fat });
    expect(out).toEqual({ density: 'compact' });
  });

  it('validates extra: object only, bounded size, depth, keys and forbidden keys', () => {
    expect(isValidStoredExtra({ a: 1 })).toBe(true);
    expect(isValidStoredExtra([])).toBe(false);
    expect(isValidStoredExtra(null)).toBe(false);
    expect(isValidStoredExtra({ blob: 'x'.repeat(DATA_TABLE_EXTRA_MAX_BYTES) })).toBe(false);
    expect(isValidStoredExtra({ n: Number.NaN })).toBe(false);
    expect(isValidStoredExtra({ fn: () => 1 })).toBe(false);
    expect(isValidStoredExtra(Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${i}`, 1])))).toBe(false);
    let deep: unknown = 1;
    for (let i = 0; i < 10; i += 1) deep = { d: deep };
    expect(isValidStoredExtra({ deep })).toBe(false);
  });

  it('treats an entry of only views as non-empty, and an empty views list as empty', () => {
    expect(isEmptyStoredLayout({})).toBe(true);
    expect(isEmptyStoredLayout({ savedViews: [] })).toBe(true);
    expect(isEmptyStoredLayout({ savedViews: [{ id: 'a', name: 'A', layout: {} }] })).toBe(false);
    expect(isEmptyStoredLayout({ extra: { a: 1 } })).toBe(false);
  });
});

describe('useDataTableLayoutPrefs: extra and saved views', () => {
  const columns: DataTableColumn<{ id: string }>[] = [
    { id: 'a', label: 'A', priority: 'primary', sortable: true },
    { id: 'b', label: 'B', priority: 'secondary' },
  ];
  let stored: Record<string, unknown>;
  let saves: Array<[string, DataTableStoredLayout | null]>;
  let port: DataTablePreferencesPort;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stored = {};
    saves = [];
    port = {
      load: async () => stored,
      save: async (tableId, entry) => {
        saves.push([tableId, entry]);
      },
    };
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function mount() {
    const onSortChange = vi.fn();
    const onPaginationChange = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => <DataTablePreferencesProvider port={port}>{children}</DataTablePreferencesProvider>;
    const view = renderHook(
      () =>
        useDataTableLayoutPrefs({
          tableId: 'things',
          columns,
          layout: 'desktop',
          sort: { sort: { field: 'a', direction: 'asc' }, onSortChange },
          pagination: { page: 0, pageSize: 25, total: 100, onPaginationChange },
        }),
      { wrapper },
    );
    return { ...view, onSortChange, onPaginationChange };
  }

  async function flush() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DATA_TABLE_PERSIST_DEBOUNCE_MS + 50);
    });
  }

  it('hydrates extra and saved views from the port', async () => {
    stored = { things: { extra: { chart: true }, savedViews: [{ id: 'mine', name: 'Mine', layout: { density: 'compact' } }] } };
    const { result } = mount();
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.extra).toEqual({ chart: true });
    expect(result.current.savedViews.map((v) => v.id)).toEqual(['mine']);
  });

  it('setExtra persists one debounced write and removes a key with undefined', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    let ok = false;
    act(() => {
      ok = result.current.setExtra('chart', true);
    });
    expect(ok).toBe(true);
    expect(result.current.extra).toEqual({ chart: true });
    await flush();
    expect(saves.at(-1)).toEqual(['things', expect.objectContaining({ extra: { chart: true } })]);
    act(() => {
      result.current.setExtra('chart', undefined);
    });
    expect(result.current.extra).toBeUndefined();
  });

  it('setExtra refuses unbounded JSON and changes nothing', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    let ok = true;
    act(() => {
      ok = result.current.setExtra('blob', 'x'.repeat(DATA_TABLE_EXTRA_MAX_BYTES));
    });
    expect(ok).toBe(false);
    expect(result.current.extra).toBeUndefined();
    act(() => {
      ok = result.current.setExtra('f', () => 1);
    });
    expect(ok).toBe(false);
  });

  it('saveView snapshots the layout and the app extra, with unique slug ids', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    act(() => result.current.setDensity('compact'));
    let a: ReturnType<typeof result.current.saveView> = null;
    let b: ReturnType<typeof result.current.saveView> = null;
    act(() => {
      a = result.current.saveView('Urgent Items!', { filters: [{ columnId: 'tags', operator: 'hasAny', value: ['u'] }] });
      b = result.current.saveView('Urgent items');
    });
    expect(a).toMatchObject({
      id: 'urgent-items',
      name: 'Urgent Items!',
      layout: { density: 'compact', sort: { field: 'a', direction: 'asc' }, pageSize: 25, extra: { filters: [expect.anything()] } },
    });
    expect(b).toMatchObject({ id: 'urgent-items-2', name: 'Urgent items' });
    expect(result.current.savedViews.map((v) => v.id)).toEqual(['urgent-items', 'urgent-items-2']);
    await flush();
    expect(saves.at(-1)![1]!.savedViews).toHaveLength(2);
  });

  it('saveView refuses a blank or long name, bad extra, and the 21st view', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.saveView('   ')).toBeNull();
    expect(result.current.saveView('x'.repeat(DATA_TABLE_VIEW_NAME_MAX_LENGTH + 1))).toBeNull();
    expect(result.current.saveView('ok', { f: () => 1 })).toBeNull();
    act(() => {
      for (let i = 0; i < DATA_TABLE_MAX_SAVED_VIEWS; i += 1) expect(result.current.saveView(`View ${i}`)).not.toBeNull();
    });
    expect(result.current.savedViews).toHaveLength(DATA_TABLE_MAX_SAVED_VIEWS);
    let extra: ReturnType<typeof result.current.saveView> = { id: 'x', name: 'x', layout: {} };
    act(() => {
      extra = result.current.saveView('One too many');
    });
    expect(extra).toBeNull();
    expect(result.current.savedViews).toHaveLength(DATA_TABLE_MAX_SAVED_VIEWS);
  });

  it('saveView stays inside the entry byte bound', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    const big = { blob: 'x'.repeat(DATA_TABLE_EXTRA_MAX_BYTES - 100) };
    const saved: Array<unknown> = [];
    act(() => {
      for (let i = 0; i < DATA_TABLE_MAX_SAVED_VIEWS; i += 1) saved.push(result.current.saveView(`Big ${i}`, big));
    });
    // The 4th view (4 x ~8 KiB) fits 32 KiB; later ones are refused, never stored oversize.
    expect(saved.filter(Boolean).length).toBeLessThan(DATA_TABLE_MAX_SAVED_VIEWS);
    expect(JSON.stringify({ savedViews: result.current.savedViews }).length).toBeLessThanOrEqual(DATA_TABLE_ENTRY_MAX_BYTES);
  });

  it('applyView restores columns, density and extra, and hands sort and page size back to the page', async () => {
    stored = {
      things: {
        savedViews: [
          {
            id: 'wide',
            name: 'Wide',
            layout: { density: 'comfortable', visibleColumns: ['a', '-b'], sort: { field: 'a', direction: 'desc' }, pageSize: 50, extra: { filters: [1] } },
          },
        ],
      },
    };
    const { result, onSortChange, onPaginationChange } = mount();
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    onSortChange.mockClear();
    let applied: ReturnType<typeof result.current.applyView> = null;
    act(() => {
      applied = result.current.applyView('wide');
    });
    expect(applied).toMatchObject({ id: 'wide' });
    expect(result.current.density).toBe('comfortable');
    expect([...result.current.userVisibleColumnIds]).toEqual(['a']);
    expect(result.current.extra).toEqual({ filters: [1] });
    expect(onSortChange).toHaveBeenCalledWith({ field: 'a', direction: 'desc' });
    expect(onPaginationChange).toHaveBeenCalledWith({ page: 0, pageSize: 50 });
    expect(result.current.savedViews).toHaveLength(1);
    expect(result.current.applyView('missing')).toBeNull();
  });

  it('deleteView removes one; the last removal drops the key', async () => {
    stored = { things: { savedViews: [{ id: 'a', name: 'A', layout: {} }, { id: 'b', name: 'B', layout: {} }] } };
    const { result } = mount();
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    act(() => result.current.deleteView('a'));
    expect(result.current.savedViews.map((v) => v.id)).toEqual(['b']);
    act(() => result.current.deleteView('b'));
    expect(result.current.savedViews).toEqual([]);
    await flush();
    expect(saves.at(-1)).toEqual(['things', null]);
  });

  it('reset keeps the saved views and clears the rest', async () => {
    stored = { things: { density: 'compact', extra: { a: 1 }, savedViews: [{ id: 'a', name: 'A', layout: {} }] } };
    const { result } = mount();
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.customized).toBe(true);
    act(() => result.current.reset());
    expect(result.current.density).toBe('standard');
    expect(result.current.extra).toBeUndefined();
    expect(result.current.savedViews.map((v) => v.id)).toEqual(['a']);
    expect(result.current.customized).toBe(false);
    expect(saves.at(-1)).toEqual(['things', { savedViews: [{ id: 'a', name: 'A', layout: {} }] }]);
  });

  it('without views reset is still the merge-patch delete', async () => {
    stored = { things: { density: 'compact' } };
    const { result } = mount();
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    act(() => result.current.reset());
    expect(saves.at(-1)).toEqual(['things', null]);
  });
});
