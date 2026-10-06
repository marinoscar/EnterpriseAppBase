import { BadRequestException, ConflictException } from '@nestjs/common';

import { SystemSettingsStoreAdapter } from './system-settings-store.adapter';
import type { SystemSettingsService } from '../settings/system-settings/system-settings.service';

describe('SystemSettingsStoreAdapter (SYSTEM_SETTINGS_STORE adapter)', () => {
  const document = (version: number, jobs: Record<string, unknown>) => ({
    notifications: { browserEnabled: true, disabledEvents: [] },
    jobs,
    security: { jwtAccessTtlMinutes: 15 },
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    updatedBy: null,
    version,
  });

  function setup() {
    const getSettings = jest.fn().mockResolvedValue(document(4, { workerConcurrency: 2 }));
    const patchSettings = jest.fn().mockResolvedValue(document(5, { workerConcurrency: 3 }));
    const service = { getSettings, patchSettings } as unknown as SystemSettingsService;
    return { store: new SystemSettingsStoreAdapter(service), getSettings, patchSettings };
  }

  it('reads one namespace through getSettings(), with the row version', async () => {
    const { store, getSettings } = setup();

    await expect(store.read('jobs')).resolves.toEqual({ value: { workerConcurrency: 2 }, version: 4 });
    expect(getSettings).toHaveBeenCalledTimes(1);
  });

  it('refuses an unknown namespace and the projection fields that are not namespaces', async () => {
    const { store } = setup();

    await expect(store.read('nope')).rejects.toThrow('Unknown settings namespace "nope".');
    await expect(store.read('version')).rejects.toThrow('Unknown settings namespace "version".');
    await expect(store.read('security')).rejects.toThrow('Unknown settings namespace "security".');
  });

  it('patches through patchSettings(), passing the actor and the If-Match version through', async () => {
    const { store, patchSettings } = setup();

    await expect(
      store.patch('notifications', { browserEnabled: false }, { actorUserId: 'admin-1', ifMatchVersion: 4 }),
    ).resolves.toEqual({ value: { browserEnabled: true, disabledEvents: [] }, version: 5 });
    expect(patchSettings).toHaveBeenCalledWith({ notifications: { browserEnabled: false } }, 'admin-1', 4);
  });

  it('passes an absent If-Match through as undefined (no concurrency check), and keeps 0 as 0', async () => {
    const { store, patchSettings } = setup();

    await store.patch('notifications', { browserEnabled: false }, { actorUserId: 'admin-1' });
    await store.patch('notifications', { browserEnabled: false }, { actorUserId: 'admin-1', ifMatchVersion: 0 });

    expect(patchSettings.mock.calls[0][2]).toBeUndefined();
    expect(patchSettings.mock.calls[1][2]).toBe(0);
  });

  it('surfaces the service version mismatch as the same 409', async () => {
    const { store, patchSettings } = setup();
    patchSettings.mockRejectedValueOnce(new ConflictException('Settings version mismatch. Expected 3, found 4'));

    await expect(
      store.patch('notifications', { browserEnabled: false }, { actorUserId: 'admin-1', ifMatchVersion: 3 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('validates the patch with the PATCH route schema before anything is written', async () => {
    const { store, patchSettings } = setup();

    await expect(
      store.patch('notifications', { browserEnabled: 'yes' }, { actorUserId: 'admin-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(store.patch('nope', { a: 1 }, { actorUserId: 'admin-1' })).rejects.toThrow(
      'Unknown settings namespace "nope".',
    );
    expect(patchSettings).not.toHaveBeenCalled();
  });
});
