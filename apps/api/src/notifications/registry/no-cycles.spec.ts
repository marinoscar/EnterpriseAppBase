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

  it('notification-events.ts loads first with every export defined', () => {
    const mod = loadFirst<typeof import('../notification-events')>('../notification-events');

    expect(mod.NOTIFICATION_CHANNELS).toEqual(['email', 'browser', 'push']);
    expect(mod.NOTIFICATION_EVENTS.length).toBe(11);
    for (const name of ['findEvent', 'channelsFor', 'supportsChannel', 'isMandatory', 'listNotificationEvents'] as const) {
      expect(typeof mod[name]).toBe('function');
    }
    expect(mod.findEvent('user.welcome')?.label).toBe('Welcome');
  });

  it('email/templates/index.ts loads first with every export defined', () => {
    const mod = loadFirst<typeof import('../../email/templates')>('../../email/templates');

    expect(mod.EMAIL_TEMPLATE_NAMES).toHaveLength(11);
    expect(Object.keys(mod.EMAIL_TEMPLATES)).toHaveLength(11);
    expect(typeof mod.PLATFORM_EMAIL_TEMPLATES['test-email']).toBe('function');
    expect(typeof mod.findEmailTemplate('user-welcome')).toBe('function');
    expect(mod.isEmailTemplateName('broadcast')).toBe(true);
    expect(typeof mod.renderEmailTemplate).toBe('function');
  });

  it('common/schemas/user-settings-namespaces.schema.ts loads first with every export defined', () => {
    const mod = loadFirst<Record<string, unknown>>('../../common/schemas/user-settings-namespaces.schema');

    expect(Object.keys(mod).length).toBeGreaterThan(0);
    for (const [name, value] of Object.entries(mod)) {
      expect([name, value]).not.toEqual([name, undefined]);
    }
    expect(mod.NOTIFICATION_MAX_EVENT_KEY_LENGTH).toBe(64);
  });

  it('the registry barrel loads first and is filled', () => {
    const mod = loadFirst<typeof import('.')>('.');

    expect(mod.notificationChannelRegistry.ids()).toEqual(['email', 'browser', 'push']);
    expect(mod.notificationEventRegistry.size).toBe(11);
    expect(mod.emailTemplateRegistry.size).toBe(11);
    expect(mod.eventEmailTemplateRegistry.size).toBe(11);
    expect(mod.eventBrowserTemplateRegistry.size).toBe(7);
  });

  it('the browser channel loads first with its exports defined', () => {
    const mod = loadFirst<typeof import('../channels/browser-notification.channel')>(
      '../channels/browser-notification.channel',
    );

    expect(Object.keys(mod.EVENT_BROWSER_TEMPLATES)).toHaveLength(7);
    expect(typeof mod.sanitizeLink).toBe('function');
    expect(typeof mod.BrowserNotificationChannel).toBe('function');
  });
});
