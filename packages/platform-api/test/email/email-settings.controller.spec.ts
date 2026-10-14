import { EmailSettingsController } from '../../src/email/email-settings.controller';
import { EmailSettingsService } from '../../src/email/email-settings.service';
import { EmailTestSendService } from '../../src/email/email-test-send.service';
import { PERMISSIONS_KEY, type RequestUser } from '../../src/identity/index';

// =============================================================================
// EmailSettingsController — tests (issue #124, epic #109)
// =============================================================================
//
// The controller is thin by design: parse `If-Match`, forward to the service,
// and — for the test endpoint — forward exactly `{ id, email }` from the
// authenticated caller, never anything from the request body. That last point
// is the one worth pinning here: `sendTestEmail` has no `@Body()` parameter at
// all, so there is no way for a request to influence who the message goes to.
// =============================================================================

describe('EmailSettingsController', () => {
  let controller: EmailSettingsController;
  let mockEmailSettings: { describeForAdmin: jest.Mock; update: jest.Mock };
  let mockTestSend: { sendTest: jest.Mock };

  const user: RequestUser = {
    id: 'user-1',
    email: 'admin@example.com',
    roles: ['admin'],
    permissions: ['system_settings:read', 'system_settings:write'],
    isActive: true,
  };

  beforeEach(async () => {
    mockEmailSettings = {
      describeForAdmin: jest.fn().mockResolvedValue({ provider: null, enabled: false }),
      update: jest.fn().mockResolvedValue({ provider: null, enabled: false }),
    };
    mockTestSend = {
      sendTest: jest.fn().mockResolvedValue({ success: true }),
    };

    // Constructed directly: these tests call the handlers, never through the
    // route guards `@Auth()` attaches (the routes' permissions are asserted
    // from metadata below and end to end in the reference app).
    controller = new EmailSettingsController(
      mockEmailSettings as unknown as EmailSettingsService,
      mockTestSend as unknown as EmailTestSendService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /email-settings', () => {
    it('delegates to describeForAdmin with no arguments', async () => {
      await controller.getSettings();

      expect(mockEmailSettings.describeForAdmin).toHaveBeenCalledWith();
    });
  });

  describe('PUT /email-settings', () => {
    it('parses a well-formed If-Match into a numeric expectedVersion', async () => {
      await controller.replaceSettings(
        { provider: 'smtp', enabled: true } as any,
        'user-1',
        '3',
      );

      expect(mockEmailSettings.update).toHaveBeenCalledWith(
        { provider: 'smtp', enabled: true },
        'user-1',
        3,
      );
    });

    it('treats a malformed If-Match as absent, matching "omit to overwrite unconditionally"', async () => {
      await controller.replaceSettings(
        { provider: 'smtp', enabled: true } as any,
        'user-1',
        'not-a-number',
      );

      expect(mockEmailSettings.update).toHaveBeenCalledWith(
        { provider: 'smtp', enabled: true },
        'user-1',
        undefined,
      );
    });

    it('treats an absent If-Match as undefined', async () => {
      await controller.replaceSettings(
        { provider: 'smtp', enabled: true } as any,
        'user-1',
        undefined,
      );

      expect(mockEmailSettings.update).toHaveBeenCalledWith(
        { provider: 'smtp', enabled: true },
        'user-1',
        undefined,
      );
    });

    it('treats If-Match: 0 as a real, asserted expectation ("nothing stored yet") rather than absent', async () => {
      await controller.replaceSettings(
        { provider: 'smtp', enabled: true } as any,
        'user-1',
        '0',
      );

      expect(mockEmailSettings.update).toHaveBeenCalledWith(
        { provider: 'smtp', enabled: true },
        'user-1',
        0,
      );
    });
  });

  describe('POST /email-settings/test', () => {
    it('sends exactly { id, email } from the authenticated caller — nothing else reaches the service', async () => {
      await controller.sendTestEmail(user);

      expect(mockTestSend.sendTest).toHaveBeenCalledTimes(1);
      expect(mockTestSend.sendTest).toHaveBeenCalledWith({
        id: user.id,
        email: user.email,
      });
    });

    it('has no @Body() parameter to receive a recipient from: the handler signature takes only the current user', () => {
      // Reflects the actual method arity rather than asserting on decorator
      // metadata, so a future refactor that quietly adds a body parameter
      // (even one that types as unused) fails this test.
      expect(controller.sendTestEmail.length).toBe(1);
    });

    it('returns whatever the service reports, unchanged — including a failed attempt', async () => {
      const failure = {
        success: false,
        sentTo: user.email,
        providerKind: 'smtp',
        messageId: null,
        error: 'SMTP: 535 Authentication failed',
        attemptedAt: new Date().toISOString(),
      };
      mockTestSend.sendTest.mockResolvedValue(failure);

      const result = await controller.sendTestEmail(user);

      expect(result).toEqual(failure);
    });
  });

  describe('route permissions (unchanged by the move into the package, #737)', () => {
    it.each([
      ['getSettings', 'system_settings:read'],
      ['replaceSettings', 'system_settings:write'],
      ['sendTestEmail', 'system_settings:write'],
    ] as const)('%s requires %s', (method, permission) => {
      const handler = EmailSettingsController.prototype[method];
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual([permission]);
    });
  });
});
