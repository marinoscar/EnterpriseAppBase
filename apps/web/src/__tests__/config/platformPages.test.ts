/**
 * Packaged settings pages (#696): the app registers each one it uses as
 * exactly one card and one route (Settings UI Pattern rule 1), and the card's
 * permission is the exact string the packaged API controller enforces (rule 3).
 *
 * `PACKAGED_PAGES` is the list of packaged pages this app uses; a new one is
 * appended here when it is bound, and every assertion below applies to it.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { PlatformSettingsPage } from '@marinoscar/platform-web/core';
import { androidAppSettingsPage } from '@marinoscar/platform-web/android-app/ui';
import { doctorSettingsPage } from '@marinoscar/platform-web/doctor/ui';
import { gettingStartedSettingsPage, setupGuideSettingsPage } from '@marinoscar/platform-web/onboarding/ui';
import { telemetryAdminCards } from '@marinoscar/platform-web/telemetry/ui';
import { groupsSettingsPage } from '@marinoscar/platform-web/sharing/ui';
import { dataExportSettingsPage } from '@marinoscar/platform-web/exports/ui';

import { ADMIN_SECTIONS } from '../../config/adminSections';
import type { SettingsCardDef } from '@marinoscar/platform-web/settings/ui';
import { USER_SETTINGS_SECTIONS } from '../../config/userSettingsSections';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_TSX = resolve(HERE, '../../App.tsx');
const PLATFORM_API_SRC = resolve(HERE, '../../../../../packages/platform-api/src');

/** The packaged pages this app binds, with the API source that enforces each one's permission. */
const PACKAGED_PAGES: ReadonlyArray<{
  page: PlatformSettingsPage<never>;
  /** File and literal of the packaged controller's default permission. */
  enforcedBy: { file: string; literal: string };
}> = [
  {
    page: doctorSettingsPage,
    enforcedBy: {
      file: resolve(PLATFORM_API_SRC, 'doctor/doctor.module.ts'),
      literal: "export const DEFAULT_DOCTOR_PERMISSION = 'system_settings:read';",
    },
  },
  // #731: the `/api/groups` routes enforce SHARING_PERMISSIONS.GROUPS_READ,
  // whose declaration carries the string.
  {
    page: groupsSettingsPage,
    enforcedBy: {
      file: resolve(PLATFORM_API_SRC, 'sharing/permissions.ts'),
      literal: "id: 'groups:read',",
    },
  },
  {
    // #745: the admin block of GET /api/onboarding and the metrics route.
    page: setupGuideSettingsPage,
    enforcedBy: {
      file: resolve(HERE, '../../../../../packages/platform-contract/src/onboarding/constants.ts'),
      literal: "export const ONBOARDING_ADMIN_PERMISSION = 'system_settings:read' as const;",
    },
  },
];

/** Packaged USER pages this app binds: one card, one route, no permission (every role holds `user_settings:read`). */
const PACKAGED_USER_PAGES: ReadonlyArray<PlatformSettingsPage<never>> = [gettingStartedSettingsPage, dataExportSettingsPage];

/** Every `<Route>` in App.tsx as `path` -> the `permission` it wraps (same parser as destinations.test.ts). */
function declaredRouteGates(): Array<{ path: string; permission: string | null }> {
  const source = readFileSync(APP_TSX, 'utf8');
  return source
    .split('<Route')
    .slice(1)
    .map((chunk) => ({
      path: /^\s*path="([^"]+)"/.exec(chunk)?.[1],
      permission: /permission="([^"]+)"/.exec(chunk)?.[1] ?? null,
    }))
    .filter((route): route is { path: string; permission: string | null } => route.path !== undefined);
}

describe('packaged settings pages', () => {
  it("a feature-less page's card is assignable to the app's SettingsCardDef (minus Icon)", () => {
    expectTypeOf<PlatformSettingsPage<never>['card']>().toMatchTypeOf<Omit<SettingsCardDef, 'Icon'>>();
    expectTypeOf<{ Icon: PlatformSettingsPage['Icon'] }>().toMatchTypeOf<Pick<SettingsCardDef, 'Icon'>>();
  });

  for (const { page, enforcedBy } of PACKAGED_PAGES) {
    describe(page.id, () => {
      const cards = [...ADMIN_SECTIONS, ...USER_SETTINGS_SECTIONS].flatMap((section) => section.cards);

      it('has exactly one card, built from the descriptor', () => {
        const matching = cards.filter((card) => card.path === page.card.path);
        expect(matching).toHaveLength(1);
        expect(matching[0]).toEqual({ ...page.card, Icon: page.Icon });
      });

      it('has exactly one route, gated on the card permission', () => {
        const routes = declaredRouteGates().filter((route) => route.path === page.card.path);
        expect(routes).toHaveLength(1);
        expect(routes[0]?.permission).toBe(page.card.permission ?? null);
      });

      it('declares the permission the packaged controller enforces by default', () => {
        expect(readFileSync(enforcedBy.file, 'utf8')).toContain(enforcedBy.literal);
        expect(enforcedBy.literal).toContain(`'${page.card.permission}'`);
      });
    });
  }
});

/**
 * The telemetry slice (#704) contributes its three Observability cards as data;
 * the app spreads them where its literals were and keeps its own routes.
 */
describe('packaged telemetry cards', () => {
  const observability = ADMIN_SECTIONS.find((section) => section.label === 'Observability');
  const cards = [...ADMIN_SECTIONS, ...USER_SETTINGS_SECTIONS].flatMap((section) => section.cards);

  it('sit in the Observability section, in their order, before the Doctor card', () => {
    expect(observability?.cards.map((card) => card.path)).toEqual([
      ...telemetryAdminCards.map((card) => card.path),
      doctorSettingsPage.card.path,
    ]);
  });

  it("are each card's only registration, unchanged", () => {
    for (const card of telemetryAdminCards) {
      const matching = cards.filter((entry) => entry.path === card.path);
      expect(matching).toHaveLength(1);
      expect(matching[0]).toEqual(card);
    }
  });

  it('are assignable to the app card type', () => {
    expectTypeOf<(typeof telemetryAdminCards)[number]>().toMatchTypeOf<SettingsCardDef>();
  });

  it('each have exactly one route, gated on the card permission', () => {
    for (const card of telemetryAdminCards) {
      const routes = declaredRouteGates().filter((route) => route.path === card.path);
      expect(routes, card.path).toHaveLength(1);
      expect(routes[0]?.permission).toBe(card.permission ?? null);
    }
  });

  it('feature-gated cards have feature-gated routes; the Telemetry page is reachable while telemetry is off', () => {
    const source = readFileSync(APP_TSX, 'utf8');
    for (const card of telemetryAdminCards) {
      const chunk = source.split('<Route').find((part) => part.includes(`path="${card.path}"`)) ?? '';
      expect(chunk.includes('<RequireTelemetryEnabled>'), card.path).toBe(card.feature === 'telemetry');
    }
  });
});


/**
 * The onboarding slice (#745): the Setup guide is an admin card (General,
 * appended) and Getting started a user card (Account, appended), each with
 * one route; a Danger Zone group, when one exists, stays last.
 */
describe('packaged onboarding pages', () => {
  const cards = [...ADMIN_SECTIONS, ...USER_SETTINGS_SECTIONS].flatMap((section) => section.cards);

  for (const page of PACKAGED_USER_PAGES) {
    it(`${page.id}: one card from the descriptor and one ungated route`, () => {
      const matching = cards.filter((card) => card.path === page.card.path);
      expect(matching).toEqual([{ ...page.card, Icon: page.Icon }]);
      expect(page.card.permission).toBeUndefined();
      const routes = declaredRouteGates().filter((route) => route.path === page.card.path);
      expect(routes).toEqual([{ path: page.card.path, permission: null }]);
    });
  }

  it('appends the Setup guide to General and Getting started to Account', () => {
    // Append-only: only the cards appended after the Setup guide follow it (the Android app, #746).
    const general = ADMIN_SECTIONS.find((s) => s.label === 'General')?.cards.map((card) => card.path) ?? [];
    expect(general.slice(general.indexOf(setupGuideSettingsPage.card.path))).toEqual([
      setupGuideSettingsPage.card.path,
      androidAppSettingsPage.card.path,
    ]);
    expect(USER_SETTINGS_SECTIONS.find((s) => s.label === 'Account')?.cards.at(-1)?.path).toBe(gettingStartedSettingsPage.card.path);
  });

  it('keeps any Danger Zone group last', () => {
    for (const sections of [ADMIN_SECTIONS, USER_SETTINGS_SECTIONS]) {
      const index = sections.findIndex((section) => /danger zone/i.test(section.label));
      if (index !== -1) expect(index).toBe(sections.length - 1);
    }
  });
});
