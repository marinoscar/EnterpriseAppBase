import { groupInvitationBrowserTemplate, sharedWithYouBrowserTemplate } from '@marinoscar/platform-api/sharing';
import { RegistryError, withTemporaryEntries } from '@marinoscar/platform-api/core';
import { NOTIFICATION_MAX_EVENT_KEY_LENGTH } from '../../common/schemas/user-settings-namespaces.schema';
import {
  PLATFORM_EMAIL_TEMPLATES,
  findEmailTemplate,
  isEmailTemplateName,
  type EmailTemplate,
  type RenderedEmail,
} from '@marinoscar/platform-api/email';
import {
  backupFailedBrowserTemplate,
  broadcastBrowserTemplate,
  nodeOfflineBrowserTemplate,
  restoreCompletedBrowserTemplate,
  roleChangedBrowserTemplate,
} from '../channels/browser-templates';
import { EVENT_BROWSER_TEMPLATES } from '../channels/browser-notification.channel';
import { EVENT_EMAIL_TEMPLATES } from '../channels/email-notification.channel';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  channelsFor,
  findEvent,
  isMandatory,
  listNotificationEvents,
  supportsChannel,
  type NotificationChannel,
  type NotificationEventDef,
} from '../notification-events';
import {
  NOTIFICATION_EVENT_KEY_MAX_LENGTH,
  emailTemplateRegistry,
  eventBrowserTemplateRegistry,
  eventEmailTemplateRegistry,
  notificationChannelRegistry,
  notificationEventRegistry,
  registerNotification,
  type NotificationRegistration,
} from '.';

// =============================================================================
// Notification registries (issue #678, PP-1.6)
// =============================================================================
//
// What the manifest registers (and in which order), what the registries
// refuse, that the old exports are faithful views, and that
// `registerNotification` is atomic. The "no behaviour change" side is also
// pinned over HTTP by test/notifications/notification-registry.integration.spec.ts.
// =============================================================================

/** The platform events, in the order `main` declared them before #678. */
const PLATFORM_EVENT_KEYS = [
  'user.welcome',
  'allowlist.invitation',
  'security.role_changed',
  'admin.broadcast',
  'admin.broadcast_critical',
  'jobs.job_failed',
  'nodes.node_offline',
  'db_backup.backup_failed',
  'db_backup.restore_completed',
  // #726 (PP-6.7), appended after the events `main` declared before #678.
  'org.invitation',
  // #728 (PP-7.1), the sharing slice's group invitation.
  'groups.invitation',
  // #729 (PP-7.2), a record shared with the user.
  'sharing.shared_with_you',
];

/** A valid app event; tests spread it and break one field. */
const APP_EVENT: NotificationEventDef = {
  key: 'coach.weekly_review',
  label: 'Weekly review',
  description: 'Sent every Monday with a summary of your training week.',
  channels: ['email', 'browser'],
  defaultEnabled: true,
};

const appEmail: EmailTemplate<never> = (): RenderedEmail => ({
  subject: 'Your week',
  html: '<p>Your week</p>',
  text: 'Your week',
});

/**
 * Runs `fn` with the event and both binding registries open for writes, and
 * restores all three afterwards, so a test can call `registerNotification`.
 */
function withOpenNotificationRegistries<R>(fn: () => R | Promise<R>): Promise<R> {
  return withTemporaryEntries(notificationEventRegistry, [], () =>
    withTemporaryEntries(eventEmailTemplateRegistry, [], () =>
      withTemporaryEntries(eventBrowserTemplateRegistry, [], fn),
    ),
  );
}

/** The RegistryError `fn` throws. */
function registryErrorFrom(fn: () => void): RegistryError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(RegistryError);
    return err as RegistryError;
  }
  throw new Error('expected a RegistryError');
}

describe('notification registries (#678)', () => {
  // ==========================================================================
  // What the manifest registers
  // ==========================================================================

  describe('platform entries, in order', () => {
    it('registers the three platform channels in the old literal order', () => {
      expect(notificationChannelRegistry.ids()).toEqual(['email', 'browser', 'push']);
    });

    it('registers the nine platform events in the old array order, then org.invitation (#726), groups.invitation (#728) and sharing.shared_with_you (#729)', () => {
      expect(notificationEventRegistry.ids()).toEqual(PLATFORM_EVENT_KEYS);
    });

    it('registers the nine platform email templates in the old literal order, then org-invitation (#726), group-invitation (#728) and shared-with-you (#729)', () => {
      expect(emailTemplateRegistry.ids()).toEqual([
        'test-email',
        'user-welcome',
        'allowlist-invitation',
        'role-changed',
        'broadcast',
        'job-failed',
        'node-offline',
        'backup-failed',
        'restore-completed',
        'org-invitation',
        'group-invitation',
        'shared-with-you',
      ]);
      for (const [name, render] of Object.entries(PLATFORM_EMAIL_TEMPLATES)) {
        expect(emailTemplateRegistry.require(name).render).toBe(render);
      }
    });

    it('binds every platform email event to the template main bound it to', () => {
      expect(Object.fromEntries(eventEmailTemplateRegistry.list().map((b) => [b.eventKey, b.template]))).toEqual({
        'user.welcome': 'user-welcome',
        'allowlist.invitation': 'allowlist-invitation',
        'security.role_changed': 'role-changed',
        'admin.broadcast': 'broadcast',
        'admin.broadcast_critical': 'broadcast',
        'jobs.job_failed': 'job-failed',
        'nodes.node_offline': 'node-offline',
        'db_backup.backup_failed': 'backup-failed',
        'db_backup.restore_completed': 'restore-completed',
        'org.invitation': 'org-invitation',
        'groups.invitation': 'group-invitation',
        'sharing.shared_with_you': 'shared-with-you',
      });
    });

    it('binds a browser renderer exactly where main had one (six keys), plus groups.invitation (#728) and sharing.shared_with_you (#729)', () => {
      expect(Object.fromEntries(eventBrowserTemplateRegistry.list().map((b) => [b.eventKey, b.render]))).toEqual({
        'security.role_changed': roleChangedBrowserTemplate,
        'admin.broadcast': broadcastBrowserTemplate,
        'admin.broadcast_critical': broadcastBrowserTemplate,
        'nodes.node_offline': nodeOfflineBrowserTemplate,
        'db_backup.backup_failed': backupFailedBrowserTemplate,
        'db_backup.restore_completed': restoreCompletedBrowserTemplate,
        'groups.invitation': groupInvitationBrowserTemplate,
        'sharing.shared_with_you': sharedWithYouBrowserTemplate,
      });
    });

    it('keeps the event key bound in step with the user-settings schema', () => {
      expect(NOTIFICATION_EVENT_KEY_MAX_LENGTH).toBe(NOTIFICATION_MAX_EVENT_KEY_LENGTH);
    });
  });

  // ==========================================================================
  // The old exports are views
  // ==========================================================================

  describe('derived views', () => {
    it('NOTIFICATION_CHANNELS is the registry ids as a frozen tuple', () => {
      expect([...NOTIFICATION_CHANNELS]).toEqual(notificationChannelRegistry.ids());
      expect(Object.isFrozen(NOTIFICATION_CHANNELS)).toBe(true);
    });

    it('NOTIFICATION_EVENTS is the registry list as a frozen array of the same objects', () => {
      expect(NOTIFICATION_EVENTS).toEqual(notificationEventRegistry.list());
      NOTIFICATION_EVENTS.forEach((event, i) => expect(event).toBe(notificationEventRegistry.list()[i]));
      expect(Object.isFrozen(NOTIFICATION_EVENTS)).toBe(true);
    });

    it('the two binding maps are frozen snapshots (EMAIL_TEMPLATES and EMAIL_TEMPLATE_NAMES gave way to the registry, #737)', () => {
      expect(Object.keys(EVENT_EMAIL_TEMPLATES)).toEqual(eventEmailTemplateRegistry.ids());
      expect(Object.keys(EVENT_BROWSER_TEMPLATES)).toEqual(eventBrowserTemplateRegistry.ids());
      for (const view of [EVENT_EMAIL_TEMPLATES, EVENT_BROWSER_TEMPLATES]) {
        expect(Object.isFrozen(view)).toBe(true);
      }
    });

    it('channelsFor still returns a defensive copy', () => {
      const channels = channelsFor('security.role_changed');
      channels.push('push');
      expect(findEvent('security.role_changed')?.channels).toEqual(['email', 'browser']);
    });

    it('the lookups read the registry live, so a temporary event is visible', async () => {
      await withOpenNotificationRegistries(() => {
        registerNotification({ event: { ...APP_EVENT, mandatory: true } });

        expect(findEvent(APP_EVENT.key)?.label).toBe('Weekly review');
        expect(channelsFor(APP_EVENT.key)).toEqual(['email', 'browser']);
        expect(supportsChannel(APP_EVENT.key, 'browser')).toBe(true);
        expect(isMandatory(APP_EVENT.key)).toBe(true);
        expect(listNotificationEvents().map((e) => e.key)).toEqual([...PLATFORM_EVENT_KEYS, APP_EVENT.key]);
      });

      expect(findEvent(APP_EVENT.key)).toBeUndefined();
      expect(listNotificationEvents().map((e) => e.key)).toEqual(PLATFORM_EVENT_KEYS);
    });

    it('an app email template is visible to findEmailTemplate and isEmailTemplateName', async () => {
      await withTemporaryEntries(emailTemplateRegistry, [{ name: 'coach-weekly-review', render: appEmail }], () => {
        expect(isEmailTemplateName('coach-weekly-review')).toBe(true);
        // A wrapper that renders with the configured context (#737), so
        // compare what it renders rather than the function itself.
        expect(findEmailTemplate('coach-weekly-review')?.(undefined)).toEqual(appEmail(undefined as never));
      });
      expect(isEmailTemplateName('coach-weekly-review')).toBe(false);
    });
  });

  // ==========================================================================
  // registerNotification: the happy path and atomicity
  // ==========================================================================

  describe('registerNotification', () => {
    it('registers the event and both bindings', async () => {
      const browser = () => ({ title: 't', body: 'b' });

      await withTemporaryEntries(emailTemplateRegistry, [{ name: 'coach-weekly-review', render: appEmail }], () =>
        withOpenNotificationRegistries(() => {
          registerNotification({ event: APP_EVENT, emailTemplate: 'coach-weekly-review', browserTemplate: browser });

          expect(notificationEventRegistry.require(APP_EVENT.key)).toBe(APP_EVENT);
          expect(eventEmailTemplateRegistry.require(APP_EVENT.key).template).toBe('coach-weekly-review');
          expect(eventBrowserTemplateRegistry.require(APP_EVENT.key).render).toBe(browser);
        }),
      );
    });

    it('accepts an event with no bindings (browser falls back; email records a failed delivery)', async () => {
      await withOpenNotificationRegistries(() => {
        registerNotification({ event: APP_EVENT });
        expect(notificationEventRegistry.has(APP_EVENT.key)).toBe(true);
        expect(eventEmailTemplateRegistry.has(APP_EVENT.key)).toBe(false);
      });
    });

    it('registers nothing when a binding is refused (atomic)', async () => {
      await withOpenNotificationRegistries(() => {
        const err = registryErrorFrom(() =>
          registerNotification({ event: APP_EVENT, emailTemplate: 'no-such-template' }),
        );

        expect(err.code).toBe('INVALID_ENTRY');
        expect(notificationEventRegistry.has(APP_EVENT.key)).toBe(false);
        expect(eventEmailTemplateRegistry.has(APP_EVENT.key)).toBe(false);
      });
    });

    it('registers nothing when the browser binding is refused after a valid email binding', async () => {
      await withOpenNotificationRegistries(() => {
        registryErrorFrom(() =>
          registerNotification({
            event: { ...APP_EVENT, channels: ['email'] },
            emailTemplate: 'user-welcome',
            browserTemplate: () => ({ title: 't', body: 'b' }),
          }),
        );

        expect(notificationEventRegistry.has(APP_EVENT.key)).toBe(false);
        expect(eventEmailTemplateRegistry.has(APP_EVENT.key)).toBe(false);
        expect(eventBrowserTemplateRegistry.has(APP_EVENT.key)).toBe(false);
      });
    });

    it('is refused once the registries are frozen', async () => {
      await withOpenNotificationRegistries(() => {
        notificationEventRegistry.freeze();
        const err = registryErrorFrom(() => registerNotification({ event: APP_EVENT }));
        expect(err.code).toBe('FROZEN');
      });
    });
  });

  // ==========================================================================
  // What the registries refuse, each naming the key
  // ==========================================================================

  describe('refusals name the event key', () => {
    const cases: Array<[string, NotificationRegistration, RegistryError['code'], string]> = [
      [
        'an unregistered channel',
        { event: { ...APP_EVENT, channels: ['email', 'carrier_pigeon' as NotificationChannel] } },
        'INVALID_ENTRY',
        'carrier_pigeon',
      ],
      ['an empty channel list', { event: { ...APP_EVENT, channels: [] } }, 'INVALID_ENTRY', 'at least one channel'],
      [
        'a repeated channel',
        { event: { ...APP_EVENT, channels: ['email', 'email'] } },
        'INVALID_ENTRY',
        'must not repeat',
      ],
      [
        'mandatory without defaultEnabled',
        { event: { ...APP_EVENT, mandatory: true, defaultEnabled: false } },
        'INVALID_ENTRY',
        'mandatory',
      ],
      ['an empty label', { event: { ...APP_EVENT, label: ' ' } }, 'INVALID_ENTRY', 'label'],
      ['an empty description', { event: { ...APP_EVENT, description: '' } }, 'INVALID_ENTRY', 'description'],
      [
        'a binding to an unknown email template',
        { event: APP_EVENT, emailTemplate: 'no-such-template' },
        'INVALID_ENTRY',
        'no-such-template',
      ],
      [
        'an email template for an event without the email channel',
        { event: { ...APP_EVENT, channels: ['browser'] }, emailTemplate: 'user-welcome' },
        'INVALID_ENTRY',
        'email channel',
      ],
      [
        'a browser renderer for an email-only event',
        { event: { ...APP_EVENT, channels: ['email'] }, browserTemplate: () => ({ title: 't', body: 'b' }) },
        'INVALID_ENTRY',
        'neither the browser nor the push channel',
      ],
      ['a duplicate platform key', { event: { ...APP_EVENT, key: 'user.welcome' } }, 'DUPLICATE_ID', 'never rename'],
    ];

    it.each(cases)('refuses %s', async (_name, input, code, fragment) => {
      await withOpenNotificationRegistries(() => {
        const err = registryErrorFrom(() => registerNotification(input));

        expect(err.code).toBe(code);
        expect(err.id).toBe(input.event.key);
        expect(err.message).toContain(input.event.key);
        expect(err.message).toContain(fragment);
        expect(notificationEventRegistry.ids()).toEqual(PLATFORM_EVENT_KEYS);
      });
    });

    it.each([['Coach.weekly'], ['coach'], ['coach.weekly-review'], ['coach.weekly review'], ['.weekly']])(
      'refuses the malformed key %s (INVALID_ID)',
      async (key) => {
        await withOpenNotificationRegistries(() => {
          const err = registryErrorFrom(() => registerNotification({ event: { ...APP_EVENT, key } }));
          expect(err.code).toBe('INVALID_ID');
          expect(err.id).toBe(key);
          expect(err.message).toContain(JSON.stringify(key));
        });
      },
    );

    it(`refuses a key longer than ${NOTIFICATION_EVENT_KEY_MAX_LENGTH} characters`, async () => {
      const key = `coach.${'a'.repeat(NOTIFICATION_EVENT_KEY_MAX_LENGTH)}`;
      await withOpenNotificationRegistries(() => {
        const err = registryErrorFrom(() => registerNotification({ event: { ...APP_EVENT, key } }));
        expect(err.code).toBe('INVALID_ENTRY');
        expect(err.id).toBe(key);
      });
    });

    it('refuses a malformed channel id and a duplicate channel', async () => {
      await withTemporaryEntries(notificationChannelRegistry, [], () => {
        expect(
          registryErrorFrom(() =>
            notificationChannelRegistry.register({ id: 'Android-App', label: 'x', description: 'x' }),
          ).code,
        ).toBe('INVALID_ID');
        expect(
          registryErrorFrom(() => notificationChannelRegistry.register({ id: 'email', label: 'x', description: 'x' }))
            .code,
        ).toBe('DUPLICATE_ID');
      });
    });

    it('refuses a template name that is not kebab-case', async () => {
      await withTemporaryEntries(emailTemplateRegistry, [], () => {
        expect(
          registryErrorFrom(() => emailTemplateRegistry.register({ name: 'Coach_Review', render: appEmail })).code,
        ).toBe('INVALID_ID');
      });
    });
  });

  // ==========================================================================
  // ...and they refuse it at IMPORT time, through the app-owned file
  // ==========================================================================

  describe('an invalid app registration fails when the registry is imported', () => {
    afterEach(() => {
      jest.dontMock('../../app-registrations/notifications');
    });

    function importWithApp(app: Record<string, unknown>): unknown {
      let failure: unknown;
      jest.isolateModules(() => {
        jest.doMock('../../app-registrations/notifications', () => ({
          APP_NOTIFICATION_CHANNELS: [],
          APP_EMAIL_TEMPLATES: [],
          APP_NOTIFICATIONS: [],
          ...app,
        }));
        try {
          require('.');
        } catch (err) {
          failure = err;
        }
      });
      return failure;
    }

    it('loads cleanly with a valid app channel, template and notification (listed after the platform)', () => {
      let keys: string[] = [];
      jest.isolateModules(() => {
        jest.doMock('../../app-registrations/notifications', () => ({
          APP_NOTIFICATION_CHANNELS: [{ id: 'android_app', label: 'Android app', description: 'The paired app.' }],
          APP_EMAIL_TEMPLATES: [{ name: 'coach-weekly-review', render: appEmail }],
          APP_NOTIFICATIONS: [
            {
              event: { ...APP_EVENT, channels: ['email', 'android_app'] },
              emailTemplate: 'coach-weekly-review',
            },
          ],
        }));
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fresh = require('.') as typeof import('.');
        keys = fresh.notificationEventRegistry.ids();
      });
      expect(keys).toEqual([...PLATFORM_EVENT_KEYS, APP_EVENT.key]);
    });

    it.each<[string, Record<string, unknown>, string]>([
      ['an unregistered channel', { APP_NOTIFICATIONS: [{ event: { ...APP_EVENT, channels: ['android_app'] } }] }, 'INVALID_ENTRY'],
      ['an empty channel list', { APP_NOTIFICATIONS: [{ event: { ...APP_EVENT, channels: [] } }] }, 'INVALID_ENTRY'],
      ['a malformed key', { APP_NOTIFICATIONS: [{ event: { ...APP_EVENT, key: 'coach' } }] }, 'INVALID_ID'],
      [
        'mandatory without defaultEnabled',
        { APP_NOTIFICATIONS: [{ event: { ...APP_EVENT, mandatory: true, defaultEnabled: false } }] },
        'INVALID_ENTRY',
      ],
      [
        'a binding to an unknown template',
        { APP_NOTIFICATIONS: [{ event: APP_EVENT, emailTemplate: 'no-such-template' }] },
        'INVALID_ENTRY',
      ],
      ['a key colliding with a platform event', { APP_NOTIFICATIONS: [{ event: { ...APP_EVENT, key: 'user.welcome' } }] }, 'DUPLICATE_ID'],
      [
        'a channel colliding with a platform channel',
        { APP_NOTIFICATION_CHANNELS: [{ id: 'email', label: 'Email', description: 'Again.' }] },
        'DUPLICATE_ID',
      ],
    ])('%s', (_name, app, code) => {
      const failure = importWithApp(app) as { name?: string; code?: string; message?: string } | undefined;

      // A fresh module graph, so a fresh RegistryError class: compare by name.
      expect(failure?.name).toBe('RegistryError');
      expect(failure?.code).toBe(code);
    });
  });
});
