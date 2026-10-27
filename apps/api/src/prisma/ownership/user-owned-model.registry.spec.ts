import { ownerFieldOf, userOwnedModelRegistry } from '@marinoscar/platform-api/core';
import { PLATFORM_USER_OWNED_MODELS } from '@marinoscar/platform-api/manifest';
import './index';
import { APP_USER_OWNED_MODELS } from '../../app-registrations/user-owned-models';

// =============================================================================
// The app's user-owned model inventory (#688; registry moved to core by #699)
// =============================================================================
//
// The registry's own rules (validation, ids, duplicates, owner relations) are
// pinned in packages/platform-api/test/core/data-access/, and the platform
// inventory against the platform's fragments in
// packages/platform-api/test/manifest/ (#866). The schema
// cross-check is the `userOwnedData` conformance suite, run by
// test/prisma/user-owned-models.spec.ts. This file pins what the app
// registers.
// =============================================================================

describe('the app fills userOwnedModelRegistry', () => {
  // The literal registration order before the inventory was packaged (#866):
  // the user-data export lists its datasets in this order.
  const BASELINE_ORDER = [
    'UserIdentity', 'UserRole', 'UserSettings', 'RefreshToken', 'PersonalAccessToken', 'DeviceCode', 'Membership',
    'Notification', 'PushSubscription', 'NodeCredential', 'UserAiKey', 'WorkerNode', 'StorageObject',
    'NotificationDelivery', 'AiRun', 'AiUsageEvent', 'SystemSettings', 'AuditEvent', 'AllowedEmail',
    'NotificationBroadcast', 'DatabaseBackupRun', 'Organization', 'Invite', 'AiModel',
    // sharing (#728, #729)
    'GroupMember', 'GroupInvite', 'Group', 'Grant',
    // settings (#733)
    'OrgSettings',
    // credentials (#735)
    'UserCredential', 'Credential', 'OrgCredential',
    // android-app (#746)
    'AndroidAppRelease',
  ];

  it('registers the packaged platform inventory in the baseline order, then the (empty) app list', () => {
    expect(APP_USER_OWNED_MODELS).toEqual([]);
    expect(userOwnedModelRegistry.ids()).toEqual(BASELINE_ORDER);
    expect(userOwnedModelRegistry.list()).toEqual([...PLATFORM_USER_OWNED_MODELS, ...APP_USER_OWNED_MODELS]);
  });

  it('holds 33 models and 40 User foreign keys (the sharing slice adds 4 and 8: groups #728, grants #729; settings 1 and 1, #733; org credentials 1 and 1, #735; android-app 1 and 1, #746)', () => {
    const fields = userOwnedModelRegistry
      .list()
      .flatMap((def) => [...(def.ownerField ? [def.ownerField] : []), ...(def.actorFields ?? [])]);
    expect(userOwnedModelRegistry.size).toBe(33);
    expect(fields).toHaveLength(40);
  });

  it('gives every entry a non-empty rationale', () => {
    for (const def of userOwnedModelRegistry.list()) {
      expect(def.rationale.trim().length).toBeGreaterThan(10);
    }
  });

  it('looks up the inventory’s owner fields', () => {
    expect(ownerFieldOf('UserCredential')).toBe('userId');
    expect(ownerFieldOf('WorkerNode')).toBe('createdById');
    expect(ownerFieldOf('AuditEvent')).toBeUndefined();
    expect(ownerFieldOf('Role')).toBeUndefined();
  });
});
