/**
 * PP-14.24: an app adds its own section to the packaged admin email page through
 * `slots.Sections`, with no package edit.
 *
 * `apps/web/src/platform-extensions/email/DnsChecklistSection.example.tsx` is the
 * example. This renders the REAL packaged page over MSW, passes the slot and
 * asserts the section is drawn once, after the page's own controls, and that the
 * page without the slot draws nothing of it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { EmailSettingsPage } from '@marinoscar/platform-web/email/ui';
import { render, mockAdminUser } from '../../utils/test-utils';
import { server } from '../../mocks/server';
import { emailSettingsWithLogTransport } from '../../mocks/fixtures/email';
import { DnsChecklistSection } from '../../../platform-extensions/email/DnsChecklistSection.example';

describe('the admin email page with an app Sections slot (PP-14.24)', () => {
  beforeEach(() => {
    server.resetHandlers();
    server.use(http.get('*/api/email-settings', () => HttpResponse.json({ data: emailSettingsWithLogTransport() })));
  });

  it('draws the DNS checklist once, after the page content', async () => {
    render(<EmailSettingsPage slots={{ Sections: DnsChecklistSection }} />, { wrapperOptions: { user: mockAdminUser } });

    const section = await screen.findByRole('region', { name: 'Sending domain DNS records' });
    expect(within(section).getAllByRole('listitem')).toHaveLength(3);
    const save = await screen.findByRole('button', { name: /save/i });
    expect(save.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('draws no such section without the slot', async () => {
    render(<EmailSettingsPage />, { wrapperOptions: { user: mockAdminUser } });
    await screen.findByRole('heading', { name: 'Email' });
    await screen.findByRole('button', { name: /save/i });
    expect(screen.queryByRole('heading', { name: 'Sending domain DNS records' })).not.toBeInTheDocument();
  });
});
