// OnboardingService (issue #745): the admin block by permission, the Doctor
// bridge (one run per category, refresh forwarded), the stored state read
// once and never written, the bootstrap check, the module's options.
import type { DoctorCheckReport, DoctorReport } from '@marinoscar/platform-contract/doctor';
import type { ConfigService } from '@nestjs/config';
import type { ModuleRef } from '@nestjs/core';

import { withTemporaryEntries } from '../../src/core/index';
import type { DoctorCheckRegistry, DoctorService } from '../../src/doctor/index';
import {
  OnboardingModule,
  OnboardingService,
  PLATFORM_ONBOARDING_FACTS,
  PLATFORM_ONBOARDING_STEPS,
  onboardingFactRegistry,
  onboardingStepRegistry,
  resolveOnboardingModuleOptions,
} from '../../src/onboarding/index';
import { USER_ID, boolStep, fakeData } from './support';

const CATEGORY: Record<string, string> = {
  'storage.config': 'storage',
  'storage.bucket': 'storage',
  'email.config': 'email',
  'ai.enabled': 'ai',
  'ai.providers': 'ai',
  'push.vapid': 'push',
  'backup.schedule': 'backup',
};

function check(id: string, status: DoctorCheckReport['status']): DoctorCheckReport {
  return { id, category: CATEGORY[id]!, label: id, settingsPath: null, status, detail: `${id} detail`, remedy: `Fix ${id}.`, error: null, data: null, durationMs: 0 };
}

function doctorStub(statuses: Record<string, DoctorCheckReport['status']>) {
  const runs: Array<{ category?: string; refresh?: boolean }> = [];
  const doctor = {
    run: async (options: { category?: string; refresh?: boolean }): Promise<DoctorReport> => {
      runs.push(options);
      const checks = Object.keys(CATEGORY)
        .filter((id) => CATEGORY[id] === options.category)
        .map((id) => check(id, statuses[id] ?? 'fail'));
      return { verdict: 'fail', generatedAt: new Date(0).toISOString(), durationMs: 0, checks };
    },
  } as unknown as DoctorService;
  const checks = { get: (id: string) => (CATEGORY[id] ? { id, category: CATEGORY[id] } : undefined) } as unknown as DoctorCheckRegistry;
  return { doctor, checks, runs };
}

const ADMIN = ['system_settings:read', 'storage_config:read', 'allowlist:read', 'ai_config:read', 'push:read', 'db_backup:read', 'user_settings:read'];
const config = { get: (key: string) => (key === 'INITIAL_ADMIN_EMAIL' ? ' Admin@Example.test ' : undefined) } as unknown as ConfigService;
const moduleRef = { get: () => undefined } as unknown as ModuleRef;

function withPlatform<R>(fn: () => Promise<R>): Promise<R> {
  return withTemporaryEntries(onboardingFactRegistry, PLATFORM_ONBOARDING_FACTS, () =>
    withTemporaryEntries(onboardingStepRegistry, PLATFORM_ONBOARDING_STEPS, fn),
  );
}

describe('OnboardingService', () => {
  it('gives an administrator the admin block: required todo with Doctor remedies, recommended present', () =>
    withPlatform(async () => {
      const { doctor, checks, runs } = doctorStub({});
      const data = fakeData();
      const service = new OnboardingService(data, moduleRef, { isEnabled: async () => true }, doctor, checks, config);
      const result = await service.get({ id: USER_ID, permissions: ADMIN }, { refresh: true });

      expect(result.admin?.steps.map((s) => [s.id, s.tier, s.status])).toEqual([
        ['admin.storage', 'required', 'todo'],
        ['admin.email', 'required', 'todo'],
        ['admin.access', 'required', 'todo'],
        ['admin.ai', 'recommended', 'todo'],
        ['admin.push', 'recommended', 'todo'],
        ['admin.backup', 'recommended', 'todo'],
      ]);
      expect(result.admin?.steps[0]?.detail).toBe('Fix storage.config.');
      expect(result.admin?.requiredDone).toBe(false);
      // One Doctor run per category, refresh forwarded.
      expect(runs.map((r) => r.category).sort()).toEqual(['ai', 'backup', 'email', 'push', 'storage']);
      expect(runs.every((r) => r.refresh === true)).toBe(true);
      // The stored state and the userSettings fact share one read; the bootstrap admin is excluded.
      expect(data.calls.filter((c) => c === 'readUserSettingsValue')).toHaveLength(1);
      expect(result.user.steps.map((s) => s.id)).toEqual(['user.profile', 'user.notifications']);
    }));

  it('turns admin.storage done when both storage checks pass', () =>
    withPlatform(async () => {
      const { doctor, checks } = doctorStub({ 'storage.config': 'pass', 'storage.bucket': 'pass' });
      const service = new OnboardingService(fakeData(), moduleRef, undefined, doctor, checks, config);
      const result = await service.get({ id: USER_ID, permissions: ADMIN });
      expect(result.admin?.steps.find((s) => s.id === 'admin.storage')).toEqual(expect.objectContaining({ status: 'done', detail: null }));
    }));

  it('excludes INITIAL_ADMIN_EMAIL, trimmed, from the allowlist count', () =>
    withPlatform(async () => {
      const seen: Array<string | null> = [];
      const data = fakeData({ countAllowlistEntriesExcept: async (email) => (seen.push(email), 1) });
      const service = new OnboardingService(data, moduleRef, undefined, undefined, undefined, config);
      const result = await service.get({ id: USER_ID, permissions: ADMIN });
      expect(seen).toEqual(['Admin@Example.test']);
      expect(result.admin?.steps.map((s) => [s.id, s.status])).toEqual([['admin.access', 'done']]);
    }));

  it('gives a viewer no admin block and derives the user steps from the stored settings', () =>
    withPlatform(async () => {
      const data = fakeData({
        readUserSettingsValue: async () => ({ profile: { displayName: 'Ada', imageSource: 'none' }, onboarding: { welcomeSeenAt: '2026-01-01T00:00:00.000Z', skipped: ['user.notifications'] } }),
      });
      const service = new OnboardingService(data, moduleRef);
      const result = await service.get({ id: USER_ID, permissions: ['user_settings:read'] });
      expect(result.admin).toBeNull();
      expect(result.settings).toEqual({
        welcomeSeenAt: '2026-01-01T00:00:00.000Z',
        checklistDismissedAt: null,
        adminDismissedAt: null,
        skipped: ['user.notifications'],
      });
      expect(result.user.steps.map((s) => [s.id, s.status, s.skipped])).toEqual([
        ['user.profile', 'done', false],
        ['user.notifications', 'todo', true],
      ]);
      expect(result.user.allResolved).toBe(true);
    }));

  it('fails the bootstrap on a step that reads an unregistered fact', () =>
    withTemporaryEntries(onboardingStepRegistry, [boolStep('user.x', 'nobody')], async () => {
      expect(() => new OnboardingService(fakeData(), moduleRef).onApplicationBootstrap()).toThrow(/unknown fact "nobody"/);
    }));
});

describe('OnboardingModule.forRoot', () => {
  it('mounts both controllers and provides the services', () => {
    const module = OnboardingModule.forRoot();
    expect(module.controllers).toHaveLength(2);
    expect(module.exports).toEqual(expect.arrayContaining([OnboardingService]));
  });

  it('refuses a blank admin permission', () => {
    expect(() => resolveOnboardingModuleOptions({ adminPermission: ' ' })).toThrow(/adminPermission/);
    expect(resolveOnboardingModuleOptions().adminPermission).toBe('system_settings:read');
  });
});
