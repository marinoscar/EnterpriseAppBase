// SettingsHub, moved from the reference app by #733 without behavioural
// change: permission and feature gating (from props or the host viewer),
// title-only search, the two width treatments (gate 4: down('sm')), inert
// cards, and the scroll-restoration seam.
import { act, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import TuneIcon from '@mui/icons-material/Tune';
import PaletteIcon from '@mui/icons-material/Palette';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlatformHostProvider } from '../../src/core/index.js';
import { SettingsHub, visibleSettingsSections, settingsPageTitle } from '../../src/settings/ui/index.js';
import type { SettingsSectionDef } from '../../src/settings/ui/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';
import { resetViewportWidth, setViewportWidth } from '../viewport.js';

const SECTIONS: SettingsSectionDef[] = [
  {
    label: 'Kitchen',
    cards: [
      { title: 'Apple Pie', description: 'A lattice crust.', Icon: TuneIcon, path: '/s/apple' },
      { title: 'Banana Bread', description: 'Nothing apple here.', Icon: PaletteIcon, path: '/s/banana', permission: 'bake:write' },
      { title: 'Toaster Oven', description: 'Not routed yet.', Icon: TuneIcon },
    ],
  },
  {
    label: 'Lab',
    cards: [{ title: 'Robots', description: 'AI only.', Icon: TuneIcon, path: '/s/robots', feature: 'ai' }],
  },
];

function hub(props: Partial<Parameters<typeof SettingsHub>[0]> = {}, wrap?: (node: ReactNode) => ReactNode) {
  const node = <SettingsHub sections={SECTIONS} hubKey="test-hub" title="Settings" subtitle="All of them" {...props} />;
  return render(<MemoryRouter>{wrap ? wrap(node) : node}</MemoryRouter>);
}

afterEach(() => resetViewportWidth());

describe('SettingsHub', () => {
  it('renders the title, the subtitle and only the cards the viewer may see', () => {
    hub({ hasPermission: () => false });
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByText('All of them')).toBeInTheDocument();
    expect(screen.getByText('Apple Pie')).toBeInTheDocument();
    expect(screen.queryByText('Banana Bread')).not.toBeInTheDocument();
    // A feature-gated card is hidden without a feature map (fail closed).
    expect(screen.queryByText('Robots')).not.toBeInTheDocument();
    expect(screen.queryByText('Lab')).not.toBeInTheDocument();
  });

  it('reads permissions from the host viewer when no hasPermission prop is given', () => {
    const host = createTestPlatformHost({ permissions: ['bake:write'] });
    hub({}, (node) => <PlatformHostProvider host={host}>{node}</PlatformHostProvider>);
    expect(screen.getByText('Banana Bread')).toBeInTheDocument();
  });

  it('hides every permission-gated card without a host or a prop', () => {
    hub();
    expect(screen.queryByText('Banana Bread')).not.toBeInTheDocument();
  });

  it('shows a feature-gated card while its feature is on', () => {
    hub({ hasPermission: () => true, features: { ai: true } });
    expect(screen.getByText('Robots')).toBeInTheDocument();
  });

  it('searches titles only and says so on a miss', async () => {
    const user = userEvent.setup();
    hub({ hasPermission: () => true });
    await user.type(screen.getByRole('textbox', { name: 'Search settings' }), 'apple');
    expect(screen.getByText('Apple Pie')).toBeInTheDocument();
    expect(screen.queryByText('Banana Bread')).not.toBeInTheDocument();
    await user.clear(screen.getByRole('textbox', { name: 'Search settings' }));
    await user.type(screen.getByRole('textbox', { name: 'Search settings' }), 'zzz');
    expect(screen.getByText('No settings match “zzz”.')).toBeInTheDocument();
  });

  it('renders a drill-down list below sm (gate 4) and a card grid from sm up', () => {
    act(() => setViewportWidth(375));
    const { unmount } = hub({ hasPermission: () => true });
    expect(screen.getAllByRole('button').some((b) => within(b).queryByText('Apple Pie'))).toBe(true);
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
    unmount();
    act(() => setViewportWidth(600));
    hub({ hasPermission: () => true });
    // The inert card is no button at all on the grid.
    expect(screen.getAllByRole('button').some((b) => within(b).queryByText('Toaster Oven'))).toBe(false);
  });

  it('calls the scroll-restoration seam with its hub key', () => {
    const useScrollRestoration = vi.fn();
    hub({ useScrollRestoration });
    expect(useScrollRestoration).toHaveBeenCalledWith('test-hub');
  });
});

describe('the registry helpers', () => {
  it('drop an emptied section and resolve titles by longest prefix', () => {
    expect(visibleSettingsSections(SECTIONS, () => false).map((s) => s.label)).toEqual(['Kitchen']);
    expect(settingsPageTitle(SECTIONS, '/s', 'Hub', '/s/apple/edit')).toBe('Apple Pie');
    expect(settingsPageTitle(SECTIONS, '/s', 'Hub', '/s/robots')).toBe('Hub');
    expect(settingsPageTitle(SECTIONS, '/s', 'Hub', '/s/robots', { ai: true })).toBe('Robots');
    expect(settingsPageTitle(SECTIONS, '/s', 'Hub', '/elsewhere')).toBeNull();
  });
});
