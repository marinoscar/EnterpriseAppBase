// The hub's any-of card permission (#738): a card's `permission` may be a
// list, and the card shows to a viewer holding ANY ONE of its strings. The
// `Broadcasts` card is the case it exists for: one destination, two controller
// permissions (`broadcasts:read` for a system administrator, the org-scoped
// `org_broadcasts:read` for an organization administrator), never a second
// card for the same page.
import { render, screen } from '@testing-library/react';
import CampaignIcon from '@mui/icons-material/Campaign';
import TuneIcon from '@mui/icons-material/Tune';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { PlatformHostProvider } from '../../src/core/index.js';
import { SettingsHub, cardPermissionGranted, visibleSettingsSections } from '../../src/settings/ui/index.js';
import type { SettingsSectionDef } from '../../src/settings/ui/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';

const BROADCASTS = ['broadcasts:read', 'org_broadcasts:read'] as const;

const SECTIONS: SettingsSectionDef[] = [
  {
    label: 'Operations',
    cards: [
      { title: 'Broadcasts', description: 'Announce.', Icon: CampaignIcon, path: '/admin/settings/broadcasts', permission: BROADCASTS },
      { title: 'Jobs', description: 'Queue.', Icon: TuneIcon, path: '/admin/settings/jobs', permission: 'jobs:read' },
    ],
  },
];

const holding = (...held: string[]) => (permission: string) => held.includes(permission);

describe('cardPermissionGranted', () => {
  it('admits everyone without a gate', () => {
    expect(cardPermissionGranted(undefined, holding())).toBe(true);
  });

  it('needs the one permission of a string gate', () => {
    expect(cardPermissionGranted('jobs:read', holding('jobs:read'))).toBe(true);
    expect(cardPermissionGranted('jobs:read', holding('jobs:write'))).toBe(false);
  });

  it('admits a holder of ANY ONE permission of a list', () => {
    expect(cardPermissionGranted(BROADCASTS, holding('broadcasts:read'))).toBe(true);
    expect(cardPermissionGranted(BROADCASTS, holding('org_broadcasts:read'))).toBe(true);
    expect(cardPermissionGranted(BROADCASTS, holding('broadcasts:read', 'org_broadcasts:read'))).toBe(true);
  });

  it('refuses a viewer holding none of the list', () => {
    expect(cardPermissionGranted(BROADCASTS, holding('broadcasts:write', 'jobs:read'))).toBe(false);
  });

  it('fails closed on an empty list', () => {
    expect(cardPermissionGranted([], holding('broadcasts:read'))).toBe(false);
  });
});

describe('visibleSettingsSections with an any-of card', () => {
  const titles = (held: string[]) =>
    visibleSettingsSections(SECTIONS, holding(...held)).flatMap((section) => section.cards.map((card) => card.title));

  it('shows the Broadcasts card to a system administrator', () => {
    expect(titles(['broadcasts:read'])).toEqual(['Broadcasts']);
  });

  it('shows the Broadcasts card to an organization administrator holding only the org permission', () => {
    expect(titles(['org_broadcasts:read'])).toEqual(['Broadcasts']);
  });

  it('leaves a string-gated card exactly as before', () => {
    expect(titles(['jobs:read'])).toEqual(['Jobs']);
    expect(titles([])).toEqual([]);
  });
});

describe('SettingsHub with an any-of card', () => {
  it('renders the card for a host viewer holding only the org permission', () => {
    const host = createTestPlatformHost({ permissions: ['org_broadcasts:read'] });
    render(
      <MemoryRouter>
        <PlatformHostProvider host={host}>
          <SettingsHub sections={SECTIONS} hubKey="any-of" title="Console" subtitle="Admin" />
        </PlatformHostProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText('Broadcasts')).toBeInTheDocument();
    expect(screen.queryByText('Jobs')).not.toBeInTheDocument();
  });

  it('hides the card from a viewer holding neither permission', () => {
    render(
      <MemoryRouter>
        <SettingsHub sections={SECTIONS} hubKey="any-of" title="Console" subtitle="Admin" hasPermission={holding('jobs:read')} />
      </MemoryRouter>,
    );
    expect(screen.queryByText('Broadcasts')).not.toBeInTheDocument();
    expect(screen.getByText('Jobs')).toBeInTheDocument();
  });
});
