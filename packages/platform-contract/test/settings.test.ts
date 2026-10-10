// The settings contract (issue #733): the schemas validate exactly as the
// reference app's always did, carry no `.default()`, and the org-settings
// body takes namespace branches or `null`.
import { describe, expect, it } from 'vitest';

import {
  DATA_TABLE_MAX_PAGE_SIZE,
  PROFILE_IMAGE_SOURCES,
  THEME_PREFERENCES,
  dataTablesPatchSchema,
  dataTablesSchema,
  navigationPatchSchema,
  orgSettingsResponseSchema,
  patchOrgSettingsSchema,
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
