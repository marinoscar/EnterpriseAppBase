// =============================================================================
// Onboarding on a real database (issue #745)
// =============================================================================
//
//   1. READ-ONLY: `GET /api/onboarding`'s derivation (the service over the
//      app's data adapter) creates no `user_settings` row for a user who has
//      none, and reads the namespace of one who has.
//   2. METRICS: the one aggregate statement on seeded users: the cohort, the
//      eligibility window, activation, the median excluding users who never
//      reached the milestone, and the funnel. Users are seeded in 2001 and
//      the window ends then, so rows of concurrent suites (created now) never
//      fall in the cohort.
// =============================================================================

import { randomUUID } from 'node:crypto';

import type { ModuleRef } from '@nestjs/core';
import { withTemporaryEntries } from '@marinoscar/platform-api/core';
import {
  OnboardingMetricsService,
  OnboardingService,
  activationMilestoneRegistry,
} from '@marinoscar/platform-api/onboarding';

import '../../src/onboarding/onboarding.manifest';
import '../../src/settings/registry';
import { OnboardingDataAdapter } from '../../src/platform/onboarding/onboarding-data.adapter';
import { createDbServices, resolveDbSuite } from '../jobs/db-test-support';

const { describeWithDb } = resolveDbSuite('onboarding.db.spec');

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2001-06-30T12:00:00.000Z');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

describeWithDb('onboarding (real Postgres)', () => {
  let services: ReturnType<typeof createDbServices>;
  let adapter: OnboardingDataAdapter;
  const run = randomUUID().slice(0, 8);
  const userIds: string[] = [];

  async function makeUser(label: string, createdAt?: Date): Promise<string> {
    const user = await services.prisma.user.create({
      data: { email: `onb-${label}-${run}@example.com`, ...(createdAt ? { createdAt } : {}) },
      select: { id: true },
    });
    userIds.push(user.id);
    return user.id;
  }

  async function addToken(userId: string, createdAt: Date): Promise<void> {
    await services.prisma.personalAccessToken.create({
      data: { userId, name: 'cli', tokenHash: randomUUID(), tokenPrefix: randomUUID().slice(0, 8), durationValue: 30, durationUnit: 'days', expiresAt: new Date('2002-01-01T00:00:00.000Z'), createdAt },
    });
  }

  beforeAll(() => {
    services = createDbServices();
    adapter = new OnboardingDataAdapter(services.prisma);
  });

  afterAll(async () => {
    if (userIds.length > 0) await services.prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await services.close();
  });

  it('creates no user_settings row for a user without one', async () => {
    const userId = await makeUser('fresh');
    const service = new OnboardingService(adapter, {} as ModuleRef);

    const result = await service.get({ id: userId, permissions: ['user_settings:read'] });

    expect(result.settings).toEqual({ welcomeSeenAt: null, checklistDismissedAt: null, adminDismissedAt: null, skipped: [] });
    expect(result.user.steps.map((s) => [s.id, s.status])).toEqual([
      ['user.profile', 'todo'],
      ['user.notifications', 'todo'],
    ]);
    expect(await services.prisma.userSettings.count({ where: { userId } })).toBe(0);
  });

  it('reads the stored namespace and derives from it without writing', async () => {
    const userId = await makeUser('stored');
    await services.prisma.userSettings.create({
      data: {
        userId,
        value: {
          theme: 'system',
          profile: { displayName: 'Ada', imageSource: 'none' },
          notifications: { events: {} },
          onboarding: { welcomeSeenAt: '2001-06-01T00:00:00.000Z' },
        },
      },
    });
    const before = await services.prisma.userSettings.findUniqueOrThrow({ where: { userId } });

    const result = await new OnboardingService(adapter, {} as ModuleRef).get({ id: userId, permissions: ['user_settings:read'] });

    expect(result.settings.welcomeSeenAt).toBe('2001-06-01T00:00:00.000Z');
    expect(result.user.steps.map((s) => s.status)).toEqual(['done', 'done']);
    const after = await services.prisma.userSettings.findUniqueOrThrow({ where: { userId } });
    expect(after.version).toBe(before.version);
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it('aggregates the cohort, eligibility, activation, the median and the funnel', async () => {
    // In the 30-day cohort: three eligible (created >= 7 days ago), one not.
    const a = await makeUser('m-a', ago(20)); // token after 2 days: activated
    const b = await makeUser('m-b', ago(15)); // token after 10 days: not activated
    await makeUser('m-c', ago(10)); // no token
    const d = await makeUser('m-d', ago(2)); // not eligible yet; token after 1 day
    await makeUser('m-old', ago(60)); // outside the cohort
    await addToken(a, new Date(ago(20).getTime() + 2 * DAY));
    await addToken(b, new Date(ago(15).getTime() + 10 * DAY));
    await addToken(d, new Date(ago(2).getTime() + 1 * DAY));
    await services.prisma.userSettings.create({ data: { userId: a, value: { profile: { displayName: 'A', imageSource: 'none' } } } });

    const milestone = {
      id: 'first_token',
      label: 'First token',
      windowDays: 7,
      firstReachedAtSql: '(SELECT MIN(t.created_at) FROM personal_access_tokens t WHERE t.user_id = c.id)',
    };
    await withTemporaryEntries(activationMilestoneRegistry, [milestone], async () => {
      const result = await new OnboardingMetricsService(adapter).metrics(30, NOW);

      expect(result.cohortSize).toBe(4);
      expect(result.milestones).toEqual([
        {
          id: 'first_token',
          label: 'First token',
          windowDays: 7,
          eligible: 3,
          activated: 1,
          activationRate: 1 / 3,
          // Hours to the token for a (48), b (240), d (24); c never counts as 0.
          medianHours: 48,
        },
      ]);
      expect(result.steps).toEqual([
        { id: 'user.profile', title: 'Complete your profile', completed: 1, rate: 0.25 },
        { id: 'user.notifications', title: 'Choose your notifications', completed: 0, rate: 0 },
      ]);
    });

    const withoutMilestone = await new OnboardingMetricsService(adapter).metrics(30, NOW);
    expect(withoutMilestone.milestones).toEqual([]);
    expect(withoutMilestone.cohortSize).toBe(4);
  });
});
