// =============================================================================
// Suite: the AI settings cards (issues #435, #742; AI rule 5)
// =============================================================================
//
// Each AI card's `permission` is a string the API enforces on the AI surface,
// and every AI card declares `feature: 'ai'` so it is hidden while AI is off,
// except the admin `AI` card, which is where AI is switched on.
//
// The reference app proved the first half by reading the AI controllers'
// SOURCE (`aiAdminController` contains `PERMISSIONS.AI_CONFIG_READ`). Once the
// controllers live in `@marinoscar/platform-api/ai` that cannot work for an app
// that consumes the package, so it is checked against DATA instead:
//
//   - the permission must be in `apiPermissions`, the permission catalog the
//     API generates (and the seed derives from);
//   - when the app has its OpenAPI document (`openApiDocument`), it must also
//     be a permission some route of the AI surface declares in its `x-rbac`
//     metadata, which is what `@Auth()` enforces.
//
// AI cards are DISCOVERED: any card with `feature: 'ai'`, or routed under an
// `ai` segment of its hub. A fifth AI card added later is covered with no edit.
//
// The AI slice's own permission ids (`ai:use`, `ai_config:*`, `org_ai_config:*`)
// are named here because they ARE the slice's contract, the same way the API
// suites name them.
// =============================================================================

import type { WebConformanceCard, WebConformanceContext, WebConformanceTestApi } from '../../testing/index.js';
import { webConformanceSuites } from '../../testing/index.js';
import { visibleSettingsSections } from '../ui/registry.js';
import { asSections, cardsOf, permissionsOf, titlesOf } from './sections.js';

const AI_USE = 'ai:use';
const AI_CONFIG = ['ai_config:read', 'ai_config:write'] as const;
const ORG_AI_CONFIG = ['org_ai_config:read', 'org_ai_config:write'] as const;
const AI_SEGMENT = /(^|\/)ai(\/|$)/;

/** Permissions the OpenAPI document declares (`x-rbac`) on operations whose path contains an `ai` segment. */
function aiRoutePermissions(document: NonNullable<WebConformanceContext['openApiDocument']>): Set<string> {
  const found = new Set<string>();

  for (const [path, item] of Object.entries(document.paths ?? {})) {
    if (!AI_SEGMENT.test(path) || typeof item !== 'object' || item === null) continue;
    for (const operation of Object.values(item as Record<string, unknown>)) {
      const rbac = (operation as { 'x-rbac'?: { permissions?: string[] } } | null)?.['x-rbac'];
      for (const permission of rbac?.permissions ?? []) found.add(permission);
    }
  }

  return found;
}

function register(api: WebConformanceTestApi, context: WebConformanceContext): void {
  const { describe, it, expect } = api;
  const adminAiSwitchPath = `${context.hubs.admin.path}/ai`;
  const isAiCard = (card: WebConformanceCard): boolean => card.feature === 'ai' || (card.path !== undefined && AI_SEGMENT.test(card.path));
  const admin = cardsOf(context.adminSections).filter(isAiCard);
  const user = cardsOf(context.userSettingsSections).filter(isAiCard);
  const all = [...admin, ...user];
  const known = new Set(context.apiPermissions);

  describe('AI settings cards: permission parity with the API, and feature gating', () => {
    it('knows the AI permissions the cards are checked against, so a broken catalog import cannot pass vacuously', () => {
      const missing = [AI_USE, ...AI_CONFIG, ...ORG_AI_CONFIG].filter((permission) => !known.has(permission));

      expect(missing).toEqual([]);
    });

    it('finds the AI-tagged cards at all, so a broken discovery cannot pass vacuously', () => {
      expect(admin.length).toBeGreaterThanOrEqual(3); // AI, AI Models, AI Usage
      expect(user.length).toBeGreaterThanOrEqual(1); // AI Keys
    });

    describe('admin cards', () => {
      it('every one declares an ai_config:* or org_ai_config:* permission, never invented', () => {
        const allowed = new Set<string>([...AI_CONFIG, ...ORG_AI_CONFIG]);
        const offenders = admin.filter((card) => permissionsOf(card).length !== 1 || !allowed.has(permissionsOf(card)[0] as string));

        expect(offenders.map((card) => card.title)).toEqual([]);
      });

      it('an organization card (org_ai_config:*) is feature-gated, and a system card never uses an org permission', () => {
        const offenders = admin.filter((card) => {
          const [permission] = permissionsOf(card);
          const org = (ORG_AI_CONFIG as readonly string[]).includes(permission as string);
          return org && card.feature !== 'ai';
        });

        expect(offenders.map((card) => card.title)).toEqual([]);
      });

      it('is never confused with ai:use: an admin AI card must not mirror the per-user permission', () => {
        expect(admin.filter((card) => permissionsOf(card).includes(AI_USE)).map((card) => card.title)).toEqual([]);
      });

      it('declares permissions that routes of the AI surface really enforce (x-rbac), when the OpenAPI document is given', () => {
        if (context.openApiDocument === undefined) return; // not generated in this environment; apiPermissions covers existence
        const enforced = aiRoutePermissions(context.openApiDocument);
        const offenders = admin.flatMap((card) =>
          permissionsOf(card)
            .filter((permission) => !enforced.has(permission))
            .map((permission) => `${card.title}: ${permission}`),
        );

        expect(enforced.size).toBeGreaterThanOrEqual(1);
        expect(offenders).toEqual([]);
      });
    });

    describe('user cards', () => {
      it('declares exactly ai:use, the string the per-user AI routes enforce', () => {
        expect(user.filter((card) => permissionsOf(card).join() !== AI_USE).map((card) => card.title)).toEqual([]);
      });

      it('declares a permission that a per-user AI route really enforces (x-rbac), when the OpenAPI document is given', () => {
        if (context.openApiDocument === undefined) return; // not generated in this environment; apiPermissions covers existence
        const enforced = aiRoutePermissions(context.openApiDocument);

        expect(user.flatMap((card) => permissionsOf(card)).filter((permission) => !enforced.has(permission))).toEqual([]);
      });

      it('is never confused with ai_config:*: a per-user card must not mirror a deployment-wide permission', () => {
        const wide = new Set<string>([...AI_CONFIG, ...ORG_AI_CONFIG]);

        expect(user.filter((card) => permissionsOf(card).some((permission) => wide.has(permission))).map((card) => card.title)).toEqual([]);
      });
    });

    describe('feature gating: every AI card is feature-gated except the one that switches AI on', () => {
      it('every AI-tagged card declares feature "ai", except the admin AI card itself', () => {
        const missing = all.filter((card) => card.path !== adminAiSwitchPath).filter((card) => card.feature !== 'ai');

        expect(missing.map((card) => card.title)).toEqual([]);
      });

      it('the admin AI card (the switch itself) deliberately carries no feature gate', () => {
        const switchCard = admin.find((card) => card.path === adminAiSwitchPath);

        expect(switchCard === undefined ? 'no AI switch card' : switchCard.feature).toEqual(undefined);
      });

      it('every AI card is deniable: none is an alwaysShow escape hatch', () => {
        expect(all.filter((card) => card.alwaysShow !== undefined).map((card) => card.title)).toEqual([]);
      });
    });

    it('an admin holding every OTHER permission still sees no AI card, with the feature on', () => {
      const aiPermissions = new Set<string>([AI_USE, ...AI_CONFIG, ...ORG_AI_CONFIG]);
      const result = visibleSettingsSections(asSections(context.adminSections), (permission) => !aiPermissions.has(permission), '', { ai: true });
      const shown = titlesOf(result);

      expect(admin.filter((card) => shown.includes(card.title)).map((card) => card.title)).toEqual([]);
    });
  });
}

/**
 * The suite behind `runPlatformWebConformance`: AI cards declare permissions
 * the API enforces and `feature: 'ai'` (AI rule 5).
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const settingsAiCardsSuite = {
  id: 'settings-ai-cards',
  title: 'AI settings cards: permission parity with the API, and feature gating (#435)',
  description:
    'Every AI settings card carries a permission the API enforces and feature "ai", except the admin AI card that switches AI on (AI rule 5; Settings UI Pattern rule 3).',
  register,
} as const;

webConformanceSuites.register(settingsAiCardsSuite);
