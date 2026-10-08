// =============================================================================
// The reference app's onboarding extension examples (issue #745)
// =============================================================================
//
// Each example in `platform-extensions/onboarding/examples/` registers and
// behaves as its header says: the app step reads its fact once through
// `ctx.get`, the admin step follows the reference app's `db.rls_role` Doctor
// check, the milestone and the funnel step enter the metrics statement, the
// ordering puts unfinished steps first and the extension keeps the
// namespace strict.
// =============================================================================

import type { ModuleRef } from '@nestjs/core';
import { withTemporaryEntries } from '@marinoscar/platform-api/core';
import type { DoctorCheckRegistry, DoctorService } from '@marinoscar/platform-api/doctor';
import {
  ONBOARDING_USER_SETTINGS,
  OnboardingMetricsService,
  OnboardingService,
  activationMilestoneRegistry,
  onboardingFactRegistry,
  onboardingOrderingRegistry,
  onboardingStepRegistry,
  type OnboardingDataPort,
} from '@marinoscar/platform-api/onboarding';
import { extendUserSettingsNamespace } from '@marinoscar/platform-api/settings';

import '../../src/onboarding/onboarding.manifest';
import { RLS_ROLE_STEP } from '../../src/platform-extensions/onboarding/examples/admin-doctor-step.example';
import {
  FIRST_TOKEN_MILESTONE,
  ROLE_QUESTION_EXTENSION,
  UNFINISHED_FIRST_ORDERING,
} from '../../src/platform-extensions/onboarding/examples/activation.example';
import {
  FIRST_TOKEN_STEP,
  PERSONAL_TOKEN_COUNT_FACT,
} from '../../src/platform-extensions/onboarding/examples/user-step-with-fact.example';
import { PrismaService } from '../../src/prisma/prisma.service';

const USER_ID = '22222222-2222-4222-8222-222222222222';

function data(overrides: Partial<OnboardingDataPort> = {}): OnboardingDataPort {
  return {
    readUserSettingsValue: async () => null,
    countAllowlistEntriesExcept: async () => 0,
    queryAggregate: async () => [],
    ...overrides,
  };
}

describe('onboarding reference examples', () => {
  it('derives the app step from its fact, read once through ctx.get', () =>
    withTemporaryEntries(onboardingFactRegistry, [PERSONAL_TOKEN_COUNT_FACT], () =>
      withTemporaryEntries(onboardingStepRegistry, [FIRST_TOKEN_STEP], () =>
        withTemporaryEntries(onboardingOrderingRegistry, [UNFINISHED_FIRST_ORDERING], async () => {
          const count = jest.fn().mockResolvedValue(1);
          const moduleRef = {
            get: (token: unknown) => {
              expect(token).toBe(PrismaService);
              return { personalAccessToken: { count } };
            },
          } as unknown as ModuleRef;
          const result = await new OnboardingService(data(), moduleRef).get({ id: USER_ID, permissions: ['user_settings:read'] });

          expect(count).toHaveBeenCalledTimes(1);
          expect(count).toHaveBeenCalledWith({ where: { userId: USER_ID, revokedAt: null } });
          // The ordering put the unfinished platform steps before the done example step.
          expect(result.user.steps.map((s) => [s.id, s.status])).toEqual([
            ['user.profile', 'todo'],
            ['user.notifications', 'todo'],
            ['reference.first-token', 'done'],
          ]);
        }),
      ),
    ));

  it('follows the db.rls_role Doctor check for the admin step', () =>
    withTemporaryEntries(onboardingStepRegistry, [RLS_ROLE_STEP], async () => {
      const doctor = {
        run: async () => ({
          verdict: 'pass',
          generatedAt: new Date(0).toISOString(),
          durationMs: 0,
          checks: [{ id: 'db.rls_role', category: 'core', label: 'DB role', settingsPath: null, status: 'pass', detail: 'ok', remedy: null, error: null, data: null, durationMs: 0 }],
        }),
      } as unknown as DoctorService;
      const checks = { get: (id: string) => (id === 'db.rls_role' ? { id, category: 'core' } : undefined) } as unknown as DoctorCheckRegistry;
      const service = new OnboardingService(data(), {} as ModuleRef, undefined, doctor, checks);
      const result = await service.get({ id: USER_ID, permissions: ['system_settings:read'] });
      expect(result.admin?.steps.find((s) => s.id === 'reference.db-role')).toEqual(
        expect.objectContaining({ status: 'done', tier: 'required', skippable: false }),
      );
    }));

  it('puts the milestone and the funnel step in the metrics statement', () =>
    withTemporaryEntries(onboardingStepRegistry, [FIRST_TOKEN_STEP], () =>
      withTemporaryEntries(activationMilestoneRegistry, [FIRST_TOKEN_MILESTONE], async () => {
        const queryAggregate = jest.fn().mockResolvedValue([{ cohort_size: 2, m0_eligible: 2, m0_activated: 1, m0_median: 3 }]);
        const result = await new OnboardingMetricsService(data({ queryAggregate })).metrics(30);
        const [sql] = queryAggregate.mock.calls[0] as [string];
        expect(sql).toContain(FIRST_TOKEN_MILESTONE.firstReachedAtSql);
        expect(sql).toContain(FIRST_TOKEN_STEP.funnelSql);
        expect(result.milestones[0]).toEqual(expect.objectContaining({ id: 'first_token', activationRate: 0.5, medianHours: 3 }));
        expect(result.steps.map((s) => s.id)).toContain('reference.first-token');
      }),
    ));

  it('adds a field to the strict onboarding namespace', () => {
    const extended = extendUserSettingsNamespace(ONBOARDING_USER_SETTINGS, ROLE_QUESTION_EXTENSION);
    expect(extended.schema.safeParse({ role: 'developer' }).success).toBe(true);
    expect(extended.schema.safeParse({ role: 'astronaut' }).success).toBe(false);
    expect(extended.schema.safeParse({ stray: true }).success).toBe(false);
  });
});
