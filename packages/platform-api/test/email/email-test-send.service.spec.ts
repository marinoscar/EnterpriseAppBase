import { Test, TestingModule } from '@nestjs/testing';

import { EmailTestSendService, formatFromHeader } from '../../src/email/email-test-send.service';
import { EmailSettingsService } from '../../src/email/email-settings.service';
import { AUDIT_SINK } from '../../src/core/index';
import { EMAIL_OPTIONS } from '../../src/email/email.options';
import { EmailTransportResolver } from '../../src/email/transports/email-transport.resolver';
import type { EmailSettings } from '../../src/email/email-settings.schema';
import type { EmailSendResult } from '../../src/email/email.types';
import { configureTestEmail } from './support';

configureTestEmail();

// =============================================================================
// EmailTestSendService — tests (issue #124, epic #109)
// =============================================================================
//
// This is the "Send test email" button's server-side half, and issue #124
// states its contract in the plainest terms: the recipient is the caller and
// nothing else, a refused send is a SUCCESSFUL diagnostic (never a throw), and
// a pre-flight failure (no provider, disabled, no from address) must reach the
// admin in exactly the same shape as a provider rejection.
//
// The two transports are `{ send: jest.fn() }` stand-ins behind a fake
// `EmailTransportResolver` rather than the real classes: the point of
// this suite is EmailTestSendService's own branching (which provider gets
// called, what happens when it fails, what happens before it is ever reached),
// not the transports themselves — those have their own spec files.
// =============================================================================

describe('EmailTestSendService', () => {
  let service: EmailTestSendService;
  let mockEmailSettings: { get: jest.Mock };
  let mockPrisma: { auditEvent: { create: jest.Mock } };
  let mockSes: { send: jest.Mock };
  let mockSmtp: { send: jest.Mock };
  let mockConfig: { appUrl: jest.Mock };
  let mockResolve: jest.Mock;

  const actor = { id: 'user-1', email: 'admin@example.com' };

  const smtpSettings: EmailSettings = {
    provider: 'smtp',
    enabled: true,
    fromAddress: 'no-reply@example.com',
    fromName: 'Example App',
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
  };

  beforeEach(async () => {
    mockEmailSettings = { get: jest.fn().mockResolvedValue(smtpSettings) };
    mockPrisma = { auditEvent: { create: jest.fn().mockResolvedValue({}) } };
    mockSes = { send: jest.fn() };
    mockSmtp = { send: jest.fn() };
    mockConfig = { appUrl: jest.fn().mockReturnValue('https://app.example.com') };
    mockResolve = jest.fn(async (settings: { provider: string | null }) => ({
      ok: true,
      id: settings.provider,
      label: settings.provider,
      transport: settings.provider === 'ses' ? mockSes : mockSmtp,
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailTestSendService,
        { provide: EMAIL_OPTIONS, useValue: mockConfig },
        // The core audit port (#737), recorded into the same mock the
        // assertions below read, in the shape the app's sink persists.
        { provide: AUDIT_SINK, useValue: { record: (event: unknown) => mockPrisma.auditEvent.create({ data: event }) } },
        { provide: EmailSettingsService, useValue: mockEmailSettings },
        // The configured transport, resolved by the settings' `provider`
        // (PP-14.8); the two mocks stand in for what each id builds.
        { provide: EmailTransportResolver, useValue: { resolve: mockResolve } },
      ],
    }).compile();

    service = module.get<EmailTestSendService>(EmailTestSendService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================================================
  // The recipient is the caller, and only the caller
  // ==========================================================================

  describe('recipient', () => {
    it('sends to the actor\'s own address', async () => {
      mockSmtp.send.mockResolvedValue({ success: true, messageId: 'abc-123' });

      await service.sendTest(actor);

      expect(mockSmtp.send).toHaveBeenCalledTimes(1);
      const [message] = mockSmtp.send.mock.calls[0];
      expect(message.to).toBe(actor.email);
    });

    it('there is no request-shaped input the recipient can be influenced by: the signature accepts only { id, email }', async () => {
      mockSmtp.send.mockResolvedValue({ success: true, messageId: 'abc-123' });

      // Even an actor object smuggling extra properties (as a body-bound
      // controller call might, if it were ever mis-wired) still only
      // contributes `id`/`email` — nothing else on the object can reach the
      // outgoing message.
      const smuggledActor = {
        ...actor,
        to: 'attacker@evil.example',
        recipient: 'attacker@evil.example',
      } as typeof actor;

      await service.sendTest(smuggledActor);

      const [message] = mockSmtp.send.mock.calls[0];
      expect(message.to).toBe(actor.email);
      expect(message.to).not.toBe('attacker@evil.example');
    });
  });

  // ==========================================================================
  // A refused send is a result, never a throw — and the error is verbatim
  // ==========================================================================

  describe('provider failure', () => {
    it('resolves (never rejects) with success: false and the provider\'s error text intact', async () => {
      const providerError: EmailSendResult = {
        success: false,
        error: 'SMTP: 535 Authentication failed',
      };
      mockSmtp.send.mockResolvedValue(providerError);

      const result = await service.sendTest(actor);

      expect(result.success).toBe(false);
      expect(result.error).toBe('SMTP: 535 Authentication failed');
      expect(result.providerKind).toBe('smtp');
      expect(result.messageId).toBeNull();
      expect(result.sentTo).toBe(actor.email);
    });

    it('falls back to a generic message only when the transport supplies none', async () => {
      mockSmtp.send.mockResolvedValue({ success: false });

      const result = await service.sendTest(actor);

      expect(result.success).toBe(false);
      expect(result.error).toEqual(expect.stringContaining('no message'));
    });

    it('records a failed attempt in the audit trail', async () => {
      mockSmtp.send.mockResolvedValue({ success: false, error: 'boom' });

      await service.sendTest(actor);

      expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorUserId: actor.id,
            action: 'email_settings:test',
            meta: expect.objectContaining({ success: false, error: 'boom' }),
          }),
        }),
      );
    });
  });

  describe('provider success', () => {
    it('never claims success unless the provider actually reported success', async () => {
      mockSmtp.send.mockResolvedValue({ success: true, messageId: 'msg-1' });

      const result = await service.sendTest(actor);

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
      expect(result.messageId).toBe('msg-1');
    });

    it('records a successful attempt in the audit trail', async () => {
      mockSmtp.send.mockResolvedValue({ success: true, messageId: 'msg-1' });

      await service.sendTest(actor);

      expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorUserId: actor.id,
            action: 'email_settings:test',
            meta: expect.objectContaining({ success: true, error: null }),
          }),
        }),
      );
    });
  });

  // ==========================================================================
  // Pre-flight failures come back in the SAME SHAPE as a provider rejection
  // ==========================================================================

  describe('pre-flight failures — same shape as a provider rejection, and no provider is ever reached', () => {
    it('no provider selected', async () => {
      mockEmailSettings.get.mockResolvedValue({ provider: null, enabled: false });

      const result = await service.sendTest(actor);

      expect(result.success).toBe(false);
      expect(result.providerKind).toBeNull();
      expect(result.sentTo).toBe(actor.email);
      expect(typeof result.error).toBe('string');
      expect(result.error).toEqual(expect.stringContaining('provider'));
      expect(mockSes.send).not.toHaveBeenCalled();
      expect(mockSmtp.send).not.toHaveBeenCalled();
    });

    it('sending disabled (master switch off)', async () => {
      mockEmailSettings.get.mockResolvedValue({
        provider: 'smtp',
        enabled: false,
        smtpHost: 'smtp.example.com',
        fromAddress: 'no-reply@example.com',
      });

      const result = await service.sendTest(actor);

      expect(result.success).toBe(false);
      expect(result.providerKind).toBe('smtp');
      expect(result.error).toEqual(expect.stringContaining('disabled'));
      expect(mockSmtp.send).not.toHaveBeenCalled();
    });

    it('no from-address configured', async () => {
      mockEmailSettings.get.mockResolvedValue({
        provider: 'smtp',
        enabled: true,
        smtpHost: 'smtp.example.com',
      });

      const result = await service.sendTest(actor);

      expect(result.success).toBe(false);
      expect(result.providerKind).toBe('smtp');
      expect(result.error).toEqual(expect.stringContaining('from address'));
      expect(mockSmtp.send).not.toHaveBeenCalled();
    });

    it('a stored-but-invalid settings row (get() throws) — reports the message, does not throw', async () => {
      mockEmailSettings.get.mockRejectedValue(
        new Error('Stored email settings are invalid at: provider. Re-save the email configuration.'),
      );

      const result = await service.sendTest(actor);

      expect(result.success).toBe(false);
      expect(result.providerKind).toBeNull();
      expect(result.error).toEqual(expect.stringContaining('invalid'));
      expect(mockSmtp.send).not.toHaveBeenCalled();
      expect(mockSes.send).not.toHaveBeenCalled();
    });

    it('all four pre-flight failures share the exact same result shape as a provider rejection', async () => {
      const providerFailure: EmailSendResult = { success: false, error: 'SMTP: boom' };
      mockSmtp.send.mockResolvedValue(providerFailure);
      const providerResult = await service.sendTest(actor);

      mockEmailSettings.get.mockResolvedValue({ provider: null, enabled: false });
      const noProviderResult = await service.sendTest(actor);

      const shapeKeys = (obj: object) => Object.keys(obj).sort();
      expect(shapeKeys(noProviderResult)).toEqual(shapeKeys(providerResult));
    });
  });

  // ==========================================================================
  // Pre-flight order: provider chosen -> enabled -> from address -> send
  // ==========================================================================

  describe('the transport (PP-14.8)', () => {
    it('is resolved from the settings, so any registered transport is used, not only ses and smtp', async () => {
      mockEmailSettings.get.mockResolvedValue({ ...smtpSettings, provider: 'log' });
      const custom = { send: jest.fn().mockResolvedValue({ success: true, messageId: 'log-1' }) };
      mockResolve.mockResolvedValue({ ok: true, id: 'log', label: 'Log', transport: custom });

      const result = await service.sendTest(actor);

      expect(mockResolve).toHaveBeenCalledWith(expect.objectContaining({ provider: 'log' }));
      expect(custom.send).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ success: true, providerKind: 'log', messageId: 'log-1' });
    });

    it('a transport that cannot be resolved is a failed diagnosis in the usual shape, and nothing is sent', async () => {
      mockResolve.mockResolvedValue({ ok: false, error: 'Email transport "smtp" could not be built: boom' });

      const result = await service.sendTest(actor);

      expect(result).toMatchObject({ success: false, providerKind: 'smtp', error: 'Email transport "smtp" could not be built: boom' });
      expect(mockSmtp.send).not.toHaveBeenCalled();
      expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ meta: expect.objectContaining({ success: false }) }) }),
      );
    });

    it('runs the transport verify first, and reports its message instead of sending when it is not ok', async () => {
      const verify = jest.fn().mockResolvedValue({ ok: false, message: 'The API key was rejected.' });
      mockResolve.mockResolvedValue({ ok: true, id: 'smtp', label: 'SMTP', transport: { ...mockSmtp, verify } });

      const result = await service.sendTest(actor);

      expect(result).toMatchObject({ success: false, error: 'The API key was rejected.' });
      expect(mockSmtp.send).not.toHaveBeenCalled();
    });

    it('treats a verify that throws as a failed diagnosis, never a rejection', async () => {
      const verify = jest.fn().mockRejectedValue(new Error('verify exploded'));
      mockResolve.mockResolvedValue({ ok: true, id: 'smtp', label: 'SMTP', transport: { ...mockSmtp, verify } });

      await expect(service.sendTest(actor)).resolves.toMatchObject({ success: false, error: 'verify exploded' });
    });

    it('sends when verify says ok', async () => {
      const verify = jest.fn().mockResolvedValue({ ok: true, message: 'ready' });
      mockSmtp.send.mockResolvedValue({ success: true, messageId: 'm-1' });
      mockResolve.mockResolvedValue({ ok: true, id: 'smtp', label: 'SMTP', transport: { send: mockSmtp.send, verify } });

      await expect(service.sendTest(actor)).resolves.toMatchObject({ success: true, messageId: 'm-1' });
      expect(verify).toHaveBeenCalledTimes(1);
    });
  });

  describe('pre-flight ordering', () => {
    it('checks "enabled" before requiring a from address, so the error names the actual blocker', async () => {
      mockEmailSettings.get.mockResolvedValue({
        provider: 'smtp',
        enabled: false,
        // fromAddress deliberately also missing
      });

      const result = await service.sendTest(actor);

      expect(result.error).toEqual(expect.stringContaining('disabled'));
      expect(result.error).not.toEqual(expect.stringContaining('from address'));
    });
  });

  // ==========================================================================
  // formatFromHeader — exported so #125's dispatcher can share it
  // ==========================================================================

  describe('formatFromHeader', () => {
    it('returns a bare address when no name is given', () => {
      expect(formatFromHeader('no-reply@example.com')).toBe('no-reply@example.com');
    });

    it('quotes a printable-ASCII name', () => {
      expect(formatFromHeader('no-reply@example.com', 'Example App')).toBe(
        '"Example App" <no-reply@example.com>',
      );
    });

    it('strips CR/LF/NUL from the name (header injection defence)', () => {
      const injected = 'Example\r\nBcc: attacker@evil.example';
      const result = formatFromHeader('no-reply@example.com', injected);
      expect(result).not.toContain('\r');
      expect(result).not.toContain('\n');
    });
  });
});
