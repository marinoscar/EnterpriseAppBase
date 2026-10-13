// The settings contract (issue #733): the schemas validate exactly as the
// reference app's always did, carry no `.default()`, and the org-settings
// body takes namespace branches or `null`.
import { describe, expect, it } from 'vitest';

import {
  DATA_TABLE_MAX_PAGE_SIZE,
  PROFILE_IMAGE_SOURCES,
  THEME_OPTION_LABEL_MAX,
  THEME_PREFERENCE_ID_PATTERN,
  THEME_PREFERENCES,
  dataTablesPatchSchema,
  dataTablesSchema,
  navigationPatchSchema,
  orgSettingsResponseSchema,
  patchOrgSettingsSchema,
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
