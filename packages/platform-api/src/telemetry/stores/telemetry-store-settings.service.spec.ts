import { BadRequestException, ConflictException } from '@nestjs/common';
import { z } from 'zod';

import { credentialPurposeRegistry } from '../../credentials/index';
import { registerTelemetryStore } from './telemetry-store';
import { TELEMETRY_STORE_SETTINGS_KEY } from './telemetry-store.resolver';
import { TELEMETRY_STORE_UPDATE_AUDIT_ACTION, TelemetryStoreSettingsService } from './telemetry-store-settings.service';
import { TELEMETRY_RETENTION_TYPE } from '../handlers/telemetry-retention.handler';

// =============================================================================
// TelemetryStoreSettingsService: GET / PUT /api/admin/telemetry/store (PP-14.11)
// =============================================================================

registerTelemetryStore({
  id: 'settings-fake',
  label: 'Settings fake',
  description: 'A store with settings and two secrets.',
  settingsSchema: z.object({ region: z.string().min(1).default('eu'), pageSize: z.number().int().min(1).max(100).default(10) }),
  defaults: { region: 'eu', pageSize: 10 },
  secrets: [
    { name: 'apiKey', label: 'API key', required: true },
    { name: 'signingToken', label: 'Signing token', required: false },
  ],
  build: () => ({ store: {} as never, dialect: {} as never }),
});

const PURPOSE = 'telemetry_settings-fake';

function setup(options: { row?: { value: unknown; version: number }; secrets?: string[]; active?: string } = {}) {
  const state = { row: options.row ?? null, written: [] as unknown[] };
  const stored = new Set(options.secrets ?? []);
  const settingsStore = {
    readRow: jest.fn(async () => (state.row ? { ...state.row, updatedAt: new Date('2026-09-27T00:00:00.000Z'), updatedBy: null } : null)),
    writeRow: jest.fn(async (_key: string, value: unknown) => {
      state.written.push(value);
      state.row = { value, version: (state.row?.version ?? 0) + 1 };
    }),
  };
  const credentials = {
    describe: jest.fn(async (_purpose: string, name: string) => (stored.has(name) ? { name } : null)),
    setSecret: jest.fn(async (_purpose: string, name: string) => void stored.add(name)),
    deleteSecret: jest.fn(async (_purpose: string, name: string) => void stored.delete(name)),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const store = { id: options.active ?? 'settings-fake', isConfigured: jest.fn().mockReturnValue(true) };
  const policy = { refreshGate: jest.fn().mockResolvedValue(true) };
  const jobs = { enqueueHousekeepingJob: jest.fn().mockResolvedValue(undefined) };
  const resolver = { refresh: jest.fn().mockResolvedValue(undefined), lastError: jest.fn().mockReturnValue(null) };

  const service = new TelemetryStoreSettingsService(
    { store: options.active ?? 'settings-fake' },
    settingsStore as never,
    credentials as never,
    audit as never,
    store as never,
    policy as never,
    jobs as never,
    resolver as never,
  );

  return { service, state, settingsStore, credentials, audit, store, policy, jobs, resolver };
}

describe('describeForAdmin', () => {
  it('describes the active store: registered stores, a descriptor with write-only secrets (presence only), the settings with defaults', async () => {
    const { service } = setup({ row: { value: { 'settings-fake': { region: 'us' } }, version: 3 }, secrets: ['apiKey'] });

    const response = await service.describeForAdmin();

    expect(response.active).toEqual({ id: 'settings-fake', label: 'Settings fake', description: 'A store with settings and two secrets.' });
    expect(response.stores.map((s) => s.id)).toEqual(expect.arrayContaining(['greptime', 'settings-fake']));
    expect(response.settings).toEqual({ region: 'us', pageSize: 10 });
    expect(response.descriptor?.fields.map((f) => [f.name, f.kind, f.kind === 'secret' ? f.hasValue : undefined])).toEqual([
      ['region', 'string', undefined],
      ['pageSize', 'number', undefined],
      ['apiKey', 'secret', true],
      ['signingToken', 'secret', false],
    ]);
    expect(response).toMatchObject({ version: 3, ready: true, error: null, updatedAt: '2026-09-27T00:00:00.000Z' });
    expect(JSON.stringify(response)).not.toMatch(/"value"/);
  });

  it('serves defaults and version 0 when nothing is stored, and drops settings of a store that is no longer registered', async () => {
    const { service } = setup({ row: { value: { 'gone-store': { x: 1 }, 'settings-fake': { pageSize: 'many' } }, version: 2 } });

    const response = await service.describeForAdmin();

    // An entry that no longer parses reads as the defaults; an unknown store is ignored.
    expect(response.settings).toEqual({ region: 'eu', pageSize: 10 });
    expect((await setup().service.describeForAdmin()).version).toBe(0);
  });

  it('has no descriptor for the built-in store: its form is the connection form', async () => {
    const { service } = setup({ active: 'greptime' });

    expect(await service.describeForAdmin()).toMatchObject({ active: { id: 'greptime' }, descriptor: null, settings: {}, ready: true });
  });
});

describe('update', () => {
  it('merges the patch over the stored settings, validated with the store\'s schema, and writes the row keyed by store id', async () => {
    const { service, state, settingsStore } = setup({ row: { value: { 'settings-fake': { region: 'us', pageSize: 5 }, other: { keep: true } }, version: 1 } });

    const response = await service.update({ settings: { pageSize: 50 } }, 'admin-1');

    expect(settingsStore.writeRow).toHaveBeenCalledWith(TELEMETRY_STORE_SETTINGS_KEY, expect.any(Object), 'admin-1');
    expect(state.written[0]).toEqual({ 'settings-fake': { region: 'us', pageSize: 50 }, other: { keep: true } });
    expect(response.settings).toEqual({ region: 'us', pageSize: 50 });
  });

  it('rejects settings that do not parse (400 naming the field), and writes nothing', async () => {
    const { service, settingsStore, credentials } = setup();

    await expect(service.update({ settings: { pageSize: 500 }, secrets: { apiKey: 'k' } }, 'admin-1')).rejects.toThrow(
      /Invalid settings for the telemetry store "settings-fake": pageSize/,
    );
    expect(settingsStore.writeRow).not.toHaveBeenCalled();
    expect(credentials.setSecret).not.toHaveBeenCalled();
  });

  it('stores a secret under telemetry_<id> with its declared label, clears a blank one, keeps an absent one', async () => {
    const { service, credentials } = setup({ secrets: ['signingToken', 'apiKey'] });

    await service.update({ secrets: { apiKey: 'sk-live-1', signingToken: '' } }, 'admin-1');

    expect(credentials.setSecret).toHaveBeenCalledWith(PURPOSE, 'apiKey', 'sk-live-1', { label: 'API key', updatedByUserId: 'admin-1' });
    expect(credentials.deleteSecret).toHaveBeenCalledWith(PURPOSE, 'signingToken');
    expect(credentials.setSecret).toHaveBeenCalledTimes(1);
  });

  it('refuses a secret the store does not declare', async () => {
    const { service } = setup();

    await expect(service.update({ secrets: { nope: 'x' } }, 'admin-1')).rejects.toThrow(/declares no secret named "nope" \(declared: apiKey, signingToken\)/);
  });

  it('is 409 for a stale If-Match, and accepts the current version', async () => {
    const { service } = setup({ row: { value: {}, version: 4 } });

    await expect(service.update({ settings: { region: 'us' } }, 'a', 3)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.update({ settings: { region: 'us' } }, 'a', 4)).resolves.toBeDefined();
  });

  it('refuses the built-in store: its connection has its own route', async () => {
    const { service } = setup({ active: 'greptime' });

    await expect(service.update({ settings: {} }, 'a')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('audits setting and secret NAMES, never values, then refreshes the running store, the gate and the retention job', async () => {
    const { service, audit, resolver, policy, jobs } = setup();

    await service.update({ settings: { region: 'us' }, secrets: { apiKey: 'sk-live-secret' } }, 'admin-1');

    expect(audit.record).toHaveBeenCalledWith({
      actorUserId: 'admin-1',
      action: TELEMETRY_STORE_UPDATE_AUDIT_ACTION,
      targetType: 'system_settings',
      targetId: TELEMETRY_STORE_SETTINGS_KEY,
      meta: { store: 'settings-fake', changedSettings: ['region'], changedSecrets: { apiKey: 'set' } },
    });
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('sk-live-secret');
    expect(resolver.refresh).toHaveBeenCalled();
    expect(policy.refreshGate).toHaveBeenCalled();
    expect(jobs.enqueueHousekeepingJob).toHaveBeenCalledWith(expect.objectContaining({ type: TELEMETRY_RETENTION_TYPE }));
  });

  it('registered the store\'s credential purpose for its secrets', () => {
    expect(credentialPurposeRegistry.has(PURPOSE)).toBe(true);
  });
});
