// The settings contract (issue #733): the schemas validate exactly as the
// reference app's always did, carry no `.default()`, and the org-settings
// body takes namespace branches or `null`.
import { describe, expect, it } from 'vitest';

import {
  DATA_TABLE_ENTRY_MAX_BYTES,
  DATA_TABLE_EXTRA_MAX_BYTES,
  DATA_TABLE_EXTRA_MAX_DEPTH,
  DATA_TABLE_EXTRA_MAX_KEYS,
  DATA_TABLE_MAX_PAGE_SIZE,
  DATA_TABLE_MAX_SAVED_VIEWS,
  DATA_TABLE_VIEW_NAME_MAX_LENGTH,
  dataTablesPatchSchema,
  dataTablesSchema,
  navigationPatchSchema,
  orgSettingsResponseSchema,
  patchOrgSettingsSchema,
  PROFILE_IMAGE_SOURCES,
  THEME_OPTION_LABEL_MAX,
  THEME_PREFERENCE_ID_PATTERN,
  THEME_PREFERENCES,
  themeOptionSchema,
  themePreferenceIdSchema,
  themePreferenceSchema,
  userProfileSettingsSchema,
} from '../src/settings/index.js';

describe('settings contract', () => {
  it('keeps the published enum orders', () => {
    expect(THEME_PREFERENCES).toEqual(['light', 'dark', 'system']);
    expect(PROFILE_IMAGE_SOURCES).toEqual(['none', 'provider', 'upload']);
  });

  it('validates the profile and the data-table bounds, without defaults', () => {
    expect(userProfileSettingsSchema.parse({ imageSource: 'upload', imageObjectId: null })).toEqual({ imageSource: 'upload', imageObjectId: null });
    expect(userProfileSettingsSchema.safeParse({ imageSource: 'gravatar' }).success).toBe(false);
    expect(dataTablesSchema.parse({ jobs: {} })).toEqual({ jobs: {} });
    expect(dataTablesSchema.safeParse({ 'Bad Id': {} }).success).toBe(false);
    expect(dataTablesSchema.safeParse({ jobs: { pageSize: DATA_TABLE_MAX_PAGE_SIZE + 1 } }).success).toBe(false);
    expect(dataTablesSchema.safeParse({ jobs: { extra: 1 } }).success).toBe(false);
    expect(dataTablesPatchSchema.parse({ jobs: null })).toEqual({ jobs: null });
    expect(navigationPatchSchema.parse({ railCollapsed: null })).toEqual({ railCollapsed: null });
  });

  it('takes an org-settings patch of namespace branches or null', () => {
    expect(patchOrgSettingsSchema.parse({ exportPolicy: { enabled: false }, workspaceLabel: null })).toEqual({
      exportPolicy: { enabled: false },
      workspaceLabel: null,
    });
    expect(patchOrgSettingsSchema.safeParse({ 'Not A Key': {} }).success).toBe(false);
  });

  it('describes the org-settings response', () => {
    const parsed = orgSettingsResponseSchema.parse({
      orgId: '11111111-1111-4111-8111-111111111111',
      value: {},
      effective: {},
      version: 0,
      namespaces: [{ key: 'a', description: 'd', merge: 'override', writable: true, fields: [{ name: 'x', kind: 'boolean' }] }],
      updatedAt: null,
    });
    expect(parsed.namespaces[0]?.fields[0]?.kind).toBe('boolean');
  });
});

describe('theme preference ids an app registers (PP-14.21)', () => {
  it('keeps the built-in enum closed and accepts any id of the pattern in the id schema', () => {
    expect(themePreferenceSchema.safeParse('high-contrast').success).toBe(false);
    expect(themePreferenceIdSchema.safeParse('high-contrast').success).toBe(true);
    for (const builtin of THEME_PREFERENCES) expect(THEME_PREFERENCE_ID_PATTERN.test(builtin)).toBe(true);
    for (const bad of ['', 'a', 'High', '1abc', 'has space', 'x'.repeat(49)]) {
      expect(themePreferenceIdSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('describes one registered theme as an id and a bounded label', () => {
    expect(themeOptionSchema.parse({ id: 'sepia', label: 'Sepia' })).toEqual({ id: 'sepia', label: 'Sepia' });
    expect(themeOptionSchema.safeParse({ id: 'sepia', label: '' }).success).toBe(false);
    expect(themeOptionSchema.safeParse({ id: 'sepia', label: 'x'.repeat(THEME_OPTION_LABEL_MAX + 1) }).success).toBe(false);
    expect(themeOptionSchema.safeParse({ id: 'Sepia', label: 'Sepia' }).success).toBe(false);
  });
});

describe('dataTables stored layout extras and saved views (PP-14.20)', () => {
  const view = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    name: `View ${id}`,
    layout: { density: 'compact' as const, extra },
  });

  it('accepts bounded extra JSON and saved views beside the platform fields', () => {
    const entry = {
      pageSize: 50,
      extra: { filters: [{ columnId: 'tags', operator: 'isAnyOf', value: ['a', 'b'] }], chart: true },
      savedViews: [view('mine', { filters: [] })],
    };
    expect(dataTablesSchema.parse({ jobs: entry })).toEqual({ jobs: entry });
    expect(dataTablesPatchSchema.parse({ jobs: entry })).toEqual({ jobs: entry });
  });

  it('refuses an extra over 8 KiB, too deep, with too many keys or a poisoned key', () => {
    expect(dataTablesSchema.safeParse({ jobs: { extra: { blob: 'x'.repeat(DATA_TABLE_EXTRA_MAX_BYTES) } } }).success).toBe(false);
    expect(dataTablesSchema.safeParse({ jobs: { extra: { blob: 'x'.repeat(DATA_TABLE_EXTRA_MAX_BYTES - 20) } } }).success).toBe(true);
    let deep: unknown = 1;
    for (let i = 0; i < DATA_TABLE_EXTRA_MAX_DEPTH + 2; i += 1) deep = { next: deep };
    expect(dataTablesSchema.safeParse({ jobs: { extra: { deep } } }).success).toBe(false);
    const manyKeys = Object.fromEntries(Array.from({ length: DATA_TABLE_EXTRA_MAX_KEYS + 1 }, (_, i) => [`k${i}`, i]));
    expect(dataTablesSchema.safeParse({ jobs: { extra: manyKeys } }).success).toBe(false);
    const poisoned = JSON.parse('{"filters":{"__proto__":{"polluted":true}}}') as Record<string, unknown>;
    expect(dataTablesSchema.safeParse({ jobs: { extra: poisoned } }).success).toBe(false);
    expect(dataTablesSchema.safeParse({ jobs: { extra: { f: () => 1 } } }).success).toBe(false);
  });

  it('caps the saved views at 20, requires unique ids and bounds the names', () => {
    const many = Array.from({ length: DATA_TABLE_MAX_SAVED_VIEWS + 1 }, (_, i) => view(`v${i}`));
    expect(dataTablesSchema.safeParse({ jobs: { savedViews: many.slice(0, DATA_TABLE_MAX_SAVED_VIEWS) } }).success).toBe(true);
    expect(dataTablesSchema.safeParse({ jobs: { savedViews: many } }).success).toBe(false);
    expect(dataTablesSchema.safeParse({ jobs: { savedViews: [view('a'), view('a')] } }).success).toBe(false);
    expect(dataTablesSchema.safeParse({ jobs: { savedViews: [{ ...view('a'), name: 'x'.repeat(DATA_TABLE_VIEW_NAME_MAX_LENGTH + 1) }] } }).success).toBe(false);
    expect(dataTablesSchema.safeParse({ jobs: { savedViews: [{ ...view('a'), name: '   ' }] } }).success).toBe(false);
    expect(dataTablesSchema.safeParse({ jobs: { savedViews: [{ ...view('Bad Id') }] } }).success).toBe(false);
    // a view carries no nested views, and no unknown key
    expect(dataTablesSchema.safeParse({ jobs: { savedViews: [{ ...view('a'), layout: { savedViews: [] } }] } }).success).toBe(false);
    expect(dataTablesSchema.safeParse({ jobs: { savedViews: [{ ...view('a'), surprise: 1 }] } }).success).toBe(false);
  });

  it('bounds the whole entry, so twenty 8 KiB views cannot inflate one row', () => {
    const fat = Array.from({ length: DATA_TABLE_MAX_SAVED_VIEWS }, (_, i) => view(`v${i}`, { blob: 'x'.repeat(DATA_TABLE_EXTRA_MAX_BYTES - 200) }));
    expect(dataTablesSchema.safeParse({ jobs: { savedViews: fat } }).success).toBe(false);
    expect(DATA_TABLE_ENTRY_MAX_BYTES).toBe(32768);
  });
});
