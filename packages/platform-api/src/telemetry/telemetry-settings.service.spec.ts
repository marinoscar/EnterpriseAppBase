import { ConflictException } from '@nestjs/common';

import { telemetryGate } from '../otel-core/index';
import type { TelemetrySettings as SystemTelemetryValue } from '@marinoscar/platform-contract/telemetry';
import { TELEMETRY_SETTINGS_DEFAULTS } from './telemetry.settings';
import { TELEMETRY_RETENTION_TYPE } from './handlers/telemetry-retention.handler';
import {
  diffTelemetryFieldNames,
  TELEMETRY_CONFIG_AUDIT_ACTION,
  TELEMETRY_GATE_REFRESH_MS,
  TelemetrySettingsService,
} from './telemetry-settings.service';

/** The app slug the app-info port reports in these tests. */
const APP_SLUG = 'test-app';

const DEFAULTS: SystemTelemetryValue = structuredClone(TELEMETRY_SETTINGS_DEFAULTS);

function build(options: { configured?: boolean; policy?: SystemTelemetryValue; version?: number } = {}) {
  const policy = { current: structuredClone(options.policy ?? DEFAULTS) };

  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const systemSettings = {
    getTelemetryPolicy: jest.fn(async () => structuredClone(policy.current)),
    replaceTelemetryPolicy: jest.fn(async (next: SystemTelemetryValue) => {
      policy.current = structuredClone(next);
    }),
    readPolicyProvenance: jest.fn().mockResolvedValue(
      options.version === undefined
        ? null
        : { version: options.version, updatedAt: new Date('2026-09-27T00:00:00Z'), updatedBy: null },
    ),
  };
  const greptime = {
    isConfigured: jest.fn().mockReturnValue(options.configured ?? true),
    isAdminConfigured: jest.fn().mockReturnValue(options.configured ?? true),
  };
  const jobs = { enqueueHousekeepingJob: jest.fn().mockResolvedValue(undefined) };
  const appInfo = { slug: APP_SLUG };

  const service = new TelemetrySettingsService(
    audit as never,
    systemSettings as never,
    greptime as never,
    jobs as never,
    appInfo as never,
  );

  return { service, audit, systemSettings, greptime, jobs, policy };
}

describe('TelemetrySettingsService', () => {
  beforeEach(() => {
    telemetryGate.setEnabled(false);
    telemetryGate.setInstanceId(APP_SLUG);
  });

  afterEach(() => {
    telemetryGate.setEnabled(false);
    telemetryGate.setInstanceId(APP_SLUG);
    jest.useRealTimers();
  });

  describe('getPolicy', () => {
    it('caches for five seconds, and fresh bypasses the cache', async () => {
      const { service, systemSettings } = build();

      await service.getPolicy();
      await service.getPolicy();
      expect(systemSettings.getTelemetryPolicy).toHaveBeenCalledTimes(1);

      await service.getPolicy({ fresh: true });
      expect(systemSettings.getTelemetryPolicy).toHaveBeenCalledTimes(2);
    });
  });

  describe('refreshGate', () => {
    it('opens the gate when enabled and GreptimeDB is configured', async () => {
      const { service } = build({ policy: { ...DEFAULTS, enabled: true } });

      await expect(service.refreshGate()).resolves.toBe(true);
      expect(telemetryGate.isEnabled()).toBe(true);
    });

    it('keeps the gate closed when enabled but GreptimeDB is not configured', async () => {
      const { service } = build({ configured: false, policy: { ...DEFAULTS, enabled: true } });

      await expect(service.refreshGate()).resolves.toBe(false);
    });

    it('closes the gate when disabled', async () => {
      telemetryGate.setEnabled(true);
      const { service } = build({ policy: { ...DEFAULTS, enabled: false } });

      await expect(service.refreshGate()).resolves.toBe(false);
    });

    it('keeps the last value when the settings read fails, and never throws', async () => {
      telemetryGate.setEnabled(true);
      const { service, systemSettings } = build();
      systemSettings.getTelemetryPolicy.mockRejectedValue(new Error('db down'));

      await expect(service.refreshGate()).resolves.toBe(true);
      expect(telemetryGate.isEnabled()).toBe(true);
    });

    it('pushes APP_SLUG as the instance id while telemetry.instanceId is null', async () => {
      telemetryGate.setInstanceId('stale');
      const { service } = build({ policy: { ...DEFAULTS, instanceId: null } });

      await service.refreshGate();

      expect(telemetryGate.instanceId()).toBe(APP_SLUG);
    });

    it('pushes an administrator-set instance id, whatever the gate state', async () => {
      const { service } = build({ configured: false, policy: { ...DEFAULTS, instanceId: 'prod-eu.1' } });

      await expect(service.refreshGate()).resolves.toBe(false);
      expect(telemetryGate.instanceId()).toBe('prod-eu.1');
    });

    it('keeps the last instance id when the settings read fails', async () => {
      telemetryGate.setInstanceId('prod-eu');
      const { service, systemSettings } = build();
      systemSettings.getTelemetryPolicy.mockRejectedValue(new Error('db down'));

      await service.refreshGate();

      expect(telemetryGate.instanceId()).toBe('prod-eu');
    });

    it('is applied on init and then on an interval, stopped on destroy', async () => {
      jest.useFakeTimers();
      const { service, systemSettings } = build({ policy: { ...DEFAULTS, enabled: true } });

      service.onModuleInit();
      await jest.advanceTimersByTimeAsync(0);
      expect(systemSettings.getTelemetryPolicy).toHaveBeenCalledTimes(1);
      expect(telemetryGate.isEnabled()).toBe(true);

      await jest.advanceTimersByTimeAsync(TELEMETRY_GATE_REFRESH_MS);
      expect(systemSettings.getTelemetryPolicy).toHaveBeenCalledTimes(2);

      service.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(TELEMETRY_GATE_REFRESH_MS * 3);
      expect(systemSettings.getTelemetryPolicy).toHaveBeenCalledTimes(2);
    });
  });

  describe('replace', () => {
    const NEXT: SystemTelemetryValue = {
      ...DEFAULTS,
      enabled: true,
      retentionDays: 7,
      assistant: { ...DEFAULTS.assistant, provider: 'openai' },
    };

    it('refuses an If-Match mismatch with 409 before writing anything', async () => {
      const { service, systemSettings, audit, jobs } = build({ version: 5 });

      await expect(service.replace(NEXT, 'user-1', 4)).rejects.toBeInstanceOf(ConflictException);

      expect(systemSettings.replaceTelemetryPolicy).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(jobs.enqueueHousekeepingJob).not.toHaveBeenCalled();
    });

    it('writes the namespace, passing the expected version on to the settings write', async () => {
      const { service, systemSettings } = build({ version: 5 });

      await service.replace(NEXT, 'user-1', 5);

      expect(systemSettings.replaceTelemetryPolicy).toHaveBeenCalledWith(NEXT, 'user-1', 5);
    });

    it('audits telemetry:config_update with changed field names only', async () => {
      const { service, audit } = build({ version: 1 });

      await service.replace(NEXT, 'user-1');

      expect(audit.record).toHaveBeenCalledWith({
        actorUserId: 'user-1',
        action: TELEMETRY_CONFIG_AUDIT_ACTION,
        targetType: 'telemetry_config',
        targetId: 'telemetry',
        meta: { changedFields: ['enabled', 'retentionDays', 'assistant.provider'] },
      });
    });

    it('refreshes the gate from the new value on this instance', async () => {
      const { service } = build({ version: 1 });

      await service.replace(NEXT, 'user-1');

      expect(telemetryGate.isEnabled()).toBe(true);
    });

    it('applies a new instance id on this instance, and audits the field name', async () => {
      const { service, audit } = build({ version: 1 });

      await service.replace({ ...DEFAULTS, instanceId: 'staging' }, 'user-1');

      expect(telemetryGate.instanceId()).toBe('staging');
      expect(audit.record.mock.calls[0][0].meta).toEqual({ changedFields: ['instanceId'] });
    });

    it('null returns the instance id to the APP_SLUG default', async () => {
      const { service, systemSettings } = build({ version: 1, policy: { ...DEFAULTS, instanceId: 'staging' } });

      const view = await service.replace({ ...DEFAULTS, instanceId: null }, 'user-1');

      expect(systemSettings.replaceTelemetryPolicy.mock.calls[0][0].instanceId).toBeNull();
      expect(telemetryGate.instanceId()).toBe(APP_SLUG);
      expect(view).toMatchObject({ instanceId: null, instanceIdDefault: APP_SLUG, instanceIdEffective: APP_SLUG });
    });

    it('an absent instanceId keeps the stored value (a client that predates the field cannot reset it)', async () => {
      const { service, systemSettings, audit } = build({ version: 1, policy: { ...DEFAULTS, instanceId: 'staging' } });
      const { instanceId: _omitted, ...withoutInstanceId } = DEFAULTS;

      const view = await service.replace(withoutInstanceId, 'user-1');

      expect(systemSettings.replaceTelemetryPolicy.mock.calls[0][0].instanceId).toBe('staging');
      expect(audit.record.mock.calls[0][0].meta).toEqual({ changedFields: [] });
      expect(view.instanceIdEffective).toBe('staging');
    });

    it('enqueues the retention job as housekeeping, logged on its own logger', async () => {
      const { service, jobs } = build({ version: 1 });

      await service.replace(NEXT, 'user-1');

      expect(jobs.enqueueHousekeepingJob).toHaveBeenCalledWith({
        type: TELEMETRY_RETENTION_TYPE,
        what: 'telemetry retention',
        logger: expect.objectContaining({ log: expect.any(Function) }),
      });
    });

    // "A failed retention enqueue never fails the save" is the port's contract
    // (`enqueueHousekeepingJob` never throws), proved on the app's adapter:
    // apps/api/src/platform/telemetry/telemetry-jobs.adapter.spec.ts.

    it('returns the admin view of the new value', async () => {
      const { service } = build({ version: 1 });

      const view = await service.replace(NEXT, 'user-1');

      expect(view).toMatchObject({
        ...NEXT,
        available: true,
        retentionApplicable: true,
        version: 1,
        updatedAt: '2026-09-27T00:00:00.000Z',
        updatedBy: null,
      });
    });
  });

  describe('describePublic', () => {
    it('reports availability from GreptimeDB config and the two switches', async () => {
      const { service } = build({
        configured: false,
        policy: { ...DEFAULTS, enabled: true, assistant: { ...DEFAULTS.assistant, enabled: true } },
      });

      await expect(service.describePublic()).resolves.toEqual({
        available: false,
        enabled: true,
        assistantEnabled: true,
      });
    });
  });

  describe('describeForAdmin', () => {
    it('reports version 0 when no settings row exists', async () => {
      const { service } = build();

      await expect(service.describeForAdmin()).resolves.toMatchObject({
        ...DEFAULTS,
        version: 0,
        updatedAt: null,
        updatedBy: null,
      });
    });

    it('reports the APP_SLUG default and, with no override, it as the effective instance id', async () => {
      const { service } = build();

      await expect(service.describeForAdmin()).resolves.toMatchObject({
        instanceId: null,
        instanceIdDefault: APP_SLUG,
        instanceIdEffective: APP_SLUG,
      });
    });

    it('reports an override as the effective instance id, keeping the default beside it', async () => {
      const { service } = build({ policy: { ...DEFAULTS, instanceId: 'prod-eu' } });

      await expect(service.describeForAdmin()).resolves.toMatchObject({
        instanceId: 'prod-eu',
        instanceIdDefault: APP_SLUG,
        instanceIdEffective: 'prod-eu',
      });
    });
  });

  it('diffTelemetryFieldNames names nothing for identical policies', () => {
    expect(diffTelemetryFieldNames(DEFAULTS, structuredClone(DEFAULTS))).toEqual([]);
  });
});
