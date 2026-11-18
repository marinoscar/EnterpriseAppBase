/**
 * PP-14.24: an app adds its own section to the packaged admin storage page
 * through `slots.Sections`, with no package edit.
 *
 * `apps/web/src/platform-extensions/storage/LifecycleRuleChecklist.example.tsx`
 * is the example. This renders the REAL packaged page over MSW, passes the slot
 * and asserts the section is drawn once, after the page's own controls, and
 * that the page without the slot draws nothing of it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { StorageConfigPage } from '@marinoscar/platform-web/storage/ui';
import { render, mockAdminUser } from '../../utils/test-utils';
import { server } from '../../mocks/server';
import { storageConfigFixture } from '../../mocks/fixtures/storage';
import { LifecycleRuleChecklist } from '../../../platform-extensions/storage/LifecycleRuleChecklist.example';

describe('the admin storage page with an app Sections slot (PP-14.24)', () => {
  beforeEach(() => {
    server.resetHandlers();
    server.use(http.get('*/api/admin/storage-config', () => HttpResponse.json({ data: storageConfigFixture() })));
  });

  it('draws the lifecycle checklist once, after the page content', async () => {
    render(<StorageConfigPage slots={{ Sections: LifecycleRuleChecklist }} />, { wrapperOptions: { user: mockAdminUser } });

    const section = await screen.findByRole('region', { name: 'Bucket lifecycle rules' });
    expect(within(section).getAllByRole('listitem')).toHaveLength(3);
    const save = await screen.findByRole('button', { name: /save/i });
    expect(save.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole('heading', { name: 'Bucket lifecycle rules' })).toHaveLength(1);
  });

  it('draws no such section without the slot', async () => {
    render(<StorageConfigPage />, { wrapperOptions: { user: mockAdminUser } });
    await screen.findByRole('heading', { name: 'Storage' });
    await screen.findByRole('button', { name: /save/i });
    expect(screen.queryByRole('heading', { name: 'Bucket lifecycle rules' })).not.toBeInTheDocument();
  });
});
