// The org layer of the notification policy (issue #738): an organization may
// only tighten the deployment's browser policy; a mandatory event's inbox row
// is still written; the policy service resolves per organization and falls
// back to the deployment's policy, never to "everything on".
import { applyOrgLayer } from '../../src/settings/org-settings/org-layer';
import type { SystemSettingsNamespace } from '../../src/settings/index';
import { NotificationPolicyService } from '../../src/notifications/notification-policy.service';
import { policyChannels, isBrowserToastAllowed } from '../../src/notifications/notification-policy';
import { resolveChannels } from '../../src/notifications/notification-preferences';
import {
  NOTIFICATIONS_SYSTEM_SETTINGS,
  tightenNotificationsPolicy,
} from '../../src/notifications/notifications.system-settings';
import { registerTestNotifications, ROLE_CHANGED_EVENT, WELCOME_EVENT } from './support';

registerTestNotifications();

const ns = NOTIFICATIONS_SYSTEM_SETTINGS as unknown as SystemSettingsNamespace;
const SYSTEM = { browserEnabled: true, disabledEvents: ['jobs.job_failed'] };

describe('the notifications org layer (#738)', () => {
  it('declares an org layer gated by the org-settings permissions', () => {
    expect(NOTIFICATIONS_SYSTEM_SETTINGS.org.readPermission).toBe('org_settings:read');
    expect(NOTIFICATIONS_SYSTEM_SETTINGS.org.writePermission).toBe('org_settings:write');
    expect(NOTIFICATIONS_SYSTEM_SETTINGS.org.schema.safeParse({ browserEnabled: false }).success).toBe(true);
  });

  it('tightens only: browserEnabled is system AND org, disabledEvents is the union', () => {
    expect(tightenNotificationsPolicy(SYSTEM, { browserEnabled: false, disabledEvents: ['user.welcome'] })).toEqual({
      browserEnabled: false,
      disabledEvents: ['jobs.job_failed', 'user.welcome'],
    });
    // An org cannot turn browser delivery back on, nor re-enable an event.
    expect(tightenNotificationsPolicy({ browserEnabled: false, disabledEvents: ['a.b'] }, { browserEnabled: true, disabledEvents: [] })).toEqual({
      browserEnabled: false,
      disabledEvents: ['a.b'],
    });
  });

  it('applies through the settings slice and survives two full lists', () => {
    const many = (prefix: string) => Array.from({ length: 100 }, (_, i) => `${prefix}.e${i}`);
    const { value, applied } = applyOrgLayer(ns, { browserEnabled: true, disabledEvents: many('sys') }, { disabledEvents: many('org') });
    expect(applied).toBe(true);
    expect((value as { disabledEvents: string[] }).disabledEvents).toHaveLength(200);
  });

  it('suppresses a toast for that org only, and keeps a mandatory event\'s inbox row', () => {
    const orgPolicy = tightenNotificationsPolicy({ browserEnabled: true, disabledEvents: [] }, { browserEnabled: false });
    expect(resolveChannels(WELCOME_EVENT, {}, orgPolicy)).toEqual(['email']);
    expect(resolveChannels(WELCOME_EVENT, {}, { browserEnabled: true, disabledEvents: [] })).toEqual(['email', 'browser']);
    expect(policyChannels(ROLE_CHANGED_EVENT, orgPolicy)).toEqual(['email', 'browser']);
    expect(isBrowserToastAllowed(ROLE_CHANGED_EVENT.key, orgPolicy)).toBe(false);
  });

  describe('NotificationPolicyService.getPolicy(orgId)', () => {
    const systemSettings = { getNotificationsPolicy: jest.fn() };
    const resolver = { resolveSystem: jest.fn() };
    const service = new NotificationPolicyService(systemSettings as never, resolver as never);

    beforeEach(() => {
      jest.resetAllMocks();
      systemSettings.getNotificationsPolicy.mockResolvedValue(SYSTEM);
    });

    it('reads the deployment policy without an organization', async () => {
      await expect(service.getPolicy(null)).resolves.toEqual(SYSTEM);
      expect(resolver.resolveSystem).not.toHaveBeenCalled();
    });

    it('resolves the organization layer through the settings resolver', async () => {
      resolver.resolveSystem.mockResolvedValue({ browserEnabled: false, disabledEvents: [] });
      await expect(service.getPolicy('org-1')).resolves.toEqual({ browserEnabled: false, disabledEvents: [] });
      expect(resolver.resolveSystem).toHaveBeenCalledWith('notifications', { orgId: 'org-1' });
    });

    it('falls back to the deployment policy, not the permissive default, when the org layer fails', async () => {
      resolver.resolveSystem.mockRejectedValue(new Error('db down'));
      await expect(service.getPolicy('org-1')).resolves.toEqual(SYSTEM);
    });
  });
});
