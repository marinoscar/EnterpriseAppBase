// =============================================================================
// No import cycles through the notification registry (issue #678, PP-1.6)
// =============================================================================
//
// The manifest imports declaration files from all over the tree, and three
// widely-imported modules import the manifest (through ./index.ts). Under
// CommonJS a cycle does not fail loudly: a module that is reached again while
// it is still loading hands out its half-built exports, so a constant reads as
// `undefined` and a `z.enum(undefined)` or `.ids()` call blows up somewhere
// far away, and only when that module happens to be the FIRST one loaded.
//
// So each entry point below is loaded first, in a fresh module registry, and
// its exports must be fully defined. A declaration file that imports the
// browser channel class (instead of the leaf browser-templates.ts), or a
// template file that imports email/templates/index.ts, fails here.
//
// Since #738 the registries are `@marinoscar/platform-api/notifications` and
// the manifest is the app's (`src/platform/notifications/`): the package loads
// first on its own (empty registries), and the app's barrel loads first and
// fills them.
// =============================================================================

describe('notification registry: no import cycles', () => {
  function loadFirst<T>(path: string): T {
    let loaded: T | undefined;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      loaded = require(path) as T;
    });
    return loaded as T;
  }

  it('the app barrel (src/platform/notifications) loads first with every export defined', () => {
    const mod = loadFirst<typeof import('../../../src/platform/notifications')>('../../../src/platform/notifications');

    expect(mod.NOTIFICATION_CHANNELS).toEqual(['email', 'browser', 'push', 'android_app']);
    expect(mod.NOTIFICATION_EVENTS.length).toBe(14);
    expect(mod.NOTIFICATION_EVENTS.find((event) => event.key === 'user.welcome')?.label).toBe('Welcome');
  });

  it('the package loads first on its own, with every lookup defined and nothing registered', () => {
    const mod = loadFirst<typeof import('@marinoscar/platform-api/notifications')>('@marinoscar/platform-api/notifications');

    for (const name of ['findEvent', 'channelsFor', 'supportsChannel', 'isMandatory', 'listNotificationEvents'] as const) {
      expect(typeof mod[name]).toBe('function');
    }
    expect(mod.notificationEventRegistry.size).toBe(0);
  });

  it('platform/email/templates (the slice-owned templates) loads first with every export defined', () => {
    const mod = loadFirst<typeof import('../../../src/platform/email/templates')>('../../../src/platform/email/templates');

    expect(mod.SLICE_EMAIL_TEMPLATES.map((entry) => entry.name)).toEqual(['org-invitation', 'group-invitation', 'shared-with-you']);
    expect(typeof mod.orgInvitationEmail).toBe('function');
    expect(typeof mod.groupInvitationEmail).toBe('function');
    expect(typeof mod.sharedWithYouEmail).toBe('function');
  });

  it('common/schemas/user-settings-namespaces.schema.ts loads first with every export defined', () => {
    const mod = loadFirst<Record<string, unknown>>('../../../src/common/schemas/user-settings-namespaces.schema');

    expect(Object.keys(mod).length).toBeGreaterThan(0);
    for (const [name, value] of Object.entries(mod)) {
      expect([name, value]).not.toEqual([name, undefined]);
    }
    expect(mod.NOTIFICATION_MAX_EVENT_KEY_LENGTH).toBe(64);
  });

  it('the registry barrel loads first and is filled', () => {
    const mod = loadFirst<typeof import('../support/notifications')>('../support/notifications');

    expect(mod.notificationChannelRegistry.ids()).toEqual(['email', 'browser', 'push', 'android_app']);
    expect(mod.notificationEventRegistry.size).toBe(14);
    expect(mod.emailTemplateRegistry.size).toBe(12);
    expect(mod.eventEmailTemplateRegistry.size).toBe(12);
    expect(mod.eventBrowserTemplateRegistry.size).toBe(10);
  });

  it('the browser channel loads first with its exports defined', () => {
    const mod = loadFirst<typeof import('../support/notifications')>('../support/notifications');

    expect(Object.keys(mod.EVENT_BROWSER_TEMPLATES)).toHaveLength(10);
    expect(typeof mod.sanitizeLink).toBe('function');
    expect(typeof mod.BrowserNotificationChannel).toBe('function');
  });
});
