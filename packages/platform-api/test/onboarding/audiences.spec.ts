// The open audience vocabulary (PP-14.20): the org_admin built-in, the
// registry, the engine's extra blocks and the proof that user and admin
// visibility did not widen.
import { RegistryError, withTemporaryEntries } from '../../src/core/index';
import {
  OnboardingService,
  PLATFORM_ONBOARDING_AUDIENCES,
  evaluateOnboarding,
  onboardingAudienceRegistry,
  onboardingFactRegistry,
  onboardingOrderingRegistry,
  onboardingStepRegistry,
  registerOnboardingAudience,
  type OnboardingAudienceDef,
  type OnboardingEngineInput,
  type OnboardingFactDef,
  type OnboardingRequestContext,
  type OnboardingStepDef,
} from '../../src/onboarding/index';
import type { ConfigService } from '@nestjs/config';
import type { ModuleRef } from '@nestjs/core';
import { USER_ID, boolStep, countedFact, fakeData } from './support';

const ORG = '22222222-2222-4222-8222-222222222222';
const ADMIN_PERMISSION = 'system_settings:read';

interface Who {
  permissions?: string[];
  roles?: string[];
  activeOrgId?: string | null;
}

function input(steps: OnboardingStepDef[], facts: OnboardingFactDef[], who: Who = {}, extra: Partial<OnboardingEngineInput> = {}): OnboardingEngineInput {
  const { permissions = [], roles = [], activeOrgId = null } = who;
  return {
    steps,
    facts,
    orderings: [],
    includeAdmin: permissions.includes(ADMIN_PERMISSION),
    audiences: onboardingAudienceRegistry.list(),
    audienceContext: { adminPermission: ADMIN_PERMISSION },
    skipped: [],
    context: (doctorCheckIds, fact): OnboardingRequestContext => ({
      caller: { id: USER_ID, permissions, roles, activeOrgId },
      refresh: false,
      data: fakeData(),
      doctor: null,
      doctorCheckIds,
      initialAdminEmail: null,
      isFeatureEnabled: async () => true,
      fact: (id) => fact(id) as never,
      get: () => {
        throw new Error('none');
      },
    }),
    ...extra,
  };
}

const orgStep = (id: string, extra: Partial<OnboardingStepDef> = {}) => boolStep(id, 'f', { audience: 'org_admin', ...extra });

describe('the audience registry', () => {
  it('starts with exactly the three platform audiences, registered through the public function', () => {
    expect(onboardingAudienceRegistry.ids()).toEqual(['user', 'admin', 'org_admin']);
    expect(PLATFORM_ONBOARDING_AUDIENCES.map((a) => a.id)).toEqual(['user', 'admin', 'org_admin']);
    // idempotent for the same object
    expect(() => registerOnboardingAudience(...PLATFORM_ONBOARDING_AUDIENCES)).not.toThrow();
  });

  it('registers an app audience and refuses a duplicate, a bad id and an invalid entry', () =>
    withTemporaryEntries(onboardingAudienceRegistry, [], () => {
      const coaches: OnboardingAudienceDef = { id: 'coaches', label: 'Coaches', matches: (p) => p.roles.includes('coach') };
      registerOnboardingAudience(coaches);
      expect(onboardingAudienceRegistry.get('coaches')).toBe(coaches);
      expect(() => registerOnboardingAudience({ ...coaches })).toThrow(/already registered.*permanent/);
      expect(() => registerOnboardingAudience({ ...coaches, id: 'Coaches' })).toThrow(RegistryError);
      expect(() => registerOnboardingAudience({ ...coaches, id: 'c2', label: ' ' })).toThrow(/label is required/);
      expect(() => registerOnboardingAudience({ ...coaches, id: 'c3', matches: undefined as never })).toThrow(/matches must be a function/);
    }));

  it('refuses a step or an ordering naming an audience nobody registered, and says how to fix it', () =>
    withTemporaryEntries(onboardingStepRegistry, [], () => {
      expect(() => onboardingStepRegistry.register(boolStep('user.x', 'f', { audience: 'coaches' }))).toThrow(
        /audience "coaches" is not registered.*registerOnboardingAudience/,
      );
      expect(() => onboardingOrderingRegistry.register({ audience: 'coaches', facts: [], order: (s) => s })).toThrow(/audience "coaches" is not registered/);
      expect(() => onboardingStepRegistry.register(orgStep('org.x'))).not.toThrow();
    }));
});

describe('the org_admin audience', () => {
  const facts = [countedFact('f', true)];

  it('puts org_admin steps under audiences.org_admin, for an org admin only', async () => {
    const steps = [orgStep('org.invite')];
    const orgAdmin = await evaluateOnboarding(input(steps, facts, { roles: ['org_admin'], activeOrgId: ORG }));
    expect(orgAdmin.audiences?.['org_admin']?.steps.map((s) => [s.id, s.audience, s.status])).toEqual([['org.invite', 'org_admin', 'done']]);
    expect(orgAdmin.audiences?.['org_admin']?.total).toBe(1);
    expect(orgAdmin.user.steps).toEqual([]);
    expect(orgAdmin.admin).toBeNull();

    for (const who of [{}, { roles: ['contributor'], activeOrgId: ORG }, { roles: ['viewer'], activeOrgId: ORG }, { roles: ['org_admin'], activeOrgId: null }]) {
      const result = await evaluateOnboarding(input(steps, facts, who));
      expect(result.audiences).toBeUndefined();
      expect(result.user.steps).toEqual([]);
    }
  });

  it('does not widen the admin or the user checklist', async () => {
    const steps = [orgStep('org.invite'), boolStep('admin.thing', 'f', { audience: 'admin' }), boolStep('user.thing', 'f')];
    const asOrgAdmin = await evaluateOnboarding(input(steps, facts, { roles: ['org_admin'], activeOrgId: ORG }));
    // Holding the org_admin ROLE gives no Setup guide; the admin permission does.
    expect(asOrgAdmin.admin).toBeNull();
    expect(asOrgAdmin.user.steps.map((s) => s.id)).toEqual(['user.thing']);

    const asSysAdmin = await evaluateOnboarding(input(steps, facts, { permissions: [ADMIN_PERMISSION] }));
    expect(asSysAdmin.admin?.steps.map((s) => s.id)).toEqual(['admin.thing']);
    // Holding the admin PERMISSION gives no org_admin block.
    expect(asSysAdmin.audiences).toBeUndefined();
    expect(asSysAdmin.user.steps.map((s) => s.id)).toEqual(['user.thing']);

    // a user step never lands in another audience's block, whatever the roles
    const both = await evaluateOnboarding(input(steps, facts, { permissions: [ADMIN_PERMISSION], roles: ['org_admin'], activeOrgId: ORG }));
    expect(both.user.steps.map((s) => s.id)).toEqual(['user.thing']);
    expect(both.admin?.steps.map((s) => s.id)).toEqual(['admin.thing']);
    expect(both.audiences?.['org_admin']?.steps.map((s) => s.id)).toEqual(['org.invite']);
  });

  it('still applies the step permission, and resolves no fact for a caller outside the audience', async () => {
    const counted = countedFact('f', true);
    const steps = [orgStep('org.guarded', { permission: 'org_invites:write' })];
    const lacking = await evaluateOnboarding(input(steps, [counted], { roles: ['org_admin'], activeOrgId: ORG }));
    expect(lacking.audiences).toBeUndefined();
    expect(counted.count()).toBe(0);

    const holding = await evaluateOnboarding(input(steps, [counted], { roles: ['org_admin'], activeOrgId: ORG, permissions: ['org_invites:write'] }));
    expect(holding.audiences?.['org_admin']?.steps).toHaveLength(1);
    expect(counted.count()).toBe(1);

    const outsider = await evaluateOnboarding(input([orgStep('org.other')], [counted], {}));
    expect(outsider.audiences).toBeUndefined();
    expect(counted.count()).toBe(1);
  });

  it('omits an audience block with no steps for the caller', async () => {
    const result = await evaluateOnboarding(input([boolStep('user.only', 'f')], [countedFact('f', true)], { roles: ['org_admin'], activeOrgId: ORG }));
    expect(result.audiences).toBeUndefined();
  });
});

describe('an app audience', () => {
  it('matches on its own rule, and a throwing rule means "does not apply"', () =>
    withTemporaryEntries(onboardingAudienceRegistry, [], async () => {
      registerOnboardingAudience(
        { id: 'coaches', label: 'Coaches', matches: (p) => p.roles.includes('coach') },
        { id: 'broken', label: 'Broken', matches: () => { throw new Error('boom'); } },
      );
      const steps = [boolStep('app.coach', 'f', { audience: 'coaches' }), boolStep('app.broken', 'f', { audience: 'broken' })];
      const warnings: string[] = [];
      const coach = await evaluateOnboarding(input(steps, [countedFact('f', true)], { roles: ['coach'] }, { warn: (m) => warnings.push(m) }));
      expect(Object.keys(coach.audiences ?? {})).toEqual(['coaches']);
      expect(warnings.join('\n')).toMatch(/audience "broken" threw while matching/);
      const other = await evaluateOnboarding(input(steps, [countedFact('f', true)], {}));
      expect(other.audiences).toBeUndefined();
    }));

  it('cannot take over user or admin: a registered rule for those ids is ignored by the engine', async () => {
    const hijack: OnboardingAudienceDef[] = [{ id: 'user', label: 'x', matches: () => false }, { id: 'admin', label: 'x', matches: () => true }];
    const result = await evaluateOnboarding(
      input([boolStep('admin.thing', 'f', { audience: 'admin' }), boolStep('user.thing', 'f')], [countedFact('f', true)], {}, { audiences: hijack }),
    );
    expect(result.admin).toBeNull();
    expect(result.user.steps.map((s) => s.id)).toEqual(['user.thing']);
  });
});

describe('OnboardingService with audiences', () => {
  const config = { get: () => undefined } as unknown as ConfigService;
  const moduleRef = { get: () => undefined } as unknown as ModuleRef;

  it('returns audiences only when a block exists, and keeps the original shape otherwise', () =>
    withTemporaryEntries(onboardingFactRegistry, [{ id: 'f', resolve: async () => true }], () =>
      withTemporaryEntries(onboardingStepRegistry, [orgStep('org.invite')], async () => {
        const service = new OnboardingService(fakeData(), moduleRef, undefined, undefined, undefined, config);
        const orgAdmin = await service.get({ id: USER_ID, permissions: ['user_settings:read'], roles: ['org_admin'], activeOrgId: ORG });
        expect(orgAdmin.audiences?.['org_admin']?.steps.map((s) => s.id)).toEqual(['org.invite']);
        expect(orgAdmin.admin).toBeNull();

        const member = await service.get({ id: USER_ID, permissions: ['user_settings:read'], roles: ['viewer'], activeOrgId: ORG });
        expect(Object.keys(member).sort()).toEqual(['admin', 'settings', 'user']);
        expect('audiences' in member).toBe(false);
      }),
    ));
});
