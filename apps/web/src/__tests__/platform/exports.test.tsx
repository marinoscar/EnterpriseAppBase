/**
 * The app's exports binding (#744): the packaged client and hooks, the
 * dialog with the reference form slot (`platform-extensions/exports/`), the
 * list and the page, against a test platform host shaped like the API.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { ExportSourceDescriptor, ExportView } from '@marinoscar/platform-contract/exports';
import { PlatformHostProvider } from '@marinoscar/platform-web/core';
import {
  createExportsClient,
  useCreateExport,
  useExport,
  useExportSources,
  useExports,
} from '@marinoscar/platform-web/exports/headless';
import { DataExportPage, ExportDialog, ExportsList } from '@marinoscar/platform-web/exports/ui';
import { createTestPlatformHost } from '@marinoscar/platform-web/testing';
import type { TestApiResponse, TestPlatformHost } from '@marinoscar/platform-web/testing';

import { InboxRangeForm } from '../../platform-extensions/exports/InboxRangeForm.example';

const ID = '7d1e5bb4-62a4-4c1f-9b3c-3f2d9a6c8e10';

const INBOX: ExportSourceDescriptor = {
  id: 'example-notification-inbox',
  scope: 'user',
  label: 'Notification inbox (example)',
  formats: [{ id: 'csv-single', label: 'CSV (single file)', extension: 'csv', mimeType: 'text/csv' }],
  fields: [
    { key: 'from', label: 'From', kind: 'date', required: false },
    { key: 'to', label: 'To', kind: 'date', required: false },
    { key: 'unreadOnly', label: 'Unread only', kind: 'boolean', required: false, default: false },
  ],
  crossOrg: false,
};

function view(extra: Partial<ExportView> = {}): ExportView {
  return {
    id: ID,
    source: 'example-notification-inbox',
    format: 'csv-single',
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

function hostWith(responses: Record<string, TestApiResponse>): TestPlatformHost {
  return createTestPlatformHost({ permissions: ['user_settings:read'], responses });
}

function wrap(host: TestPlatformHost) {
  return ({ children }: { children: ReactNode }): ReactElement => (
    <MemoryRouter>
      <PlatformHostProvider host={host}>{children}</PlatformHostProvider>
    </MemoryRouter>
  );
}

describe('exports binding', () => {
  it('createExportsClient calls /exports', async () => {
    const host = hostWith({ 'GET /exports': { items: [] } });
    await createExportsClient(host.api).list();
    expect(host.requests.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /exports']);
  });

  it('useExportSources, useExports, useCreateExport and useExport read and write the API', async () => {
    let polls = 0;
    const host = hostWith({
      'GET /exports/sources': { items: [INBOX] },
      'GET /exports': { items: [view({ status: 'ready' })] },
      'POST /exports': view(),
      [`GET /exports/${ID}`]: () => (++polls < 2 ? view({ status: 'running' }) : view({ status: 'ready' })),
    });
    const { result } = renderHook(
      () => ({ sources: useExportSources(), list: useExports(), create: useCreateExport(), one: useExport(ID, { intervalMs: 20 }) }),
      { wrapper: wrap(host) },
    );
    await waitFor(() => expect(result.current.sources.sources).toHaveLength(1));
    await waitFor(() => expect(result.current.list.exports[0]?.status).toBe('ready'));
    await waitFor(() => expect(result.current.one.view?.status).toBe('ready'), { timeout: 2000 });
    const created = await result.current.create.create({ source: 'example-notification-inbox', format: 'csv-single' });
    expect(created?.status).toBe('pending');
  });

  it('the reference form slot replaces the generated fields and posts what the strict schema accepts', async () => {
    const host = hostWith({ 'POST /exports': view() });
    render(<ExportDialog open onClose={() => undefined} sources={[INBOX]} slots={{ form: { [INBOX.id]: InboxRangeForm } }} />, {
      wrapper: wrap(host),
    });
    expect(screen.queryByLabelText('From')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Last 7 days' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    await waitFor(() => expect(host.requests).toHaveLength(1));
    const body = host.requests[0]!.body as { request: Record<string, string> };
    expect(Object.keys(body.request).sort()).toEqual(['from', 'to']);
    expect(body.request.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('ExportsList downloads a ready export from a fresh URL', async () => {
    const host = hostWith({
      [`GET /exports/${ID}`]: view({ status: 'ready', download: { url: 'https://s.test/x', expiresAt: '2026-10-08T10:05:00.000Z' } }),
    });
    const onDownload = vi.fn();
    render(<ExportsList exports={[view({ status: 'ready' })]} sources={[INBOX]} onDownload={onDownload} />, { wrapper: wrap(host) });
    fireEvent.click(screen.getByRole('button', { name: /Download/ }));
    await waitFor(() => expect(onDownload).toHaveBeenCalledWith('https://s.test/x', expect.anything()));
  });

  it('DataExportPage is the /settings/data-export page', async () => {
    const host = hostWith({ 'GET /exports/sources': { items: [INBOX] }, 'GET /exports': { items: [] } });
    render(<DataExportPage />, { wrapper: wrap(host) });
    expect(screen.getByRole('heading', { level: 1, name: 'Download your data' })).toBeInTheDocument();
    expect(await screen.findByText(/not exported anything/)).toBeInTheDocument();
  });
});
