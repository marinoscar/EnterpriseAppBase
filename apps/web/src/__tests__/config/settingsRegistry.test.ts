import { describe, it, expect } from 'vitest';
import TuneIcon from '@mui/icons-material/Tune';
import {
  ADMIN_SECTIONS,
  ADMIN_HUB_PATH,
  ADMIN_HUB_TITLE,
  visibleSettingsSections,
  settingsPageTitle,
} from '../../config/adminSections';
import type { SettingsSectionDef } from '../../config/adminSections';
import {
  USER_SETTINGS_SECTIONS,
  USER_HUB_PATH,
  USER_HUB_TITLE,
} from '../../config/userSettingsSections';

/**
 * Issue #91, epic #90 — `visibleSettingsSections` and `settingsPageTitle` are
 * the ONE gate every consumer (hub, rail, AppBar title) runs. A bug here is a
 * bug in three surfaces at once, and this suite is what makes that provable
 * with a single assertion per behavior instead of three near-identical
 * component tests.
 *
 * `visibleSettingsSections` is exercised two ways:
 *   - against a small local FIXTURE, for the cases that need independent
 *     control over `permission` / `alwaysShow` (ADMIN_SECTIONS today has no
 *     `alwaysShow` card, and no card with an undeniable permission either);
 *   - against the REAL `ADMIN_SECTIONS` / `USER_SETTINGS_SECTIONS`, for the
 *     cases that are really about the real data (title-vs-description search,
 *     and "it works for the user registry too").
 */

/** A real Icon component, reused across the fixture — only its identity is asserted anywhere, so one is enough. */
const Icon = TuneIcon;

function buildFixture(): SettingsSectionDef[] {
  return [
    {
      label: 'Alpha',
      cards: [
        { title: 'Open Card', description: 'visible to anyone, no gate', Icon, path: '/x/open' },
        {
          title: 'Gated Card',
          description: 'needs a permission the fixture can deny',
          Icon,
          path: '/x/gated',
          permission: 'alpha:read',
        },
        {
          title: 'Bypass Card',
          description: 'gated, but escapes the gate via alwaysShow',
          Icon,
          path: '/x/bypass',
          permission: 'alpha:write',
          alwaysShow: true,
        },
      ],
    },
    {
      label: 'Beta (fully gated)',
      cards: [
        {
          title: 'Beta Only',
          description: 'the only card in its section, and it is gated',
          Icon,
          path: '/x/beta',
          permission: 'beta:read',
        },
      ],
    },
  ];
}

function titlesOf(sections: SettingsSectionDef[]): string[] {
  return sections.flatMap((section) => section.cards.map((card) => card.title));
}

describe('visibleSettingsSections — permission gating', () => {
  it('drops a card whose permission is not held', () => {
    const result = visibleSettingsSections(buildFixture(), () => false);

    expect(titlesOf(result)).not.toContain('Gated Card');
  });

  it('removes a section entirely once every one of its cards is filtered out, rather than rendering it empty', () => {
    // 'Beta Only' is the section's sole card and is gated, so with every
    // permission denied the whole section must disappear — not survive as a
    // header over zero cards, which reads as a loading failure.
    const result = visibleSettingsSections(buildFixture(), () => false);

    expect(result.find((section) => section.label === 'Beta (fully gated)')).toBeUndefined();
  });

  it('lets alwaysShow bypass the permission gate', () => {
    const result = visibleSettingsSections(buildFixture(), () => false);

    expect(titlesOf(result)).toContain('Bypass Card');
  });

  it('shows a card with no permission declared regardless of what hasPermission answers', () => {
    const result = visibleSettingsSections(buildFixture(), () => false);

    expect(titlesOf(result)).toContain('Open Card');
  });
});

describe('visibleSettingsSections — search', () => {
  it('matches a card title case-insensitively', () => {
    // Grant everything so the search filter is the only thing under test.
    const result = visibleSettingsSections(ADMIN_SECTIONS, () => true, 'sYsTeM');

    expect(titlesOf(result)).toContain('System');
  });

  it('does not match a term that appears only in the description, never the title', () => {
    // "System"'s description reads "...application behavior..." — "behavior"
    // is in no card TITLE in ADMIN_SECTIONS. Matching descriptions too would
    // mean a two-letter query surfacing cards on prose the user never sees
    // highlighted, which `visibleSettingsSections`'s own doc comment calls out
    // as the worse, unpredictable result set this design avoids.
    const result = visibleSettingsSections(ADMIN_SECTIONS, () => true, 'behavior');

    expect(titlesOf(result)).toHaveLength(0);
  });

  it('composes with permission gating: a title match the user lacks permission for stays hidden', () => {
    // 'gated' matches only 'Gated Card' by title in the fixture. It is denied
    // and not alwaysShow, so the hit must not surface — search narrows what is
    // ELIGIBLE to show, it never re-opens a closed permission gate.
    const result = visibleSettingsSections(buildFixture(), () => false, 'gated');

    expect(result).toEqual([]);
  });

  it('treats an empty string query the same as no query argument at all', () => {
    const hasPermission = (permission: string) => permission === 'alpha:read';
    const fixture = buildFixture();

    expect(visibleSettingsSections(fixture, hasPermission, '')).toEqual(
      visibleSettingsSections(fixture, hasPermission),
    );
  });

  it('treats a whitespace-only query the same as no query argument at all', () => {
    const hasPermission = (permission: string) => permission === 'alpha:read';
    const fixture = buildFixture();

    expect(visibleSettingsSections(fixture, hasPermission, '   ')).toEqual(
      visibleSettingsSections(fixture, hasPermission),
    );
  });
});

describe('visibleSettingsSections — works identically against USER_SETTINGS_SECTIONS', () => {
  it('shows every user-settings card, since none of them declare a permission', () => {
    const result = visibleSettingsSections(USER_SETTINGS_SECTIONS, () => false);

    expect(titlesOf(result).sort()).toEqual(titlesOf(USER_SETTINGS_SECTIONS).sort());
  });

  it('still matches by title only for the user registry', () => {
    // Profile's description reads "Your display name and profile image..." —
    // "display" is in no user-settings card title.
    const byDescriptionOnly = visibleSettingsSections(USER_SETTINGS_SECTIONS, () => false, 'display');
    expect(titlesOf(byDescriptionOnly)).toHaveLength(0);

    const byTitle = visibleSettingsSections(USER_SETTINGS_SECTIONS, () => false, 'profile');
    expect(titlesOf(byTitle)).toContain('Profile');
  });
});

/**
 * Issue #225, epic #215. The `Notifications` page is a registry CARD, never a
 * fourth tab on an existing settings page — `CLAUDE.md`'s mandatory settings-UI
 * rule 1, stated as an assertion: a route with no registry entry is one the hub,
 * the Console rail and the AppBar title resolver all disagree about, because
 * none of the three has any way to learn it exists.
 *
 * The route/permission agreement with `App.tsx` is asserted generically for
 * every card in `destinations.test.ts`; what is pinned here is this card's own
 * identity, and that the gate genuinely denies.
 */
describe('the Notifications card (#225)', () => {
  const card = ADMIN_SECTIONS.flatMap((section) => section.cards).find(
    (entry) => entry.title === 'Notifications',
  );

  it('is declared in ADMIN_SECTIONS', () => {
    expect(card).toBeDefined();
  });

  it('routes to /admin/settings/notifications', () => {
    expect(card?.path).toBe('/admin/settings/notifications');
  });

  it('declares the exact permission the API enforces on GET /api/system-settings', () => {
    // `system-settings.controller.ts` — the same document this page edits, and
    // the same string its three sibling cards mirror. The registry never
    // invents a permission.
    expect(card?.permission).toBe('system_settings:read');
  });

  it('is not an alwaysShow escape hatch — the gate must be able to deny it', () => {
    expect(card?.alwaysShow).toBeUndefined();
  });

  it('appears for an admin holding system_settings:read', () => {
    const result = visibleSettingsSections(
      ADMIN_SECTIONS,
      (permission) => permission === 'system_settings:read',
    );

    expect(titlesOf(result)).toContain('Notifications');
  });

  it('appears in none of the three surfaces for a viewer', () => {
    // A viewer holds `user_settings:*` only. One assertion covers the hub, the
    // rail and the title resolver because all three run this same function.
    const viewerPermissions = ['user_settings:read', 'user_settings:write'];
    const result = visibleSettingsSections(ADMIN_SECTIONS, (permission) =>
      viewerPermissions.includes(permission),
    );

    expect(titlesOf(result)).not.toContain('Notifications');
  });

  it('resolves its route to its own title, not the hub title', () => {
    expect(
      settingsPageTitle(
        ADMIN_SECTIONS,
        ADMIN_HUB_PATH,
        ADMIN_HUB_TITLE,
        '/admin/settings/notifications',
      ),
    ).toBe('Notifications');
  });
});

describe('settingsPageTitle', () => {
  it('resolves an exact card path to its title', () => {
    expect(settingsPageTitle(ADMIN_SECTIONS, ADMIN_HUB_PATH, ADMIN_HUB_TITLE, '/admin/settings/users')).toBe(
      'Users & Allowlist',
    );
  });

  it('gives the longest matching prefix the win on a nested child path', () => {
    expect(
      settingsPageTitle(ADMIN_SECTIONS, ADMIN_HUB_PATH, ADMIN_HUB_TITLE, '/admin/settings/users/123'),
    ).toBe('Users & Allowlist');
  });

  it('respects segment boundaries: a path that only starts with a card path falls back to the hub title', () => {
    // Per the function's own doc comment, `/admin/settings/users-archive` must
    // NOT resolve to "Users & Allowlist" — but it IS still under the hub
    // (`/admin/settings/...`), so the correct answer is the hub title, not
    // null. A bare `startsWith` on the card path is the exact bug
    // `destinations.ts`'s `owns()` was written to kill, reintroduced here.
    expect(
      settingsPageTitle(ADMIN_SECTIONS, ADMIN_HUB_PATH, ADMIN_HUB_TITLE, '/admin/settings/users-archive'),
    ).toBe(ADMIN_HUB_TITLE);
  });

  it('returns the hub title for the hub path itself', () => {
    expect(settingsPageTitle(ADMIN_SECTIONS, ADMIN_HUB_PATH, ADMIN_HUB_TITLE, ADMIN_HUB_PATH)).toBe(
      ADMIN_HUB_TITLE,
    );
  });

  it('returns the hub title for a child path under the hub that no card owns', () => {
    expect(
      settingsPageTitle(ADMIN_SECTIONS, ADMIN_HUB_PATH, ADMIN_HUB_TITLE, '/admin/settings/whatever-not-a-card-path'),
    ).toBe(ADMIN_HUB_TITLE);
  });

  describe('returns null for a path not under hubPath at all', () => {
    it('the app root', () => {
      expect(settingsPageTitle(ADMIN_SECTIONS, ADMIN_HUB_PATH, ADMIN_HUB_TITLE, '/')).toBeNull();
    });

    it('a sibling under /admin that is not the settings hub', () => {
      expect(settingsPageTitle(ADMIN_SECTIONS, ADMIN_HUB_PATH, ADMIN_HUB_TITLE, '/admin')).toBeNull();
    });

    it('cross-registry: the admin registry does not claim a user-settings path', () => {
      // /settings/profile belongs to the OTHER hub. Without the hubPath guard,
      // nothing here would stop a coincidental card-path collision from
      // resolving a title that belongs to the wrong surface.
      expect(settingsPageTitle(ADMIN_SECTIONS, ADMIN_HUB_PATH, ADMIN_HUB_TITLE, '/settings/profile')).toBeNull();
    });

    it('cross-registry: the user registry does not claim an admin-settings path', () => {
      expect(
        settingsPageTitle(USER_SETTINGS_SECTIONS, USER_HUB_PATH, USER_HUB_TITLE, '/admin/settings/users'),
      ).toBeNull();
    });
  });
});
