import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { OrgOffboardingSummary } from '@marinoscar/platform-contract/user-data';

import { DANGER_ZONE_GROUP_LABEL, dangerZoneLastViolations } from '../../src/user-data/headless/index.js';
import { OffboardOrganizationButton, dangerZoneSettingsPage, factoryResetSettingsPage } from '../../src/user-data/ui/index.js';
import { hostWith, renderWithHost } from './fixtures.js';

const ORG = { id: 'o-1', name: 'Acme', slug: 'acme', isDefault: false };
const SUMMARY: OrgOffboardingSummary = {
  org: { id: ORG.id, name: ORG.name, slug: ORG.slug, isDefault: false },
  blockedReason: null,
  models: { AiRun: 3 },
  members: 2,
  invites: 1,
  storageObjects: 5,
  usersLeftWithoutOrg: 1,
  preconditions: [{ id: 'recent-export', label: 'A recent export', passed: false, message: 'none in 7 days' }],
};

describe('OffboardOrganizationButton', () => {
  it('is hidden without orgs:offboard and for the default organization', () => {
    renderWithHost(hostWith({}, []), <OffboardOrganizationButton organization={ORG} />);
    expect(screen.queryByRole('button', { name: 'Offboard' })).not.toBeInTheDocument();
    renderWithHost(hostWith({}, ['orgs:offboard']), <OffboardOrganizationButton organization={{ ...ORG, isDefault: true }} />);
    expect(screen.queryByRole('button', { name: 'Offboard' })).not.toBeInTheDocument();
  });

  it('asks for a skip reason when a precondition fails, the slug as the phrase, and sends the disposition', async () => {
    const user = userEvent.setup();
    const host = hostWith(
      {
        'GET /admin/orgs/o-1/offboarding/summary': SUMMARY,
        'POST /admin/orgs/o-1/offboarding': { jobId: 'j', status: 'pending' },
        'GET /admin/orgs/o-1/offboarding/j': { jobId: 'j', status: 'succeeded', result: { counts: { memberships: 2 } }, error: null },
      },
      ['orgs:offboard'],
    );
    renderWithHost(host, <OffboardOrganizationButton organization={ORG} />);
    await user.click(screen.getByRole('button', { name: 'Offboard' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/none in 7 days/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('checkbox'));
    await user.type(within(dialog).getByLabelText(/Type acme/), 'acme');
    const confirm = within(dialog).getByRole('button', { name: 'Offboard' });
    expect(confirm).toBeDisabled(); // the skip reason is missing
    await user.type(within(dialog).getByLabelText(/Why go ahead anyway/), 'exported by the customer');
    await user.click(within(dialog).getByLabelText(/Delete their data and their accounts/));
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(await within(dialog).findByText('Done.', undefined, { timeout: 8000 })).toBeInTheDocument();
    expect(host.requests.find((r) => r.method === 'POST')?.body).toEqual({
      confirmation: 'acme',
      userDisposition: 'purge',
      skipExport: { reason: 'exported by the customer' },
    });
  });
});

describe('the Danger Zone groups', () => {
  const card = (path: string) => ({ path });
  it('pass when the group is last and holds the card', () => {
    expect(dangerZoneLastViolations([{ label: 'Account', cards: [] }, { label: DANGER_ZONE_GROUP_LABEL, cards: [card('/x')] }], '/x')).toEqual([]);
  });

  it('report a group that is not last, missing, doubled or without its card', () => {
    expect(dangerZoneLastViolations([{ label: DANGER_ZONE_GROUP_LABEL, cards: [card('/x')] }, { label: 'Later', cards: [] }], '/x')[0]).toMatch(/not the last/);
    expect(dangerZoneLastViolations([{ label: 'Account', cards: [] }], '/x')).toEqual(['no "Danger Zone" group']);
    expect(dangerZoneLastViolations([{ label: DANGER_ZONE_GROUP_LABEL, cards: [] }], '/x')[0]).toMatch(/no card/);
  });

  it('describe the two packaged cards with the exact API permission', () => {
    expect(dangerZoneSettingsPage.card).toEqual(expect.objectContaining({ path: '/settings/danger-zone' }));
    expect(dangerZoneSettingsPage.card.permission).toBeUndefined();
    expect(dangerZoneSettingsPage.card.feature).toBeUndefined();
    expect(factoryResetSettingsPage.card).toEqual(expect.objectContaining({ path: '/admin/settings/factory-reset', permission: 'system:factory_reset' }));
  });
});
