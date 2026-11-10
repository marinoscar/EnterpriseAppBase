// The exports UI (issue #744): the dialog draws a source's fields from its
// descriptor and posts what the user chose; a source can bring its own form;
// the list states status in words and downloads from a FRESH signed URL; the
// page and its settings card.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DataExportPage, ExportDialog, ExportsList, dataExportSettingsPage } from '../../src/exports/ui/index.js';
import { ID, ORG_DATA, RANGED, USER_DATA, hostWith, renderWith, view } from './fixtures.js';

describe('ExportDialog', () => {
  it('requests the chosen source and format, with the generated request fields', async () => {
    const host = hostWith({ 'POST /exports': view({ source: 'inbox', format: 'csv' }) });
    const onCreated = vi.fn();
    const onClose = vi.fn();
    renderWith(host, <ExportDialog open onClose={onClose} sources={[USER_DATA, RANGED]} initialSourceId="inbox" onCreated={onCreated} />);

    const dialog = screen.getByRole('dialog', { name: 'Export data' });
    fireEvent.change(within(dialog).getByLabelText('From'), { target: { value: '2026-10-01' } });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Unread only' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start export' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(host.requests.find((r) => r.method === 'POST')?.body).toEqual({
      source: 'inbox',
      format: 'csv',
      request: { from: '2026-10-01', unreadOnly: true, units: 'si' },
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('offers every format of the source as a radio and posts the chosen one', async () => {
    const host = hostWith({ 'POST /exports': view({ format: 'csv' }) });
    renderWith(host, <ExportDialog open onClose={() => undefined} sources={[USER_DATA]} />);
    fireEvent.click(screen.getByRole('radio', { name: 'CSV (zip)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    await waitFor(() => expect(host.requests).toHaveLength(1));
    expect(host.requests[0]!.body).toEqual({ source: 'user-data', format: 'csv', request: {} });
  });

  it("uses a source's own form from slots.form", async () => {
    const host = hostWith({ 'POST /exports': view() });
    const Form = ({ onChange }: { onChange: (value: Record<string, unknown>) => void }) => (
      <button type="button" onClick={() => onChange({ custom: 'yes' })}>
        Pick custom
      </button>
    );
    renderWith(host, <ExportDialog open onClose={() => undefined} sources={[RANGED]} slots={{ form: { inbox: Form } }} />);
    expect(screen.queryByLabelText('From')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Pick custom' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    await waitFor(() => expect(host.requests).toHaveLength(1));
    expect(host.requests[0]!.body).toMatchObject({ request: { custom: 'yes' } });
  });

  it('asks for an organization id only for a cross-organization source', async () => {
    const host = hostWith({ 'POST /exports': view({ source: 'org-data', scope: 'org' }) });
    renderWith(host, <ExportDialog open onClose={() => undefined} sources={[ORG_DATA]} />);
    fireEvent.change(screen.getByLabelText('Organization id'), { target: { value: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    await waitFor(() => expect(host.requests).toHaveLength(1));
    expect(host.requests[0]!.body).toMatchObject({ orgId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
  });

  it('shows the API refusal and stays open', async () => {
    const { createTestApiError } = await import('../../src/testing/index.js');
    const host = hostWith({
      'POST /exports': () => {
        throw createTestApiError(429, 'too many');
      },
    });
    const onClose = vi.fn();
    renderWith(host, <ExportDialog open onClose={onClose} sources={[USER_DATA]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/several exports in progress/);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('ExportsList', () => {
  it('states status in words and downloads from a fresh signed URL', async () => {
    const host = hostWith({
      [`GET /exports/${ID}`]: view({ status: 'ready', fileName: 'a.json', download: { url: 'https://s.test/fresh', expiresAt: '2026-10-08T10:05:00.000Z' } }),
    });
    const onDownload = vi.fn();
    renderWith(
      host,
      <ExportsList
        exports={[view({ status: 'ready', sizeBytes: 2048 }), view({ id: 'b', status: 'failed', error: 'The export could not be created. Please try again.' })]}
        sources={[USER_DATA]}
        onDownload={onDownload}
      />,
    );
    expect(screen.getByText('Ready to download')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText(/could not be created/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Download Your data (JSON)' }));
    await waitFor(() => expect(onDownload).toHaveBeenCalledWith('https://s.test/fresh', expect.objectContaining({ id: ID })));
    expect(screen.getAllByRole('button', { name: /Download/ })).toHaveLength(1);
  });

  it('says when a ready export expired in the meantime', async () => {
    const host = hostWith({ [`GET /exports/${ID}`]: view({ status: 'expired' }) });
    const onDownload = vi.fn();
    renderWith(host, <ExportsList exports={[view({ status: 'ready' })]} onDownload={onDownload} />);
    fireEvent.click(screen.getByRole('button', { name: /Download/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/no longer available/);
    expect(onDownload).not.toHaveBeenCalled();
  });

  it('has an empty state', () => {
    renderWith(hostWith({}), <ExportsList exports={[]} />);
    expect(screen.getByText(/not exported anything/)).toBeInTheDocument();
  });
});

describe('DataExportPage', () => {
  it('lists recent exports and opens the dialog', async () => {
    const host = hostWith({ 'GET /exports/sources': { items: [USER_DATA] }, 'GET /exports': { items: [view({ status: 'ready' })] } });
    renderWith(host, <DataExportPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Download your data' })).toBeInTheDocument();
    expect(await screen.findByText('Ready to download')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'New export' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(screen.getByRole('dialog', { name: 'Export data' })).toBeInTheDocument();
  });

  it('is a user settings card without a permission', () => {
    expect(dataExportSettingsPage.card).toEqual({
      title: 'Download your data',
      description: expect.any(String),
      path: '/settings/data-export',
    });
    expect(dataExportSettingsPage.Page).toBe(DataExportPage);
  });
});
