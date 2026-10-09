import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  ADMIN_SECTIONS,
  ADMIN_HUB_PATH,
  ADMIN_HUB_TITLE,
} from '../../config/adminSections';
import { settingsPageTitle, visibleSettingsSections } from '@marinoscar/platform-web/settings/ui';
import type { SettingsSectionDef } from '@marinoscar/platform-web/settings/ui';
import { dangerZoneLastViolations } from '@marinoscar/platform-web/user-data/headless';
import { readApiPermissionConstants } from '../utils/apiPermissions';
import { ORG_AI_KEYS_DESCRIPTION } from '@marinoscar/platform-web/ai/ui';
import {
  USER_SETTINGS_SECTIONS,
  USER_HUB_PATH,
  USER_HUB_TITLE,
} from '../../config/userSettingsSections';

/**
 * The reference app's own settings cards, pinned one by one (issues #225, #266,
 * #325, #366, #376, #401, #425, #537, #726, #731): which group each card lives
 * in, the exact permission it declares, and what the three surfaces (hub, rail,
 * AppBar title) show a viewer, an operator and an organization administrator.
 *
 * This is the app's DATA. The platform invariants that used to share this file
 * (that `visibleSettingsSections` and `settingsPageTitle` gate by permission,
 * feature and longest-prefix route; that every card is declared as the Settings
 * UI Pattern requires; that every AI card is feature-gated) run for EVERY app
 * through `runPlatformWebConformance` (`../conformance.test.ts`, suites
 * `settings-registry-gates`, `settings-registry-shape`, `settings-ai-cards`).
 */

function titlesOf(sections: SettingsSectionDef[]): string[] {
  return sections.flatMap((section) => section.cards.map((card) => card.title));
}

describe('the user registry — Groups card (#731)', () => {
  it('shows the Groups card (#731) only to a holder of groups:read', () => {
    const without = visibleSettingsSections(USER_SETTINGS_SECTIONS, (permission) => permission === 'user_settings:read');
    expect(titlesOf(without)).not.toContain('Groups');
    // The section collapses with its only card.
    expect(without.map((section) => section.label)).not.toContain('Sharing');

    const withRead = visibleSettingsSections(USER_SETTINGS_SECTIONS, (permission) => permission === 'groups:read');
    expect(titlesOf(withRead)).toContain('Groups');
    expect(withRead.map((section) => section.label)).toContain('Sharing');
  });

  it('titles /settings/groups and a group detail page "Groups" (#731)', () => {
    expect(settingsPageTitle(USER_SETTINGS_SECTIONS, USER_HUB_PATH, USER_HUB_TITLE, '/settings/groups')).toBe('Groups');
    expect(
      settingsPageTitle(USER_SETTINGS_SECTIONS, USER_HUB_PATH, USER_HUB_TITLE, '/settings/groups/7d7e9c1a-0000-4000-8000-000000000001'),
    ).toBe('Groups');
  });
});

/**
 * Issue #366. `System`, `Appearance`, `Feature Flags` and `Advanced (JSON)`
 * were removed outright — not disabled, not hidden behind a permission — so
 * this is a regression guard against any of the four quietly reappearing
 * (e.g. a bad merge resurrecting a card whose page no longer exists, which
 * would send a click straight to `App.tsx`'s `*` catch-all).
 */
describe('removed settings pages (#366) stay gone', () => {
  const allCards = ADMIN_SECTIONS.flatMap((section) => section.cards);

  it('declares no card for System, Appearance, Feature Flags or Advanced (JSON)', () => {
    const titles = allCards.map((card) => card.title);
    expect(titles).not.toContain('System');
    expect(titles).not.toContain('Appearance');
    expect(titles).not.toContain('Feature Flags');
    expect(titles).not.toContain('Advanced (JSON)');
  });

  it('routes none of the removed paths', () => {
    const paths = allCards.map((card) => card.path);
    expect(paths).not.toContain('/admin/settings/general');
    expect(paths).not.toContain('/admin/settings/appearance');
    expect(paths).not.toContain('/admin/settings/feature-flags');
    expect(paths).not.toContain('/admin/settings/advanced');
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

/**
 * Issue #325, epic #319. The `Broadcasts` page is a registry CARD, never a
 * fourth tab on the admin Notifications settings page — `CLAUDE.md`'s mandatory
 * settings-UI rule 1 and rule 2, stated as assertions. The two pages answer
 * different questions: `/admin/settings/notifications` is the deployment-wide
 * kill switch (reachability of the notification MECHANISM), while this one
 * composes and dispatches one announcement to every user. A tab strip would
 * present the second as content of the first.
 *
 * The route/permission agreement with `App.tsx` is asserted generically for
 * every card in `destinations.test.ts`; what is pinned here is this card's own
 * identity, and that the gate genuinely denies.
 */
describe('the Broadcasts card (#325)', () => {
  const card = ADMIN_SECTIONS.flatMap((section) => section.cards).find(
    (entry) => entry.title === 'Broadcasts',
  );

  it('is declared in ADMIN_SECTIONS', () => {
    expect(card).toBeDefined();
  });

  it('routes to /admin/settings/broadcasts', () => {
    expect(card?.path).toBe('/admin/settings/broadcasts');
  });

  it('lives under Operations, not General', () => {
    // General holds values an administrator SETS, which then sit there; a
    // broadcast is work you dispatch and then watch. The distinction is this
    // section's own header, and it is what keeps the card one away from Jobs.
    const owner = ADMIN_SECTIONS.find((section) =>
      section.cards.some((entry) => entry.title === 'Broadcasts'),
    );
    expect(owner?.label).toBe('Operations');
  });

  it('declares the exact permission the API enforces on the broadcast routes', () => {
    // `notifications/broadcasts/broadcasts.controller.ts` — the registry never
    // invents a permission. NOT `system_settings:read`, which would let the
    // hub decide reachability on evidence unrelated to whether the request
    // behind the card will be authorized. Since #738 the controller accepts
    // ANY OF the system `broadcasts:read` and the org-scoped
    // `org_broadcasts:read`, so the card declares exactly that list.
    expect(card?.permission).toEqual(['broadcasts:read', 'org_broadcasts:read']);
    expect(card?.permission).not.toContain('system_settings:read');
  });

  it('is not an alwaysShow escape hatch — the gate must be able to deny it', () => {
    expect(card?.alwaysShow).toBeUndefined();
  });

  it('is routed, not inert', () => {
    expect(card?.disabled).toBeUndefined();
  });

  it('appears for an admin holding broadcasts:read', () => {
    const result = visibleSettingsSections(
      ADMIN_SECTIONS,
      (permission) => permission === 'broadcasts:read',
    );

    expect(titlesOf(result)).toContain('Broadcasts');
  });

  it('appears for an organization administrator holding only org_broadcasts:read (#738)', () => {
    const result = visibleSettingsSections(
      ADMIN_SECTIONS,
      (permission) => permission === 'org_broadcasts:read',
    );

    expect(titlesOf(result)).toContain('Broadcasts');
  });

  it('appears in none of the three surfaces for a viewer', () => {
    // A viewer holds `user_settings:*` only. One assertion covers the hub, the
    // rail and the title resolver because all three run this same function.
    const viewerPermissions = ['user_settings:read', 'user_settings:write'];
    const result = visibleSettingsSections(ADMIN_SECTIONS, (permission) =>
      viewerPermissions.includes(permission),
    );

    expect(titlesOf(result)).not.toContain('Broadcasts');
  });

  it('resolves its route to its own title, not the hub title', () => {
    expect(
      settingsPageTitle(
        ADMIN_SECTIONS,
        ADMIN_HUB_PATH,
        ADMIN_HUB_TITLE,
        '/admin/settings/broadcasts',
      ),
    ).toBe('Broadcasts');
  });

  it('is not confusable with the General → Notifications card', () => {
    // Both exist, at different paths, behind different permissions. The
    // failure this guards against is a later edit collapsing one into the
    // other — a "Broadcasts" tab on the notifications route, or a card whose
    // path quietly points at the kill switch.
    const notifications = ADMIN_SECTIONS.flatMap((section) => section.cards).find(
      (entry) => entry.title === 'Notifications',
    );

    expect(notifications?.path).toBe('/admin/settings/notifications');
    expect(card?.path).not.toBe(notifications?.path);
    expect(card?.permission).not.toBe(notifications?.permission);
  });
});

/**
 * Issue #376, epic #372. The `Storage` page is a registry CARD in the
 * **General** group — `CLAUDE.md`'s mandatory settings-UI rules 1 and 3 stated
 * as assertions, and rule 2 by construction (it is not a tab on Email, on Web
 * Push, or on anything else).
 *
 * The route/permission agreement with `App.tsx` is asserted generically for
 * every card in `destinations.test.ts`; what is pinned here is this card's own
 * identity, that its permission is neither of the two pairs that look like they
 * would do, and that the gate genuinely denies.
 */
describe('the Storage card (#376)', () => {
  const card = ADMIN_SECTIONS.flatMap((section) => section.cards).find(
    (entry) => entry.title === 'Storage',
  );

  it('is declared in ADMIN_SECTIONS', () => {
    expect(card).toBeDefined();
  });

  it('routes to /admin/settings/storage', () => {
    expect(card?.path).toBe('/admin/settings/storage');
  });

  it('lives under General, not Operations', () => {
    // General holds configuration an administrator SETS, which then sits
    // there — the bucket, the endpoint, the key pair. Operations is the
    // RUNNING system: work in flight, the machines executing it, the copies of
    // the data taken while it ran. Storage belongs beside Email and Web Push.
    const owner = ADMIN_SECTIONS.find((section) =>
      section.cards.some((entry) => entry.title === 'Storage'),
    );
    expect(owner?.label).toBe('General');
  });

  it('is not an alwaysShow escape hatch — the gate must be able to deny it', () => {
    expect(card?.alwaysShow).toBeUndefined();
  });

  it('is routed, not inert', () => {
    expect(card?.disabled).toBeUndefined();
  });

  it('declares the exact permission the API enforces on the storage-config routes', () => {
    // Read off the API workspace rather than restated, so a rename on either
    // side fails here instead of in production. This is the mechanical half of
    // CLAUDE.md Settings UI Pattern rule 3.
    // The controller is the storage slice's since #736.
    const PLATFORM_API_SRC = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../../packages/platform-api/src',
    );
    const rolesConstants = readApiPermissionConstants();
    const storageConfigController = readFileSync(
      resolve(PLATFORM_API_SRC, 'storage/config/storage-config.controller.ts'),
      'utf8',
    );

    expect(card?.permission).toBe('storage_config:read');
    expect(rolesConstants).toContain("STORAGE_CONFIG_READ: 'storage_config:read'");
    expect(rolesConstants).toContain("STORAGE_CONFIG_WRITE: 'storage_config:write'");
    expect(storageConfigController).toContain('PERMISSIONS.STORAGE_CONFIG_READ');
    expect(storageConfigController).toContain('PERMISSIONS.STORAGE_CONFIG_WRITE');
  });

  it('mirrors neither system_settings:read nor storage:read', () => {
    // `system_settings:read` would gate a credential-bearing screen on evidence
    // unrelated to whether the request behind the card will be authorized.
    // `storage:read` is the closer-looking mistake and the worse one: that pair
    // gates OBJECT ACCESS and is seeded to Viewer and Contributor, so mirroring
    // it would put this page in front of the entire user base.
    expect(card?.permission).not.toBe('system_settings:read');
    expect(card?.permission).not.toBe('storage:read');
    expect(card?.permission).not.toBe('storage_config:write');
  });

  it('appears for an admin holding storage_config:read', () => {
    const result = visibleSettingsSections(
      ADMIN_SECTIONS,
      (permission) => permission === 'storage_config:read',
    );

    expect(titlesOf(result)).toContain('Storage');
  });

  it('is invisible to a user holding only storage:read, however many objects they may read', () => {
    const result = visibleSettingsSections(
      ADMIN_SECTIONS,
      (permission) => permission === 'storage:read',
    );

    expect(titlesOf(result)).not.toContain('Storage');
  });

  it('appears in none of the three surfaces for a viewer', () => {
    // A viewer holds `user_settings:*` and `storage:*`. One assertion covers
    // the hub, the rail and the title resolver because all three run this same
    // function.
    const viewerPermissions = [
      'user_settings:read',
      'user_settings:write',
      'storage:read',
      'storage:write',
      'storage:delete',
    ];
    const result = visibleSettingsSections(ADMIN_SECTIONS, (permission) =>
      viewerPermissions.includes(permission),
    );

    expect(titlesOf(result)).not.toContain('Storage');
  });

  it('resolves its route to its own title, not the hub title', () => {
    expect(
      settingsPageTitle(
        ADMIN_SECTIONS,
        ADMIN_HUB_PATH,
        ADMIN_HUB_TITLE,
        '/admin/settings/storage',
      ),
    ).toBe('Storage');
  });
});

/**
 * Issue #401, epic #397. The `About` page is a registry CARD in the
 * **Operations** group — `CLAUDE.md`'s mandatory settings-UI rules 1 and 3
 * stated as assertions, and rule 2 by construction (it is not a tab on Jobs, on
 * Worker Nodes, or on anything else).
 *
 * The route/permission agreement with `App.tsx` is asserted generically for
 * every card in `destinations.test.ts`; what is pinned here is this card's own
 * identity, its group, and that its permission is the literal string the About
 * controller enforces rather than a new one invented for it.
 */
describe('the About card (#401)', () => {
  const card = ADMIN_SECTIONS.flatMap((section) => section.cards).find(
    (entry) => entry.title === 'About',
  );

  it('is declared in ADMIN_SECTIONS', () => {
    expect(card).toBeDefined();
  });

  it('routes to /admin/settings/about', () => {
    expect(card?.path).toBe('/admin/settings/about');
  });

  it('lives under Operations, not General', () => {
    // General holds configuration an administrator SETS, which then sits there.
    // Nothing on the About page is settable — the endpoint behind it is a
    // single GET. It is a read-only view of the RUNNING system, which is the
    // question Jobs, Worker Nodes and Database Backup each answer on their own
    // axis; this one answers the most basic of them.
    const owner = ADMIN_SECTIONS.find((section) =>
      section.cards.some((entry) => entry.title === 'About'),
    );
    expect(owner?.label).toBe('Operations');
  });

  it('is not an alwaysShow escape hatch — the gate must be able to deny it', () => {
    expect(card?.alwaysShow).toBeUndefined();
  });

  it('is routed, not inert', () => {
    expect(card?.disabled).toBeUndefined();
  });

  it('declares the exact permission about.controller.ts enforces, and invents none', () => {
    // Read off the API workspace rather than restated, so a rename on either
    // side fails here instead of in production. This is the mechanical half of
    // CLAUDE.md Settings UI Pattern rule 3, and the controller's own header
    // names this test's sibling as the other half of the contract.
    const PLATFORM_API_SRC = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../../packages/platform-api/src',
    );
    const rolesConstants = readApiPermissionConstants();
    const aboutController = readFileSync(
      resolve(PLATFORM_API_SRC, 'host/about/about.controller.ts'),
      'utf8',
    );

    expect(card?.permission).toBe('system_settings:read');
    expect(rolesConstants).toContain("SYSTEM_SETTINGS_READ: 'system_settings:read'");
    // Both spellings are asserted because the controller carries both on
    // purpose — the reference it decorates with, and the literal its header
    // names as half of this cross-app contract.
    expect(aboutController).toContain('SETTINGS_PERMISSIONS.SYSTEM_SETTINGS_READ');
    expect(aboutController).toContain('system_settings:read');
  });

  it('does not invent an about:read permission of its own', () => {
    // The controller argues this at length: the split pairs elsewhere in this
    // registry (`push:*`, `broadcasts:*`, `nodes:*`, `storage_config:*`) each
    // turn on a DISTINCT blast radius — key material, a send to every user, a
    // fleet, a credential-bearing screen. A read-only report has none of that,
    // and a new permission would have to be seeded, granted and explained to
    // buy nothing.
    expect(card?.permission).not.toBe('about:read');
    expect(card?.permission).not.toBe('system_settings:write');
  });

  it('appears for an admin holding system_settings:read', () => {
    const result = visibleSettingsSections(
      ADMIN_SECTIONS,
      (permission) => permission === 'system_settings:read',
    );

    expect(titlesOf(result)).toContain('About');
  });

  it('appears in none of the three surfaces for a viewer', () => {
    // One assertion covers the hub, the rail and the title resolver because
    // all three run this same function.
    const viewerPermissions = ['user_settings:read', 'user_settings:write', 'storage:read'];
    const result = visibleSettingsSections(ADMIN_SECTIONS, (permission) =>
      viewerPermissions.includes(permission),
    );

    expect(titlesOf(result)).not.toContain('About');
  });

  it('resolves its route to its own title, not the hub title', () => {
    expect(
      settingsPageTitle(ADMIN_SECTIONS, ADMIN_HUB_PATH, ADMIN_HUB_TITLE, '/admin/settings/about'),
    ).toBe('About');
  });
});

/**
 * Issue #266, epic #254 — the `Operations` group.
 *
 * Three things are worth asserting here that nothing else can:
 *
 *  1. THE GROUP IS ADDITIVE. `General` and `Access` keep their cards, their
 *     order and their gates; a third section that quietly reordered or
 *     absorbed a sibling would look fine on the hub and be wrong in the rail.
 *  2. THE TWO UNBUILT CARDS ARE NON-NAVIGABLE, not 404-linking. Both consumers
 *     key on the same two fields (`SettingsHub` renders an inert "Coming soon"
 *     card with no action area; `NavigationRail` skips the row), so `path`
 *     being absent AND `disabled` being true is the contract, not a detail.
 *  3. THE PERMISSIONS ARE THE API'S OWN STRINGS — checked against the API's
 *     constants file on disk rather than against a copy, per CLAUDE.md's
 *     Settings UI Pattern rule 3. `Database Backup` in particular must NOT
 *     mirror `system_settings:read`: the API reserves a dedicated
 *     `db_backup:*` triple precisely so backup access can be granted without
 *     handing over the settings document.
 */
describe('the Operations group (#266)', () => {
  const operations = ADMIN_SECTIONS.find((section) => section.label === 'Operations');
  const cardsByTitle = new Map(
    ADMIN_SECTIONS.flatMap((section) => section.cards).map((card) => [card.title, card]),
  );

  it('is a third group, and the first two are untouched', () => {
    // `AI` (#425) is APPENDED as a fourth group after it — see the AI suite —
    // `Observability` (#537) as a fifth after that, and `Organizations`
    // (#726) as a sixth.
    expect(ADMIN_SECTIONS.map((section) => section.label)).toEqual([
      'General',
      'Access',
      'Operations',
      'AI',
      'Observability',
      'Organizations',
      // #743: pinned last, the one exception to append-only.
      'Danger Zone',
    ]);
  });

  it('registers all four of the epic’s cards at once, and #319 then #401 each append one', () => {
    // Declared together on purpose: the hub is under visual-regression testing
    // at `maxDiffPixels: 4`, so every change to the card grid needs baselines
    // regenerated in a pinned container. Four cards across four issues would
    // be four regenerations and four chances to land a stale baseline.
    //
    // `Broadcasts` (#325, epic #319) is APPENDED rather than inserted, and the
    // order is asserted rather than left to chance: the hub, the rail and the
    // drill-down list all render this array in declaration order, so an
    // insertion would move four existing cards for a reader who has learnt
    // where they are — and would reflow the grid further than the one added
    // card requires.
    //
    // `About` (#401, epic #397) is appended for the same reason and under the
    // same rule. It belongs in Operations rather than General on this section
    // header's own test: General holds values an administrator SETS, and
    // nothing on the About page is settable — it is a read-only view of the
    // running system, the same kind of question its four neighbours answer.
    expect(operations?.cards.map((card) => card.title)).toEqual([
      'Jobs',
      'Job Insights',
      'Worker Nodes',
      'Database Backup',
      'Broadcasts',
      'About',
    ]);
  });

  it('routes every page that has shipped', () => {
    expect(cardsByTitle.get('Jobs')?.path).toBe('/admin/settings/jobs');
    expect(cardsByTitle.get('Job Insights')?.path).toBe('/admin/settings/jobs/insights');
    // #271 flipped this one from inert to routed. The path is the route
    // `App.tsx` declares, byte for byte — a card pointing anywhere else would
    // send the click to the `*` catch-all and land on the home page.
    expect(cardsByTitle.get('Worker Nodes')?.path).toBe('/admin/settings/workers');
    // #287 flipped the last one, for the same reason and with the same rule:
    // the path is the route `App.tsx` declares, byte for byte.
    expect(cardsByTitle.get('Database Backup')?.path).toBe('/admin/settings/db-backup');
    // #401 shipped routed from the start — it was never declared ahead of its
    // page, so there was no inert state to flip.
    expect(cardsByTitle.get('About')?.path).toBe('/admin/settings/about');
  });

  it('has no inert card left — every page the group declared has shipped', () => {
    // #287 flipped the last one. The `disabled: true` + no-`path` contract
    // still matters and is asserted below for whatever is declared ahead of its
    // page NEXT; today the group is fully routed, which is the state it was
    // declared in advance to reach.
    for (const card of operations?.cards ?? []) {
      expect(card.disabled, `${card.title} must not be inert`).toBeUndefined();
      expect(card.path, `${card.title} must declare a route`).toBeTruthy();
    }
  });

  it('keeps the two fields coupled for any card declared ahead of its page', () => {
    // The rail skips on either field and the hub renders an inert card on
    // either, so a card that has one without the other is a card the two
    // consumers disagree about: `disabled` with a `path` is a rail row that
    // vanishes, and a `path` with no page sends a click to `App.tsx`'s `*`
    // catch-all and lands the operator on the home page with no explanation.
    for (const card of ADMIN_SECTIONS.flatMap((section) => section.cards)) {
      if (card.disabled) {
        expect(card.path, `${card.title} is inert and must declare no route`).toBeUndefined();
      }
    }
  });

  it('leaves the shipped cards navigable', () => {
    for (const title of ['Jobs', 'Job Insights', 'Worker Nodes', 'Database Backup', 'About']) {
      expect(cardsByTitle.get(title)?.disabled).toBeUndefined();
    }
  });

  it('gates every card on a permission, with no alwaysShow escape hatch', () => {
    for (const card of operations?.cards ?? []) {
      expect(card.permission, `${card.title} must declare a permission`).toBeTruthy();
      expect(card.alwaysShow, `${card.title} must be deniable`).toBeUndefined();
    }
  });

  describe('the permissions are literally the strings the API enforces', () => {
    // Read off the API workspace rather than restated, so a rename on either
    // side fails here instead of in production. This is the mechanical half of
    // CLAUDE.md Settings UI Pattern rule 3.
    const API_SRC = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../api/src',
    );
    // Jobs and nodes are packaged slices since #734.
    const PLATFORM_API_SRC = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../../packages/platform-api/src',
    );
    const rolesConstants = readApiPermissionConstants();
    const jobsController = readFileSync(
      resolve(PLATFORM_API_SRC, 'jobs/job-admin.controller.ts'),
      'utf8',
    );
    const nodesAdminController = readFileSync(
      resolve(PLATFORM_API_SRC, 'nodes/nodes-admin.controller.ts'),
      'utf8',
    );
    // Notifications is a packaged slice since #738.
    const broadcastsController = readFileSync(
      resolve(PLATFORM_API_SRC, 'notifications/broadcasts/broadcasts.controller.ts'),
      'utf8',
    );
    const dbBackupController = readFileSync(
      resolve(PLATFORM_API_SRC, 'db-backup/db-backup.controller.ts'),
      'utf8',
    );

    it('binds both Jobs cards to jobs:read, which job-admin.controller.ts enforces on its reads', () => {
      expect(cardsByTitle.get('Jobs')?.permission).toBe('jobs:read');
      expect(cardsByTitle.get('Job Insights')?.permission).toBe('jobs:read');
      expect(rolesConstants).toContain("JOBS_READ: 'jobs:read'");
      expect(jobsController).toContain('PERMISSIONS.JOBS_READ');
    });

    it('binds Worker Nodes to nodes:read, never to jobs:read', () => {
      // `roles.constants.ts` splits the two deliberately: a Workers card gated
      // on `jobs:read` would advertise a permission the nodes controller never
      // checks, so the hub would decide reachability on unrelated evidence.
      expect(cardsByTitle.get('Worker Nodes')?.permission).toBe('nodes:read');
      expect(cardsByTitle.get('Worker Nodes')?.permission).not.toBe('jobs:read');
      expect(rolesConstants).toContain("NODES_READ: 'nodes:read'");
      // And the controller really does enforce it — the mechanical half of
      // CLAUDE.md Settings UI Pattern rule 3, now that the card is routed and
      // the string gates a page somebody can actually open (#271).
      expect(nodesAdminController).toContain('PERMISSIONS.NODES_READ');
    });

    it('binds Broadcasts to broadcasts:read OR org_broadcasts:read, which broadcasts.controller.ts enforces on its reads', () => {
      // #325, epic #319. The dedicated pair exists so composing an
      // announcement to every user can be granted — or withheld — without
      // handing over the settings document, and mirroring
      // `system_settings:read` here would quietly undo that. #738 added the
      // org-scoped pair, which the controller accepts as an alternative.
      expect(cardsByTitle.get('Broadcasts')?.permission).toEqual(['broadcasts:read', 'org_broadcasts:read']);
      expect(cardsByTitle.get('Broadcasts')?.permission).not.toContain('system_settings:read');
      expect(rolesConstants).toContain("BROADCASTS_READ: 'broadcasts:read'");
      expect(rolesConstants).toContain("BROADCASTS_WRITE: 'broadcasts:write'");
      expect(rolesConstants).toContain("ORG_BROADCASTS_READ: 'org_broadcasts:read'");
      // And the controller really does enforce both — the mechanical half of
      // CLAUDE.md Settings UI Pattern rule 3.
      expect(broadcastsController).toContain('PERMISSIONS.BROADCASTS_READ');
      expect(broadcastsController).toContain('PERMISSIONS.ORG_BROADCASTS_READ');
      expect(broadcastsController).toContain('PERMISSIONS.BROADCASTS_WRITE');
      expect(broadcastsController).toMatch(/@Auth\(\{ anyPermissions: READ \}\)/);
    });

    it('binds Database Backup to the dedicated db_backup:read, never to system_settings:read', () => {
      const card = cardsByTitle.get('Database Backup');
      expect(card?.permission).toBe('db_backup:read');
      expect(card?.permission).not.toBe('system_settings:read');
      expect(rolesConstants).toContain("DB_BACKUP_READ: 'db_backup:read'");
      // And the controller really does enforce it — the mechanical half of
      // CLAUDE.md Settings UI Pattern rule 3, now that the card is routed and
      // the string gates a page somebody can actually open (#287).
      expect(dbBackupController).toContain('PERMISSIONS.DB_BACKUP_READ');
      // The THIRD permission is what the split is for: restoring is deliberately
      // not `db_backup:write`, so it can be withheld from someone who may
      // schedule backups but must not be able to replace the database. The card
      // must NOT mirror it — a reachability gate on `restore` would hide the
      // history from the read-only admin the page is most useful to.
      expect(rolesConstants).toContain("DB_BACKUP_RESTORE: 'db_backup:restore'");
      expect(dbBackupController).toContain('PERMISSIONS.DB_BACKUP_RESTORE');
      expect(card?.permission).not.toBe('db_backup:restore');
    });
  });

  describe('the shared gate, which the hub, the rail and the AppBar all run', () => {
    it('shows an operator holding only jobs:read exactly the two Jobs cards', () => {
      const result = visibleSettingsSections(
        ADMIN_SECTIONS,
        (permission) => permission === 'jobs:read',
      );

      expect(result.map((section) => section.label)).toEqual(['Operations']);
      expect(titlesOf(result)).toEqual(['Jobs', 'Job Insights']);
    });

    it('drops Operations entirely for a viewer, in all three surfaces at once', () => {
      const viewerPermissions = ['user_settings:read', 'user_settings:write'];
      const result = visibleSettingsSections(ADMIN_SECTIONS, (permission) =>
        viewerPermissions.includes(permission),
      );

      expect(result.find((section) => section.label === 'Operations')).toBeUndefined();
    });

    it('does not disturb what a system_settings/users admin already saw', () => {
      // The regression an added section invites: General and Access must still
      // resolve to exactly the cards they did before.
      //
      // OPERATIONS NOW RESOLVES FOR THIS HOLDER TOO, and that is correct rather
      // than drift. `About` (#401, epic #397) is the first Operations card
      // gated on `system_settings:read` — not because it reaches across into
      // another surface's permission, but because that is the literal string
      // `about/about.controller.ts` enforces (Settings UI Pattern rule 3: the
      // card mirrors a permission, it never invents one). So a
      // `system_settings:read` admin who holds none of `jobs:read`,
      // `nodes:read`, `db_backup:read` or `broadcasts:read` now sees an
      // Operations section containing exactly one card. What this test still
      // pins is the part that must not move: General and Access resolve to
      // EXACTLY the cards they did before, in order.
      //
      // OBSERVABILITY RESOLVES FOR THIS HOLDER TOO since `Doctor` (#634),
      // for the same reason as About: `@marinoscar/platform-api/doctor`
      // enforces `system_settings:read` (bound in
      // `apps/api/src/doctor/doctor.config.ts`), so the card mirrors it.
      //
      // GENERAL GAINED `Setup guide` (#745), appended, for the same reason:
      // `@marinoscar/platform-api/onboarding` returns the admin block and the
      // metrics under `system_settings:read`. Then `Android app` (#746),
      // appended: `@marinoscar/platform-api/android-app` enforces
      // `system_settings:read` on `GET /api/admin/android-app`.
      const result = visibleSettingsSections(ADMIN_SECTIONS, (permission) =>
        ['system_settings:read', 'system_settings:write', 'users:read'].includes(permission),
      );

      expect(result.map((section) => section.label)).toEqual([
        'General',
        'Access',
        'Operations',
        'Observability',
      ]);
      expect(titlesOf(result)).toEqual([
        'Email',
        'Notifications',
        'Maintenance',
        'Setup guide',
        'Android app',
        'Users & Allowlist',
        'About',
        'Doctor',
      ]);
    });

    it('shows every Operations card to whoever holds its permission', () => {
      const result = visibleSettingsSections(ADMIN_SECTIONS, () => true);

      expect(titlesOf(result)).toContain('Worker Nodes');
      expect(titlesOf(result)).toContain('Database Backup');
    });

    it('shows Database Backup to a db_backup:read holder and to nobody else', () => {
      // The whole reason the API reserves a dedicated triple: backup access is
      // grantable without the settings document, so the card must not appear
      // for a `system_settings:read` admin who was never given it.
      const withBackup = visibleSettingsSections(
        ADMIN_SECTIONS,
        (permission) => permission === 'db_backup:read',
      );
      expect(titlesOf(withBackup)).toEqual(['Database Backup']);

      const settingsOnly = visibleSettingsSections(
        ADMIN_SECTIONS,
        (permission) => permission === 'system_settings:read',
      );
      expect(titlesOf(settingsOnly)).not.toContain('Database Backup');
    });

    it('matches Operations cards by title in the hub search', () => {
      const result = visibleSettingsSections(ADMIN_SECTIONS, () => true, 'insights');

      expect(titlesOf(result)).toEqual(['Job Insights']);
    });
  });

  describe('the AppBar title resolver, on a NESTED card route', () => {
    const titleFor = (pathname: string) =>
      settingsPageTitle(ADMIN_SECTIONS, ADMIN_HUB_PATH, ADMIN_HUB_TITLE, pathname);

    it('resolves the parent route to Jobs', () => {
      expect(titleFor('/admin/settings/jobs')).toBe('Jobs');
    });

    it('gives the LONGEST prefix the win, so the nested route is not titled "Jobs"', () => {
      // The exact case the longest-prefix rule exists for: `/admin/settings/jobs`
      // is a genuine prefix of the insights path, so a first-match resolver
      // would title this page after its sibling.
      expect(titleFor('/admin/settings/jobs/insights')).toBe('Job Insights');
    });

    it('keeps the win on a child of the nested route', () => {
      expect(titleFor('/admin/settings/jobs/insights/anything')).toBe('Job Insights');
    });

    it('respects segment boundaries around the jobs path', () => {
      expect(titleFor('/admin/settings/jobs-archive')).toBe(ADMIN_HUB_TITLE);
    });

    it('resolves the backup route to Database Backup (#287)', () => {
      expect(titleFor('/admin/settings/db-backup')).toBe('Database Backup');
    });

    it('falls back to the hub title for paths no card claims', () => {
      // Neither of these is any card's `path` — the two pages live at
      // `/admin/settings/workers` and `/admin/settings/db-backup` — so nothing
      // claims them, which is the same answer the hub gives and not a title for
      // a page that does not exist.
      expect(titleFor('/admin/settings/nodes')).toBe(ADMIN_HUB_TITLE);
      expect(titleFor('/admin/settings/backup')).toBe(ADMIN_HUB_TITLE);
      // And the segment-boundary rule holds around the new path too.
      expect(titleFor('/admin/settings/db-backup-archive')).toBe(ADMIN_HUB_TITLE);
    });
  });
});

/**
 * Issue #425, epic #419 — the feature axis of the registry, and the AI cards.
 */
describe('settingsPageTitle — feature gating (#425)', () => {
  it('titles AI Models by longest prefix only while AI is on', () => {
    const path = '/admin/settings/ai/models';
    expect(settingsPageTitle(ADMIN_SECTIONS, ADMIN_HUB_PATH, ADMIN_HUB_TITLE, path, { ai: true })).toBe(
      'AI Models',
    );
    // Off: the card does not exist, so its parent route owns the title.
    expect(settingsPageTitle(ADMIN_SECTIONS, ADMIN_HUB_PATH, ADMIN_HUB_TITLE, path)).toBe('AI');
  });

  it('titles the AI page whether or not AI is on', () => {
    for (const features of [{}, { ai: true }]) {
      expect(
        settingsPageTitle(ADMIN_SECTIONS, ADMIN_HUB_PATH, ADMIN_HUB_TITLE, '/admin/settings/ai', features),
      ).toBe('AI');
    }
  });

  it('falls back to the user hub title for /settings/ai while AI is off', () => {
    expect(settingsPageTitle(USER_SETTINGS_SECTIONS, USER_HUB_PATH, USER_HUB_TITLE, '/settings/ai')).toBe(
      USER_HUB_TITLE,
    );
    expect(
      settingsPageTitle(USER_SETTINGS_SECTIONS, USER_HUB_PATH, USER_HUB_TITLE, '/settings/ai', { ai: true }),
    ).toBe('AI Keys');
  });
});

describe('the AI group (#425)', () => {
  const aiSection = ADMIN_SECTIONS.find((section) => section.label === 'AI');
  const cards = new Map((aiSection?.cards ?? []).map((card) => [card.title, card]));

  it('is APPENDED after Operations, leaving every earlier card in place', () => {
    // It was the last group until `Observability` (#537), then `Organizations`
    // (#726), were appended after it.
    expect(ADMIN_SECTIONS[3]).toBe(aiSection);
    expect(ADMIN_SECTIONS.slice(4).map((section) => section.label)).toEqual(['Observability', 'Organizations', 'Danger Zone']);
    // `AI Usage` (#444) is appended after `AI Models`, never inserted.
    // `Organization AI keys` (#739) is appended after `AI Usage`.
    expect(aiSection?.cards.map((card) => card.title)).toEqual([
      'AI',
      'AI Models',
      'AI Usage',
      'Organization AI keys',
    ]);
  });

  it('gates Organization AI keys (#739) on org_ai_config:read, feature-gated, nested under the AI route', () => {
    const card = cards.get('Organization AI keys');
    expect(card).toMatchObject({
      path: '/admin/settings/ai/organization-keys',
      permission: 'org_ai_config:read',
      feature: 'ai',
      description: ORG_AI_KEYS_DESCRIPTION,
    });
    expect(card?.alwaysShow).toBeUndefined();

    const visible = (held: string[], features: { ai?: boolean; orgs?: boolean }) =>
      visibleSettingsSections(ADMIN_SECTIONS, (p) => held.includes(p), '', features).flatMap((section) =>
        section.cards.map((c) => c.title),
      );
    // An org admin holding only the org permission sees exactly this card, in
    // single-org and multi-org mode alike, and only while AI is on.
    expect(visible(['org_ai_config:read'], { ai: true })).toEqual(['Organization AI keys']);
    expect(visible(['org_ai_config:read'], { ai: true, orgs: true })).toEqual(['Organization AI keys']);
    expect(visible(['org_ai_config:read'], { ai: false })).toEqual([]);
    expect(visible(['ai_config:read'], { ai: true })).not.toContain('Organization AI keys');
    expect(
      settingsPageTitle(ADMIN_SECTIONS, ADMIN_HUB_PATH, ADMIN_HUB_TITLE, '/admin/settings/ai/organization-keys', {
        ai: true,
      }),
    ).toBe('Organization AI keys');
  });

  it('gates both cards on ai_config:read — the admin AI controller’s read permission', () => {
    expect(cards.get('AI')?.permission).toBe('ai_config:read');
    expect(cards.get('AI Models')?.permission).toBe('ai_config:read');
  });

  it('gates AI Usage (#444) on ai_config:read, feature-gated, nested under the AI route', () => {
    expect(cards.get('AI Usage')).toMatchObject({
      path: '/admin/settings/ai/usage',
      permission: 'ai_config:read',
      feature: 'ai',
    });
  });

  it('hides AI Usage while AI is off, and titles its route by longest prefix only while on', () => {
    const titles = (features: { ai?: boolean }) =>
      visibleSettingsSections(ADMIN_SECTIONS, () => true, '', features).flatMap((section) =>
        section.cards.map((card) => card.title),
      );
    expect(titles({ ai: false })).not.toContain('AI Usage');
    expect(titles({ ai: true })).toContain('AI Usage');

    const path = '/admin/settings/ai/usage';
    expect(settingsPageTitle(ADMIN_SECTIONS, ADMIN_HUB_PATH, ADMIN_HUB_TITLE, path, { ai: true })).toBe(
      'AI Usage',
    );
    expect(settingsPageTitle(ADMIN_SECTIONS, ADMIN_HUB_PATH, ADMIN_HUB_TITLE, path)).toBe('AI');
  });

  it('never feature-gates the AI card — it is where AI is switched on', () => {
    expect(cards.get('AI')?.feature).toBeUndefined();
    expect(cards.get('AI')?.path).toBe('/admin/settings/ai');
  });

  it('feature-gates AI Models and nests it under the AI route', () => {
    expect(cards.get('AI Models')?.feature).toBe('ai');
    expect(cards.get('AI Models')?.path).toBe('/admin/settings/ai/models');
  });

  it('shows neither card to an admin without ai_config:read — the pre-AI hub is unchanged', () => {
    const preAi = ['system_settings:read', 'users:read', 'jobs:read', 'nodes:read'];
    const result = visibleSettingsSections(
      ADMIN_SECTIONS,
      (permission) => preAi.includes(permission),
      '',
      { ai: true },
    );
    expect(result.map((section) => section.label)).not.toContain('AI');
  });

  it('declares AI Keys in the user Security group on ai:use, feature-gated', () => {
    const security = USER_SETTINGS_SECTIONS.find((section) => section.label === 'Security');
    const aiKeys = security?.cards.find((card) => card.title === 'AI Keys');
    expect(aiKeys).toMatchObject({ path: '/settings/ai', permission: 'ai:use', feature: 'ai' });
  });
});

/**
 * Issue #537, epic #528 — the Observability group: `Telemetry` (the policy
 * page, where telemetry is switched on) and `Telemetry Explorer` (feature-gated
 * on `telemetry`). Permissions are read off the API workspace on disk, the
 * mechanical half of CLAUDE.md Settings UI Pattern rule 3.
 */
describe('the Observability group (#537)', () => {
  // The telemetry controllers live in the telemetry slice of the platform
  // package since #703; each route is guarded with the app's own `@Auth()`
  // through the host port, as `access.requirePermissions([TELEMETRY_PERMISSIONS.X])`,
  // and the slice's permission file maps `X` to the string.
  const TELEMETRY_SRC = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../../packages/platform-api/src/telemetry',
  );
  const telemetryPermissions = readFileSync(resolve(TELEMETRY_SRC, 'telemetry.permissions.ts'), 'utf8');
  const API_SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../api/src');
  const rolesConstants = readApiPermissionConstants();
  const observability = ADMIN_SECTIONS.find((section) => section.label === 'Observability');
  const cards = new Map((observability?.cards ?? []).map((card) => [card.title, card]));
  const telemetry = cards.get('Telemetry');
  const explorer = cards.get('Telemetry Explorer');

  const titles = (hasPermission: (permission: string) => boolean, features = {}) =>
    titlesOf(visibleSettingsSections(ADMIN_SECTIONS, hasPermission, '', features));

  it('is APPENDED after AI, followed only by Organizations (#726), with its cards in declaration order', () => {
    // Danger Zone (#743) is pinned last, after Organizations.
    expect(ADMIN_SECTIONS[ADMIN_SECTIONS.length - 3]).toBe(observability);
    expect(ADMIN_SECTIONS[ADMIN_SECTIONS.length - 2]?.label).toBe('Organizations');
    // `Telemetry Dashboard` (#578) was appended after the Explorer, and
    // `Doctor` (#634) after the Dashboard.
    expect(observability?.cards.map((card) => card.title)).toEqual([
      'Telemetry',
      'Telemetry Explorer',
      'Telemetry Dashboard',
      'Doctor',
    ]);
  });

  describe('the Telemetry card', () => {
    it('is declared and routed to /admin/settings/telemetry', () => {
      expect(telemetry).toBeDefined();
      expect(telemetry?.path).toBe('/admin/settings/telemetry');
      expect(telemetry?.disabled).toBeUndefined();
      expect(telemetry?.alwaysShow).toBeUndefined();
    });

    it('carries no feature — it is where telemetry is switched on', () => {
      expect(telemetry?.feature).toBeUndefined();
    });

    it('declares the exact permission telemetry-admin.controller.ts enforces on its reads', () => {
      const controller = readFileSync(resolve(TELEMETRY_SRC, 'telemetry-admin.controller.ts'), 'utf8');
      expect(telemetry?.permission).toBe('telemetry:read');
      expect(rolesConstants).toContain("TELEMETRY_READ: 'telemetry:read'");
      expect(telemetryPermissions).toContain("readonly READ: 'telemetry:read';");
      expect(controller).toContain('@(access.requirePermissions([TELEMETRY_PERMISSIONS.READ]))');
    });
  });

  describe('the Telemetry Explorer card', () => {
    it('is declared, routed and nested under the Telemetry route', () => {
      expect(explorer).toBeDefined();
      expect(explorer?.path).toBe('/admin/settings/telemetry/explorer');
      expect(explorer?.disabled).toBeUndefined();
      expect(explorer?.alwaysShow).toBeUndefined();
    });

    it("is feature-gated on 'telemetry', never on 'ai'", () => {
      expect(explorer?.feature).toBe('telemetry');
    });

    it('declares telemetry:query, the explorer controller permission', () => {
      expect(explorer?.permission).toBe('telemetry:query');
      expect(rolesConstants).toContain("TELEMETRY_QUERY: 'telemetry:query'");
      expect(telemetryPermissions).toContain("readonly QUERY: 'telemetry:query';");
      const controllerPath = resolve(TELEMETRY_SRC, 'telemetry-explorer.controller.ts');
      expect(existsSync(controllerPath)).toBe(true);
      expect(readFileSync(controllerPath, 'utf8')).toContain('access.requirePermissions([TELEMETRY_PERMISSIONS.QUERY])');
    });
  });

  describe('the Telemetry Dashboard card (#578)', () => {
    const dashboard = cards.get('Telemetry Dashboard');
    const allCards = ADMIN_SECTIONS.flatMap((section) => section.cards);

    it('was appended after the Explorer, not inserted — only Doctor (#634) follows it before the Organizations group (#726)', () => {
      const beforeOrgs = allCards.filter((card) => card.feature !== 'orgs' && card.path !== '/admin/settings/factory-reset');
      expect(beforeOrgs[beforeOrgs.length - 2]).toBe(dashboard);
      expect(beforeOrgs[beforeOrgs.length - 1]?.title).toBe('Doctor');
      expect(dashboard?.disabled).toBeUndefined();
      expect(dashboard?.alwaysShow).toBeUndefined();
    });

    it('declares a unique path nested under the Telemetry route', () => {
      expect(dashboard?.path).toBe('/admin/settings/telemetry/dashboard');
      expect(allCards.filter((card) => card.path === dashboard?.path)).toHaveLength(1);
    });

    it("declares telemetry:query, the dashboard controller's permission, and the telemetry feature", () => {
      expect(dashboard?.permission).toBe('telemetry:query');
      expect(dashboard?.feature).toBe('telemetry');
      const controller = readFileSync(resolve(TELEMETRY_SRC, 'dashboard/telemetry-dashboard.controller.ts'), 'utf8');
      const guards = controller.match(/@\(access\.require\w+\([^)]*\)\)/g) ?? [];
      // summary, timeseries, top, events, filters, metrics and metric-groups (#680).
      expect(guards).toHaveLength(7);
      for (const guard of guards) expect(guard).toBe('@(access.requirePermissions([TELEMETRY_PERMISSIONS.QUERY]))');
    });

    it('is hidden while telemetry is off and titles its route by longest prefix', () => {
      expect(titles(() => true, { telemetry: false })).not.toContain('Telemetry Dashboard');
      expect(titles(() => true, { telemetry: true })).toContain('Telemetry Dashboard');
      expect(
        settingsPageTitle(ADMIN_SECTIONS, ADMIN_HUB_PATH, ADMIN_HUB_TITLE, '/admin/settings/telemetry/dashboard', {
          telemetry: true,
        }),
      ).toBe('Telemetry Dashboard');
    });
  });

  /**
   * Issue #634. The Doctor page is a registry CARD appended as the last card
   * of Observability — CLAUDE.md settings-UI rules 1 and 3 as assertions.
   * Deliberately NOT feature-gated: it reports on AI and telemetry while they
   * are off, which is when an admin needs it.
   */
  describe('the Doctor card (#634)', () => {
    const doctor = cards.get('Doctor');
    const allCards = ADMIN_SECTIONS.flatMap((section) => section.cards);

    it('is declared and routed to /admin/settings/doctor', () => {
      expect(doctor).toBeDefined();
      expect(doctor?.path).toBe('/admin/settings/doctor');
      expect(doctor?.disabled).toBeUndefined();
      expect(allCards.filter((card) => card.path === doctor?.path)).toHaveLength(1);
    });

    it('is the LAST card of Observability, the last group before Organizations (#726) — appended, not inserted', () => {
      const beforeOrgs = allCards.filter((card) => card.feature !== 'orgs' && card.path !== '/admin/settings/factory-reset');
      expect(beforeOrgs[beforeOrgs.length - 1]).toBe(doctor);
      const owner = ADMIN_SECTIONS.find((section) => section.cards.includes(doctor!));
      expect(owner?.label).toBe('Observability');
    });

    it('is not an alwaysShow escape hatch and carries no feature', () => {
      expect(doctor?.alwaysShow).toBeUndefined();
      expect(doctor?.feature).toBeUndefined();
    });

    it('declares the exact permission @marinoscar/platform-api/doctor enforces, and invents none', () => {
      // Since #696 the controller is the package's: it enforces
      // `DEFAULT_DOCTOR_PERMISSION` unless the app's binding passes another
      // `permission`, and the app's binding passes none.
      const moduleSource = readFileSync(
        resolve(API_SRC, '../../../packages/platform-api/src/doctor/doctor.module.ts'),
        'utf8',
      );
      const binding = readFileSync(resolve(API_SRC, 'doctor/doctor.config.ts'), 'utf8');
      expect(doctor?.permission).toBe('system_settings:read');
      expect(moduleSource).toContain("export const DEFAULT_DOCTOR_PERMISSION = 'system_settings:read';");
      // The binding may pass other options (`supportBundle`, #772), never a `permission`.
      expect(binding).toContain('DoctorModule.forRoot({ host: platformHost');
      expect(binding).not.toMatch(/\bpermission\s*:/);
      expect(rolesConstants).toContain("SYSTEM_SETTINGS_READ: 'system_settings:read'");
      expect(doctor?.permission).not.toBe('doctor:read');
    });

    it('stays visible while telemetry and AI are off', () => {
      expect(titles(() => true, { ai: false, telemetry: false })).toContain('Doctor');
      expect(titles(() => true)).toContain('Doctor');
    });

    it('appears for an admin holding system_settings:read', () => {
      expect(titles((permission) => permission === 'system_settings:read')).toContain('Doctor');
    });

    it('appears in none of the three surfaces for a viewer', () => {
      const viewer = ['user_settings:read', 'user_settings:write', 'storage:read', 'ai:use'];
      expect(
        titles((permission) => viewer.includes(permission), { ai: true, telemetry: true }),
      ).not.toContain('Doctor');
    });

    it('resolves its route to its own title, not the hub title', () => {
      expect(
        settingsPageTitle(ADMIN_SECTIONS, ADMIN_HUB_PATH, ADMIN_HUB_TITLE, '/admin/settings/doctor'),
      ).toBe('Doctor');
    });
  });

  it('shows both cards to an admin holding the telemetry permissions while telemetry is on', () => {
    const result = titles(() => true, { ai: true, telemetry: true });
    expect(result).toContain('Telemetry');
    expect(result).toContain('Telemetry Explorer');
  });

  it('hides the Explorer while telemetry is off, but keeps the Telemetry card', () => {
    const off = titles(() => true, { ai: true, telemetry: false });
    expect(off).toContain('Telemetry');
    expect(off).not.toContain('Telemetry Explorer');
    // No feature map at all fails closed the same way.
    expect(titles(() => true)).not.toContain('Telemetry Explorer');
  });

  it('shows the Explorer only to a telemetry:query holder', () => {
    const readOnly = titles((permission) => permission === 'telemetry:read', { telemetry: true });
    expect(readOnly).toEqual(['Telemetry']);
    const queryOnly = titles((permission) => permission === 'telemetry:query', { telemetry: true });
    expect(queryOnly).toEqual(['Telemetry Explorer', 'Telemetry Dashboard']);
  });

  it('drops the whole group for a viewer', () => {
    const viewer = ['user_settings:read', 'user_settings:write', 'ai:use'];
    const result = visibleSettingsSections(
      ADMIN_SECTIONS,
      (permission) => viewer.includes(permission),
      '',
      { ai: true, telemetry: true },
    );
    expect(result.map((section) => section.label)).not.toContain('Observability');
  });

  it('titles the Explorer route by longest prefix only while telemetry is on', () => {
    const path = '/admin/settings/telemetry/explorer';
    expect(
      settingsPageTitle(ADMIN_SECTIONS, ADMIN_HUB_PATH, ADMIN_HUB_TITLE, path, { telemetry: true }),
    ).toBe('Telemetry Explorer');
    expect(settingsPageTitle(ADMIN_SECTIONS, ADMIN_HUB_PATH, ADMIN_HUB_TITLE, path)).toBe('Telemetry');
    expect(
      settingsPageTitle(ADMIN_SECTIONS, ADMIN_HUB_PATH, ADMIN_HUB_TITLE, '/admin/settings/telemetry'),
    ).toBe('Telemetry');
  });
});

/**
 * Issue #726 (PP-6.7) — the Organizations group: two cards, APPENDED after
 * every existing one, both `feature: 'orgs'` (multi-org deployments only),
 * each declaring the exact permission its controller enforces.
 */
describe('the Organizations group (#726)', () => {
  // The organization controllers live in the identity slice of the platform
  // package since #727 (`@marinoscar/platform-api/identity`).
  const IDENTITY_SRC = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../../packages/platform-api/src/identity',
  );
  const rolesConstants = readApiPermissionConstants();
  const SETTINGS_SRC = resolve(IDENTITY_SRC, '..', 'settings');
  const group = ADMIN_SECTIONS.find((section) => section.label === 'Organizations');
  const cards = new Map((group?.cards ?? []).map((card) => [card.title, card]));
  const organization = cards.get('Organization');
  const organizations = cards.get('Organizations');
  const allPermissions = new Set([
    'system_settings:read',
    'users:read',
    'allowlist:read',
    'org_members:read',
    'org_invites:read',
    'organizations:read',
  ]);
  const ORGS_ON = { orgs: true };
  const titles = (held: string[], features = {}) =>
    titlesOf(visibleSettingsSections(ADMIN_SECTIONS, (p) => held.includes(p), '', features));

  it('is APPENDED as the last group, its cards in declaration order (#733 appended the third)', () => {
    // The last APPENDED group: only the pinned Danger Zone (#743) follows it.
    expect(ADMIN_SECTIONS[ADMIN_SECTIONS.length - 2]).toBe(group);
    expect(group?.cards.map((card) => card.title)).toEqual(['Organization', 'Organizations', 'Organization settings']);
  });

  it('declares Organization settings on org_settings:read, the settings slice controller string, feature orgs (#733)', () => {
    const orgSettings = cards.get('Organization settings');
    expect(orgSettings).toMatchObject({
      path: '/admin/settings/organization-settings',
      permission: 'org_settings:read',
      feature: 'orgs',
    });
    expect(orgSettings?.alwaysShow).toBeUndefined();
    const controller = readFileSync(resolve(SETTINGS_SRC, 'org-settings/org-settings.controller.ts'), 'utf8');
    expect(rolesConstants).toContain("ORG_SETTINGS_READ: 'org_settings:read'");
    expect(controller).toContain('ORG_SETTINGS_PERMISSIONS.ORG_SETTINGS_READ.id');
  });

  it('shows Organization settings only in multi-org mode, and only to a holder of org_settings:read (#733)', () => {
    expect(titles(['org_settings:read'])).not.toContain('Organization settings');
    expect(titles(['org_members:read'], ORGS_ON)).not.toContain('Organization settings');
    expect(titles(['org_settings:read'], ORGS_ON)).toEqual(['Organization settings']);
    expect(
      settingsPageTitle(ADMIN_SECTIONS, ADMIN_HUB_PATH, ADMIN_HUB_TITLE, '/admin/settings/organization-settings', ORGS_ON),
    ).toBe('Organization settings');
  });

  it('declares Organization on org_members:read, the org members controller string, feature orgs', () => {
    expect(organization).toMatchObject({
      path: '/admin/settings/organization',
      permission: 'org_members:read',
      feature: 'orgs',
    });
    expect(organization?.alwaysShow).toBeUndefined();
    const controller = readFileSync(resolve(IDENTITY_SRC, 'organizations/org-members.controller.ts'), 'utf8');
    expect(rolesConstants).toContain("ORG_MEMBERS_READ: 'org_members:read'");
    expect(controller).toContain('PERMISSIONS.ORG_MEMBERS_READ');
  });

  it('declares Organizations on organizations:read, the organizations admin controller string, feature orgs', () => {
    expect(organizations).toMatchObject({
      path: '/admin/settings/organizations',
      permission: 'organizations:read',
      feature: 'orgs',
    });
    const controller = readFileSync(resolve(IDENTITY_SRC, 'organizations/organizations-admin.controller.ts'), 'utf8');
    expect(rolesConstants).toContain("ORGANIZATIONS_READ: 'organizations:read'");
    expect(controller).toContain('PERMISSIONS.ORGANIZATIONS_READ');
  });

  it('is absent in a single-org deployment, even for a holder of every permission', () => {
    const held = [...allPermissions];
    expect(titles(held)).not.toContain('Organization');
    expect(titles(held)).not.toContain('Organizations');
    expect(titles(held, { orgs: false })).not.toContain('Organization');
    expect(
      settingsPageTitle(ADMIN_SECTIONS, ADMIN_HUB_PATH, ADMIN_HUB_TITLE, '/admin/settings/organizations'),
    ).toBe(ADMIN_HUB_TITLE);
  });

  it('shows both cards to a system admin who is also an org admin, in multi-org mode', () => {
    expect(titles([...allPermissions], ORGS_ON)).toEqual(expect.arrayContaining(['Organization', 'Organizations']));
  });

  it('shows an org admin without system permissions ONLY the Organization card', () => {
    const orgAdmin = ['org_members:read', 'org_members:write', 'org_invites:read', 'org_invites:write'];
    expect(titles(orgAdmin, ORGS_ON)).toEqual(['Organization']);
  });

  it('titles each route after its own card, the plural not swallowing the singular', () => {
    const title = (path: string) => settingsPageTitle(ADMIN_SECTIONS, ADMIN_HUB_PATH, ADMIN_HUB_TITLE, path, ORGS_ON);
    expect(title('/admin/settings/organization')).toBe('Organization');
    expect(title('/admin/settings/organizations')).toBe('Organizations');
  });
});

describe('the Danger Zone groups (#743)', () => {
  it('are pinned last in both registries, holding their card', () => {
    expect(dangerZoneLastViolations(ADMIN_SECTIONS, '/admin/settings/factory-reset')).toEqual([]);
    expect(dangerZoneLastViolations(USER_SETTINGS_SECTIONS, '/settings/danger-zone')).toEqual([]);
  });

  it('declare the exact permission the API enforces: system:factory_reset for the admin card, none for the user card', () => {
    const factory = ADMIN_SECTIONS.at(-1)!.cards[0]!;
    expect(factory).toMatchObject({ title: 'Factory reset', path: '/admin/settings/factory-reset', permission: 'system:factory_reset' });
    expect(factory.feature).toBeUndefined();
    const permissions = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../packages/platform-api/src/user-data/user-data.permissions.ts'), 'utf8');
    expect(permissions).toContain("id: 'system:factory_reset'");
    const controller = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../packages/platform-api/src/user-data/user-data.controller.ts'), 'utf8');
    expect(controller).toContain('@Auth({ permissions: [FACTORY] })');
    const mine = USER_SETTINGS_SECTIONS.at(-1)!.cards[0]!;
    expect(mine).toMatchObject({ title: 'Delete my data', path: '/settings/danger-zone' });
    expect(mine.permission).toBeUndefined();
    expect(mine.feature).toBeUndefined();
  });

  it('hides the factory reset from a system_settings:write holder who is not an Admin', () => {
    const titles = titlesOf(visibleSettingsSections(ADMIN_SECTIONS, (p) => p === 'system_settings:write' || p === 'system_settings:read', ''));
    expect(titles).not.toContain('Factory reset');
  });
});

/**
 * Issue #126, epic #109. The Notifications card follows the same
 * MANDATORY settings-registry pattern every other `/settings/*` card does
 * (see CLAUDE.md's "MANDATORY: Settings UI Pattern" and
 * `config/userSettingsSections.tsx`'s own header): declared once, here, with
 * NO `permission` field.
 *
 * Every other card under `USER_SETTINGS_SECTIONS` is unpermissioned for the
 * same reason - these are the caller's OWN settings, and the API grants
 * `user_settings:read` / `user_settings:write` to all three roles. A
 * `permission` field on this card would invent an authorization rule the API
 * does not enforce, and would lock a Viewer out of saying how they want to be
 * contacted.
 */
describe('USER_SETTINGS_SECTIONS - Notifications card (issue #126)', () => {
  function findNotificationsCard() {
    for (const section of USER_SETTINGS_SECTIONS) {
      const card = section.cards.find((c) => c.path === '/settings/notifications');
      if (card) return card;
    }
    return undefined;
  }

  it('is present in the registry', () => {
    const card = findNotificationsCard();
    expect(card).toBeDefined();
    expect(card?.title).toBe('Notifications');
  });

  it('declares no permission - reachable by every authenticated user, not gated on a specific one', () => {
    const card = findNotificationsCard();
    expect(card).toBeDefined();
    expect('permission' in (card as object)).toBe(false);
    expect(card?.permission).toBeUndefined();
  });

  it('points at /settings/notifications', () => {
    const card = findNotificationsCard();
    expect(card?.path).toBe('/settings/notifications');
  });

  it('is grouped under Account, not Security - it is about how the account is contacted, not a credential', () => {
    const accountSection = USER_SETTINGS_SECTIONS.find((s) => s.label === 'Account');
    expect(accountSection?.cards.some((c) => c.path === '/settings/notifications')).toBe(
      true,
    );
  });

  // The wider claim: this is not a one-off omission on this card, it is true
  // of the whole per-user registry (see the file's own header comment). A
  // regression that added a permission ANYWHERE in USER_SETTINGS_SECTIONS
  // would be exactly the kind of invented gate that CLAUDE.md's Settings UI
  // Pattern rule 3 warns against.
  /**
   * Replaces "no card declares a permission" (#425, epic #419), deliberately.
   *
   * Every per-user card edits something the API grants all three roles, so for
   * those a permission would invent a rule the API does not enforce. `AI Keys`
   * is the first exception, and a real one: `ai:use` is a grant a deployment
   * can withhold from a role (AI calls cost money), and the `/api/ai/keys`
   * controller enforces exactly that string. The allow-list keeps the rule for
   * everything else — a new gated user card has to be added here on purpose.
   */
  const PERMISSION_GATED_USER_CARDS: Record<string, string> = {
    '/settings/ai': 'ai:use',
    // #731: the org permission the `/api/groups` controller enforces.
    '/settings/groups': 'groups:read',
  };

  it('only cards listed in PERMISSION_GATED_USER_CARDS declare a permission', () => {
    const allCards = USER_SETTINGS_SECTIONS.flatMap((section) => section.cards);
    for (const card of allCards) {
      const expected = card.path ? PERMISSION_GATED_USER_CARDS[card.path] : undefined;
      expect(card.permission, `${card.title} permission`).toBe(expected);
    }
    // Every allow-listed card still exists — a stale entry is a silent hole.
    for (const path of Object.keys(PERMISSION_GATED_USER_CARDS)) {
      expect(allCards.some((card) => card.path === path), `${path} is registered`).toBe(true);
    }
  });
});

/**
 * Issue #731 (PP-7.4). The packaged groups page is ONE card in a new `Sharing`
 * section APPENDED after every existing one (Settings UI Pattern rule 1:
 * append, never insert), gated on the exact string the `/api/groups`
 * controller enforces (rule 3), with no `feature`.
 */
describe('USER_SETTINGS_SECTIONS - Groups card (issue #731)', () => {
  it('is the only card of a Sharing section, appended after the existing ones', () => {
    const sharing = USER_SETTINGS_SECTIONS.find((section) => section.label === 'Sharing');
    expect(sharing?.cards.map((card) => card.title)).toEqual(['Groups']);
  });

  it('leaves the existing sections, in order, untouched; later groups (#744 "Your data") append after it, and the Danger Zone (#743) stays last', () => {
    expect(USER_SETTINGS_SECTIONS.map((section) => section.label)).toEqual(['Account', 'Security', 'Sharing', 'Your data', 'Danger Zone']);
  });

  it('points at /settings/groups and declares groups:read and no feature', () => {
    const card = USER_SETTINGS_SECTIONS.flatMap((section) => section.cards).find((c) => c.title === 'Groups');
    expect(card?.path).toBe('/settings/groups');
    expect(card?.permission).toBe('groups:read');
    expect(card?.feature).toBeUndefined();
  });
});

/**
 * Issue #744 (PP-9.2). "Download your data" is ONE card in a `Your data`
 * section appended after every existing one, with no permission (the API
 * grants the `user-data` source to every role through `user_settings:read`)
 * and no feature.
 */
describe('USER_SETTINGS_SECTIONS - Download your data (issue #744)', () => {
  it('is the only card of the Your data section, ungated, at /settings/data-export', () => {
    const section = USER_SETTINGS_SECTIONS.find((s) => s.label === 'Your data');
    expect(section?.cards.map((card) => card.title)).toEqual(['Download your data']);
    expect(section?.cards[0]?.path).toBe('/settings/data-export');
    expect(section?.cards[0]?.permission).toBeUndefined();
    expect(section?.cards[0]?.feature).toBeUndefined();
  });
});
