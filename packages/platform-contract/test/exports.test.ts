// The exports contract (#744): the create body is strict and bounded, the
// export view and the JSON file parse representative values, and the id,
// dataset and file-name patterns refuse what a header or a zip entry must not
// carry.
import { describe, expect, it } from 'vitest';

import {
  EXPORT_DATASET_PATTERN,
  EXPORT_FILE_NAME_PATTERN,
  EXPORT_ID_PATTERN,
  EXPORT_JSON_SCHEMA_VERSION,
  EXPORT_STATUSES,
  createExportSchema,
  exportJsonFileSchema,
  exportSchema,
  exportSourcesResponseSchema,
  exportStatusSchema,
} from '../src/exports/index.js';

const ID = '7d1e5bb4-62a4-4c1f-9b3c-3f2d9a6c8e10';

describe('@marinoscar/platform-contract/exports', () => {
  it('parses a create body with defaults and refuses unknown keys', () => {
    expect(createExportSchema.parse({ source: 'user-data', format: 'json' })).toEqual({
      source: 'user-data',
      format: 'json',
      request: {},
    });
    expect(createExportSchema.safeParse({ source: 'user-data', format: 'json', extra: 1 }).success).toBe(false);
    expect(createExportSchema.safeParse({ source: 'User Data', format: 'json' }).success).toBe(false);
    expect(createExportSchema.safeParse({ source: 'org-data', format: 'csv', orgId: 'not-a-uuid' }).success).toBe(false);
  });

  it('keeps the status list and the enum in step', () => {
    expect(exportStatusSchema.options).toEqual([...EXPORT_STATUSES]);
  });

  it('parses an export view', () => {
    const view = {
      id: ID,
      source: 'user-data',
      format: 'csv',
      scope: 'user',
      orgId: null,
      status: 'ready',
      createdAt: '2026-10-08T10:00:00.000Z',
      completedAt: '2026-10-08T10:00:05.000Z',
      expiresAt: '2026-10-15T10:00:05.000Z',
      fileName: 'app-user-data-2026-10-08.zip',
      mimeType: 'application/zip',
      sizeBytes: 1024,
      rowCounts: { user_settings: 1 },
      error: null,
      download: { url: 'https://bucket.example.test/x?sig=1', expiresAt: '2026-10-08T10:05:05.000Z' },
    };
    expect(exportSchema.parse(view)).toEqual(view);
    expect(exportSchema.safeParse({ ...view, status: 'done' }).success).toBe(false);
  });

  it('parses the sources response', () => {
    expect(
      exportSourcesResponseSchema.parse({
        items: [
          {
            id: 'user-data',
            scope: 'user',
            label: 'Your data',
            formats: [{ id: 'json', label: 'JSON', extension: 'json', mimeType: 'application/json' }],
            fields: [{ key: 'from', label: 'From', kind: 'date', required: false }],
            crossOrg: false,
          },
        ],
      }).items,
    ).toHaveLength(1);
  });

  it('pins the JSON file envelope to schemaVersion 1', () => {
    const file = {
      schemaVersion: EXPORT_JSON_SCHEMA_VERSION,
      source: 'user-data',
      exportedAt: '2026-10-08T10:00:00.000Z',
      datasets: {
        user_settings: { title: 'User settings', columns: [{ key: 'id', label: 'Id', type: 'string' }], rows: [{ id: ID }] },
      },
    };
    expect(exportJsonFileSchema.parse(file)).toEqual(file);
    expect(exportJsonFileSchema.safeParse({ ...file, schemaVersion: 2 }).success).toBe(false);
    expect(exportJsonFileSchema.safeParse({ ...file, extra: true }).success).toBe(false);
  });

  it('refuses ids, datasets and file names a header or a zip entry must not carry', () => {
    expect(EXPORT_ID_PATTERN.test('user-data')).toBe(true);
    expect(EXPORT_ID_PATTERN.test('../x')).toBe(false);
    expect(EXPORT_DATASET_PATTERN.test('personal_access_token')).toBe(true);
    expect(EXPORT_DATASET_PATTERN.test('a/b')).toBe(false);
    expect(EXPORT_FILE_NAME_PATTERN.test('app-user-data-2026-10-08.zip')).toBe(true);
    expect(EXPORT_FILE_NAME_PATTERN.test('a"b.zip')).toBe(false);
    expect(EXPORT_FILE_NAME_PATTERN.test('Report.PDF')).toBe(false);
    expect(EXPORT_FILE_NAME_PATTERN.test('x.zip\r\nSet-Cookie: a')).toBe(false);
  });
});
