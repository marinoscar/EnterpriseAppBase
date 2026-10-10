/**
 * Telemetry web/API permission parity (PP-4.6; conformance check 7 of the
 * telemetry slice).
 *
 * The Settings UI Pattern (rule 3) says a card's `permission` is the exact string
 * the API controller enforces. For the packaged telemetry cards that is checkable
 * without a controller: the API slice exports the permission strings it declares
 * as pure data (`TELEMETRY_PERMISSIONS`, `TELEMETRY_HOST_PERMISSIONS`), and the
 * route table of the reference app is `App.tsx`. So this suite asserts, for every
 * card in `telemetryAdminCards`:
 *
 *   - its permission is one of the slice's three, or `system_settings:read`;
 *   - the app registers it in the admin hub exactly once;
 *   - its path is a route of `App.tsx`, gated on the SAME permission.
 *
 * The check is a pure function over (cards, routes), exercised first on broken
 * fixtures so a check that cannot fail cannot pass the real cards by accident.
 * It reads the LIVE App.tsx, like `destinations.test.ts`, never a copy of it.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { telemetryAdminCards } from '@marinoscar/platform-web/telemetry/ui';

// Pure data (no Nest import): the permission strings the telemetry controllers enforce.
import {
  TELEMETRY_HOST_PERMISSIONS,
  TELEMETRY_PERMISSIONS,
} from '../../../../../packages/platform-api/src/telemetry/telemetry.permissions';
import { ADMIN_SECTIONS } from '../../config/adminSections';

const APP_TSX = resolve(dirname(fileURLToPath(import.meta.url)), '../../App.tsx');

/** The permissions a telemetry card may name: the three the slice declares, and the settings read the services section uses. */
const ALLOWED: readonly string[] = [...Object.values(TELEMETRY_PERMISSIONS), TELEMETRY_HOST_PERMISSIONS.SYSTEM_SETTINGS_READ];

interface Card {
  path: string;
  permission?: string;
}
interface RouteGate {
  path: string;
  permission: string | null;
}

/** Every `<Route>` in App.tsx as `path` -> the `permission` it wraps (same parser as platformPages.test.ts). */
function declaredRouteGates(): RouteGate[] {
  return readFileSync(APP_TSX, 'utf8')
    .split('<Route')
    .slice(1)
    .map((chunk) => ({
      path: /^\s*path="([^"]+)"/.exec(chunk)?.[1],
      permission: /permission="([^"]+)"/.exec(chunk)?.[1] ?? null,
    }))
    .filter((route): route is RouteGate => route.path !== undefined);
}

/** What is wrong with `cards` against `routes`, `registered` card paths and the `allowed` permissions. */
function parityProblems(cards: readonly Card[], routes: readonly RouteGate[], registered: readonly string[], allowed: readonly string[]): string[] {
  const problems: string[] = [];
  for (const card of cards) {
    if (!card.permission || !allowed.includes(card.permission)) {
      problems.push(`${card.path}: permission "${card.permission}" is not one of ${allowed.join(', ')}`);
    }
    const hubEntries = registered.filter((path) => path === card.path).length;
    if (hubEntries !== 1) problems.push(`${card.path}: registered ${hubEntries} times in the admin hub, expected once`);
    const matching = routes.filter((route) => route.path === card.path);
    if (matching.length !== 1) {
      problems.push(`${card.path}: ${matching.length} routes in App.tsx, expected one`);
    } else if (matching[0].permission !== (card.permission ?? null)) {
      problems.push(`${card.path}: the route is gated on "${matching[0].permission}" but the card on "${card.permission}"`);
    }
  }
  return problems;
}

describe('telemetry web/API permission parity: the check itself', () => {
  const route: RouteGate = { path: '/admin/settings/telemetry', permission: 'telemetry:read' };
  const card: Card = { path: '/admin/settings/telemetry', permission: 'telemetry:read' };

  it('accepts a card whose permission, hub entry and route agree', () => {
    expect(parityProblems([card], [route], [card.path], ALLOWED)).toEqual([]);
  });

  it('rejects an invented permission (the string the controller enforces is exact)', () => {
    expect(parityProblems([{ ...card, permission: 'telemetry:view' }], [route], [card.path], ALLOWED).join()).toMatch(/not one of/);
  });

  it('rejects a card with no route, a duplicated route and a card missing from the hub', () => {
    expect(parityProblems([card], [], [card.path], ALLOWED).join()).toMatch(/0 routes in App\.tsx/);
    expect(parityProblems([card], [route, route], [card.path], ALLOWED).join()).toMatch(/2 routes in App\.tsx/);
    expect(parityProblems([card], [route], [], ALLOWED).join()).toMatch(/registered 0 times/);
  });

  it('rejects a route gated more weakly or more strongly than its card', () => {
    expect(parityProblems([card], [{ ...route, permission: null }], [card.path], ALLOWED).join()).toMatch(/gated on "null"/);
    expect(parityProblems([card], [{ ...route, permission: 'telemetry:query' }], [card.path], ALLOWED).join()).toMatch(/gated on "telemetry:query"/);
  });
});

describe('telemetry web/API permission parity: the reference app', () => {
  it('has the three packaged cards, so the check is not vacuous', () => {
    expect(telemetryAdminCards.map((card) => card.title)).toEqual(['Telemetry', 'Telemetry Explorer', 'Telemetry Dashboard']);
  });

  it('every telemetry card names a permission the slice enforces, is registered once and routed behind the same permission', () => {
    const registered = ADMIN_SECTIONS.flatMap((section) => section.cards.map((card) => card.path));
    expect(parityProblems(telemetryAdminCards, declaredRouteGates(), registered, ALLOWED)).toEqual([]);
  });

  it('the strings are the exact ones the API controllers declare', () => {
    expect(ALLOWED).toEqual(['telemetry:read', 'telemetry:write', 'telemetry:query', 'system_settings:read']);
  });
});
