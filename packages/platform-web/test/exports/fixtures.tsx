import type { ExportSourceDescriptor, ExportView } from '@marinoscar/platform-contract/exports';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';

import { PlatformHostProvider } from '../../src/core/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';
import type { TestApiResponse, TestPlatformHost } from '../../src/testing/index.js';

export const ID = '7d1e5bb4-62a4-4c1f-9b3c-3f2d9a6c8e10';

export function view(extra: Partial<ExportView> = {}): ExportView {
  return {
    id: ID,
    source: 'user-data',
    format: 'json',
    scope: 'user',
    orgId: null,
    status: 'pending',
    createdAt: '2026-10-08T10:00:00.000Z',
    completedAt: null,
    expiresAt: null,
    fileName: null,
    mimeType: null,
    sizeBytes: null,
    rowCounts: null,
    error: null,
    download: null,
    ...extra,
  };
}

export const USER_DATA: ExportSourceDescriptor = {
  id: 'user-data',
  scope: 'user',
  label: 'Your data',
  description: 'Everything about you.',
  formats: [
    { id: 'json', label: 'JSON', extension: 'json', mimeType: 'application/json' },
    { id: 'csv', label: 'CSV (zip)', extension: 'zip', mimeType: 'application/zip' },
  ],
  fields: [],
  crossOrg: false,
};

export const RANGED: ExportSourceDescriptor = {
  id: 'inbox',
  scope: 'user',
  label: 'Inbox',
  formats: [{ id: 'csv', label: 'CSV (zip)', extension: 'zip', mimeType: 'application/zip' }],
  fields: [
    { key: 'from', label: 'From', kind: 'date', required: false },
    { key: 'unreadOnly', label: 'Unread only', kind: 'boolean', required: false, default: false },
    { key: 'units', label: 'Units', kind: 'select', required: true, options: [{ value: 'si', label: 'SI' }, { value: 'us', label: 'US' }], default: 'si' },
  ],
  crossOrg: false,
};

export const ORG_DATA: ExportSourceDescriptor = {
  id: 'org-data',
  scope: 'org',
  label: 'Organization data',
  formats: [{ id: 'json', label: 'JSON', extension: 'json', mimeType: 'application/json' }],
  fields: [],
  crossOrg: true,
};

export function hostWith(responses: Record<string, TestApiResponse>): TestPlatformHost {
  return createTestPlatformHost({ permissions: ['user_settings:read'], responses });
}

export function renderWith(host: TestPlatformHost, element: ReactElement) {
  return render(
    <MemoryRouter>
      <PlatformHostProvider host={host}>{element}</PlatformHostProvider>
    </MemoryRouter>,
  );
}
