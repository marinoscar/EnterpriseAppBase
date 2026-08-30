import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render, mockAdminUser } from '../../utils/test-utils';
import { setViewportWidth } from '../../setup';
import { NavigationRail } from '../../../components/navigation/NavigationRail';

/**
 * Coverage migrated from the deleted `Sidebar.test.tsx` — four items, admin
 * gating, active highlight, navigate-on-click — plus what the rail adds that a
 * temporary drawer never had: two width treatments, a persisted collapse
 * preference, and real links.
 */

vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}));

vi.mock('../../../hooks/useNavigationPrefs', () => ({
  useNavigationPrefs: vi.fn(),
}));

import { usePermissions } from '../../../hooks/usePermissions';
import { useNavigationPrefs } from '../../../hooks/useNavigationPrefs';

const mockUsePermissions = vi.mocked(usePermissions);
const mockUseNavigationPrefs = vi.mocked(useNavigationPrefs);

const toggleRailCollapsed = vi.fn();

function setPermissions(granted: string[], isAdmin = false) {
  mockUsePermissions.mockReturnValue({
    permissions: new Set(granted),
    roles: new Set(isAdmin ? ['admin'] : ['viewer']),
    hasPermission: (perm: string) => granted.includes(perm),
    hasAnyPermission: vi.fn(),
    hasAllPermissions: vi.fn(),
    hasRole: vi.fn(),
    hasAnyRole: vi.fn(),
    isAdmin,
  });
}

function setPrefs(railCollapsed: boolean) {
  mockUseNavigationPrefs.mockReturnValue({
    railCollapsed,
    toggleRailCollapsed,
    isLoading: false,
  });
}

const ADMIN_PERMISSIONS = ['users:read', 'system_settings:read'];

describe('NavigationRail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPermissions([]);
    setPrefs(false);
  });

  describe('Destinations', () => {
    it('renders all three destinations for a fully permitted user', () => {
      // THREE, not four: issue #92 merged `User Management` and `System
      // Settings` into one `Console` row, because two rows both matching
      // `/admin/*` give the rail two active candidates on every admin route.
      setPermissions(ADMIN_PERMISSIONS, true);

      render(<NavigationRail />, { wrapperOptions: { user: mockAdminUser } });

      const nav = screen.getByRole('navigation', { name: /main navigation/i });
      expect(within(nav).getAllByRole('link')).toHaveLength(3);
      expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'User Settings' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Console' })).toBeInTheDocument();
    });

    it('hides Console from a user holding neither admin permission', () => {
      render(<NavigationRail />);

      expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'User Settings' })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Console' })).not.toBeInTheDocument();
    });

    it('gates on PERMISSION, not on the admin role', () => {
      // The bug this replaces: the old Sidebar gated on the `admin` role while
      // UserMenu gated on `system_settings:read`, so a Contributor granted that
      // permission got a menu entry and a working page with no route in.
      setPermissions(['system_settings:read'], false);

      render(<NavigationRail />);

      expect(screen.getByRole('link', { name: 'Console' })).toBeInTheDocument();
    });

    it('shows Console on users:read alone', () => {
      // The half of `anyPermission` that a single-string gate would have
      // dropped: this user can administer users but not system settings, and
      // the surface is still worth reaching for the Users & Allowlist page.
      setPermissions(['users:read'], false);

      render(<NavigationRail />);

      expect(screen.getByRole('link', { name: 'Console' })).toBeInTheDocument();
    });
  });

  describe('Links, not click handlers', () => {
    it('renders each row as a real anchor with an href', () => {
      // An onClick div gives up focus, middle-click and tab order — and needed
      // the `setTimeout(() => navigate(path), 0)` the drawer forced on it.
      setPermissions(ADMIN_PERMISSIONS, true);

      render(<NavigationRail />, { wrapperOptions: { user: mockAdminUser } });

      expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
      expect(screen.getByRole('link', { name: 'User Settings' })).toHaveAttribute(
        'href',
        '/settings',
      );
      expect(screen.getByRole('link', { name: 'Console' })).toHaveAttribute(
        'href',
        '/admin/settings',
      );
    });

    it('navigates on click without any deferred timer', async () => {
      const user = userEvent.setup();
      render(<NavigationRail />, { wrapperOptions: { route: '/' } });

      await user.click(screen.getByRole('link', { name: 'User Settings' }));

      await waitFor(() => {
        expect(screen.getByRole('link', { name: 'User Settings' })).toHaveAttribute(
          'aria-current',
          'page',
        );
      });
    });
  });

  describe('Active state', () => {
    it('marks the active destination with aria-current="page"', () => {
      render(<NavigationRail />, { wrapperOptions: { route: '/settings' } });

      expect(screen.getByRole('link', { name: 'User Settings' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
    });

    it('marks exactly one row active on a nested admin route', () => {
      setPermissions(ADMIN_PERMISSIONS, true);

      // A genuinely nested settings route (#92), not just `/admin/settings`:
      // Console owns the whole `/admin` subtree, so this is where two admin
      // rows would have produced two `aria-current` attributes.
      render(<NavigationRail />, {
        wrapperOptions: { route: '/admin/settings/users', user: mockAdminUser },
      });

      const current = screen
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page');
      expect(current).toHaveLength(1);
      // Not 'Console' any more (#94): at >= lg this route is Console mode, so
      // the `Console` destination row is absent entirely and the active row is
      // the longest-prefix-matching admin card — `Users & Allowlist`
      // (`/admin/settings/users`) — rather than the library destination that
      // used to own the whole `/admin` subtree. The one-`aria-current`
      // invariant above is what this test actually guards and is unchanged.
      expect(current[0]).toHaveAccessibleName('Users & Allowlist');
    });

    it('marks nothing active on a route no destination owns', () => {
      // `/settingsfoo` would match under the old `startsWith` isActive.
      render(<NavigationRail />, { wrapperOptions: { route: '/settingsfoo' } });

      const current = screen
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page');
      expect(current).toHaveLength(0);
    });
  });

  describe('Two treatments', () => {
    it('shows full labels as visible text at >= lg', () => {
      render(<NavigationRail />);

      expect(screen.getByText('User Settings')).toBeInTheDocument();
      expect(screen.queryByText('Settings')).not.toBeInTheDocument();
    });

    it('shows compact captions below lg, with the full label still accessible', async () => {
      render(<NavigationRail />);

      await act(async () => setViewportWidth(800));

      // The caption is aria-hidden; the accessible name is still the full label,
      // so the row is findable by it either way.
      expect(screen.getByText('Settings')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'User Settings' })).toBeInTheDocument();
    });

    it('stays collapsed below lg even when the stored preference says expanded', async () => {
      // Honouring `railCollapsed: false` at 800px would render a 220px rail on
      // a screen that has room for 56.
      setPrefs(false);
      render(<NavigationRail />);

      await act(async () => setViewportWidth(800));

      expect(screen.getByText('Settings')).toBeInTheDocument();
      expect(screen.queryByText('User Settings')).not.toBeInTheDocument();
    });

    it('honours the stored collapse preference at >= lg', () => {
      setPrefs(true);

      render(<NavigationRail />);

      expect(screen.getByText('Settings')).toBeInTheDocument();
      expect(screen.queryByText('User Settings')).not.toBeInTheDocument();
    });
  });

  describe('Collapse toggle', () => {
    it('is a real button carrying aria-expanded', () => {
      render(<NavigationRail />);

      const toggle = screen.getByRole('button', { name: /collapse navigation/i });
      expect(toggle.tagName).toBe('BUTTON');
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
    });

    it('reports aria-expanded=false when the rail is collapsed', () => {
      setPrefs(true);

      render(<NavigationRail />);

      const toggle = screen.getByRole('button', { name: /expand navigation/i });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });

    it('calls the persisted toggle on click', async () => {
      const user = userEvent.setup();
      render(<NavigationRail />);

      await user.click(screen.getByRole('button', { name: /collapse navigation/i }));

      expect(toggleRailCollapsed).toHaveBeenCalledTimes(1);
    });

    it('is desktop-only — the medium tier is forced collapsed, so a toggle there would lie', async () => {
      render(<NavigationRail />);

      await act(async () => setViewportWidth(800));

      expect(screen.queryByRole('button', { name: /navigation/i })).not.toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('is a nav landmark with an accessible name', () => {
      render(<NavigationRail />);

      expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    });

    it('keeps DOM order equal to visual order, so focus order follows it', () => {
      setPermissions(ADMIN_PERMISSIONS, true);

      render(<NavigationRail />, { wrapperOptions: { user: mockAdminUser } });

      expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
        '/',
        '/settings',
        '/admin/settings',
      ]);
    });
  });

  describe('Console mode (#94)', () => {
    // A user holding every admin permission, so a section is never dropped by
    // `visibleSettingsSections` — the gating tests below flip permissions off
    // one at a time instead.
    const FULL_ADMIN_PERMISSIONS = [
      'system_settings:read',
      'system_settings:write',
      'users:read',
    ];

    describe('renders', () => {
      beforeEach(() => {
        setPermissions(FULL_ADMIN_PERMISSIONS, true);
      });

      it('renders both group headers', () => {
        render(<NavigationRail />, {
          wrapperOptions: { route: '/admin/settings/users', user: mockAdminUser },
        });

        expect(screen.getByText('General')).toBeInTheDocument();
        expect(screen.getByText('Access')).toBeInTheDocument();
      });

      it('renders the card rows with their titles', () => {
        render(<NavigationRail />, {
          wrapperOptions: { route: '/admin/settings/users', user: mockAdminUser },
        });

        expect(screen.getByRole('link', { name: 'System' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Appearance' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Feature Flags' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Advanced (JSON)' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Users & Allowlist' })).toBeInTheDocument();
      });

      it('renders a permanent Back to library row linking to /', () => {
        render(<NavigationRail />, {
          wrapperOptions: { route: '/admin/settings/users', user: mockAdminUser },
        });

        expect(screen.getByRole('link', { name: 'Back to library' })).toHaveAttribute(
          'href',
          '/',
        );
      });

      it('hides the Console destination row — Back to library is the way out instead', () => {
        render(<NavigationRail />, {
          wrapperOptions: { route: '/admin/settings/users', user: mockAdminUser },
        });

        expect(screen.queryByRole('link', { name: 'Console' })).not.toBeInTheDocument();
      });

      it('names the nav landmark "Console navigation"', () => {
        render(<NavigationRail />, {
          wrapperOptions: { route: '/admin/settings/users', user: mockAdminUser },
        });

        expect(
          screen.getByRole('navigation', { name: 'Console navigation' }),
        ).toBeInTheDocument();
      });
    });

    describe('does not engage outside expanded desktop', () => {
      it('stays library navigation at sm-lg on the same /admin/* path — the expanded-only rule', async () => {
        // The rule most likely to be "fixed" into always-on later: Console mode
        // is `isConsole && expanded`, never `isConsole` alone. A 56px column
        // cannot host labelled group headers (see the file header), so the
        // medium tier keeps library destinations even under `/admin`.
        setPermissions(FULL_ADMIN_PERMISSIONS, true);
        render(<NavigationRail />, {
          wrapperOptions: { route: '/admin/settings/users', user: mockAdminUser },
        });

        await act(async () => setViewportWidth(800));

        expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Console' })).toBeInTheDocument();
        expect(
          screen.queryByRole('link', { name: 'Users & Allowlist' }),
        ).not.toBeInTheDocument();
      });

      it('stays library navigation when a desktop user has collapsed the rail, on the same /admin/* path', () => {
        setPermissions(FULL_ADMIN_PERMISSIONS, true);
        setPrefs(true);
        render(<NavigationRail />, {
          wrapperOptions: { route: '/admin/settings/users', user: mockAdminUser },
        });

        expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Console' })).toBeInTheDocument();
        expect(
          screen.queryByRole('link', { name: 'Users & Allowlist' }),
        ).not.toBeInTheDocument();
      });

      it.each(['/', '/settings'])(
        'stays library navigation on the non-admin route %s at >= lg',
        (route) => {
          setPermissions(FULL_ADMIN_PERMISSIONS, true);
          render(<NavigationRail />, { wrapperOptions: { route, user: mockAdminUser } });

          expect(
            screen.getByRole('navigation', { name: 'Main navigation' }),
          ).toBeInTheDocument();
          expect(screen.getByRole('link', { name: 'Console' })).toBeInTheDocument();
        },
      );
    });

    describe('active state', () => {
      beforeEach(() => {
        setPermissions(FULL_ADMIN_PERMISSIONS, true);
      });

      it('marks exactly one row active on /admin/settings/users, and it is Users & Allowlist', () => {
        // A plain `owns()` per card would light up more than one row here —
        // see the `longest prefix wins` comment on `consoleActivePath`.
        render(<NavigationRail />, {
          wrapperOptions: { route: '/admin/settings/users', user: mockAdminUser },
        });

        const current = screen
          .getAllByRole('link')
          .filter((link) => link.getAttribute('aria-current') === 'page');
        expect(current).toHaveLength(1);
        expect(current[0]).toHaveAccessibleName('Users & Allowlist');
      });

      it('marks nothing active on the hub path /admin/settings itself', () => {
        // No card's own path matches the hub path, and `Back to library` is
        // explicitly `active={false}` — so nothing should carry aria-current.
        render(<NavigationRail />, {
          wrapperOptions: { route: '/admin/settings', user: mockAdminUser },
        });

        const current = screen
          .getAllByRole('link')
          .filter((link) => link.getAttribute('aria-current') === 'page');
        expect(current).toHaveLength(0);
      });

      it('keeps Users & Allowlist active on a nested child route', () => {
        render(<NavigationRail />, {
          wrapperOptions: { route: '/admin/settings/users/123', user: mockAdminUser },
        });

        const current = screen
          .getAllByRole('link')
          .filter((link) => link.getAttribute('aria-current') === 'page');
        expect(current).toHaveLength(1);
        expect(current[0]).toHaveAccessibleName('Users & Allowlist');
      });
    });

    describe('permission gating', () => {
      it('shows ACCESS and Users & Allowlist, and hides GENERAL entirely, for users:read alone', () => {
        // Not just "the General cards are absent" — the emptied `General`
        // header must be gone too, since a bare header above nothing reads as
        // a loading failure rather than "you may see none of these"
        // (`visibleSettingsSections` drops empty sections).
        setPermissions(['users:read'], false);

        render(<NavigationRail />, { wrapperOptions: { route: '/admin/settings/users' } });

        expect(screen.getByText('Access')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Users & Allowlist' })).toBeInTheDocument();

        expect(screen.queryByText('General')).not.toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'System' })).not.toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Appearance' })).not.toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Feature Flags' })).not.toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Advanced (JSON)' })).not.toBeInTheDocument();
      });

      it('hides Advanced (JSON) for system_settings:read without :write', () => {
        // `Advanced (JSON)` gates on WRITE deliberately, unlike its three
        // General siblings — a raw editor is meaningless to a user who cannot
        // save.
        setPermissions(['system_settings:read'], false);

        render(<NavigationRail />, { wrapperOptions: { route: '/admin/settings/users' } });

        expect(screen.getByRole('link', { name: 'System' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Appearance' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Feature Flags' })).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Advanced (JSON)' })).not.toBeInTheDocument();
      });
    });
  });
});
