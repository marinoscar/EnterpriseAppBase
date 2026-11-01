// Inline attachments end to end (issue #737): a brand mark configured on the
// layout becomes an inline part of the rendered message, referenced by its
// Content-ID, and both transports send it (nodemailer `attachments` with `cid`,
// SESv2 `Content.Simple.Attachments` with `ContentId`), with mocked transports.

const smtpSendMailMock = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: smtpSendMailMock, close: jest.fn() })),
}));

const sesSendMock = jest.fn();
jest.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: jest.fn().mockImplementation(() => ({ send: sesSendMock, destroy: jest.fn() })),
  SendEmailCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
}));

import { Logger } from '@nestjs/common';

import type { CredentialsService } from '../../src/credentials/index';
import type { EmailSettingsService } from '../../src/email/email-settings.service';
import type { EmailMessage } from '../../src/email/email.types';
import { SesEmailProvider } from '../../src/email/providers/ses-email.provider';
import { SmtpEmailProvider } from '../../src/email/providers/smtp-email.provider';
import { renderEmailTemplate } from '../../src/email/templates/email-template.registry';
import { createEmailRenderContext } from '../../src/email/templates/render-context';
import { TEST_APP_NAME, configureTestEmail } from './support';

configureTestEmail();

/** A 1x1 transparent PNG. */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const BRANDED = createEmailRenderContext({
  appName: TEST_APP_NAME,
  layout: { brandMark: { pngBase64: PNG, cid: 'brand-mark', displaySize: 40, alt: 'Logo' } },
});

function messageFrom(ctx = BRANDED): EmailMessage {
  const rendered = renderEmailTemplate(
    'user-welcome',
    { recipientEmail: 'new@example.test', roles: ['viewer'], appUrl: 'https://app.example.test' },
    ctx,
  );
  return {
    to: 'new@example.test',
    from: 'no-reply@example.test',
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    ...(rendered.headers ? { headers: rendered.headers } : {}),
    ...(rendered.attachments ? { attachments: rendered.attachments } : {}),
  };
}

function settings(value: Record<string, unknown>): EmailSettingsService {
  return { get: jest.fn().mockResolvedValue(value) } as unknown as EmailSettingsService;
}

function credentials(secret: string | null): CredentialsService {
  return { getSecret: jest.fn().mockResolvedValue(secret) } as unknown as CredentialsService;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Logger.prototype, 'warn').mockImplementation();
});

describe('the brand mark as an inline attachment', () => {
  it('is referenced by cid: in the HTML and carried as an inline part of the rendered message', () => {
    const message = messageFrom();
    expect(message.html).toContain('<img src="cid:brand-mark" width="40" height="40" alt="Logo"');
    expect(message.attachments).toEqual([
      { filename: 'brand-mark.png', contentType: 'image/png', contentBase64: PNG, contentId: 'brand-mark', disposition: 'inline' },
    ]);
  });

  it('is absent with the default layout: no <img>, no attachments key', () => {
    const message = messageFrom(createEmailRenderContext({ appName: TEST_APP_NAME }));
    expect(message.html).not.toContain('cid:');
    expect(message).not.toHaveProperty('attachments');
  });

  it('SMTP sends it as a nodemailer attachment with a cid', async () => {
    smtpSendMailMock.mockResolvedValue({ messageId: 'smtp-1' });
    const provider = new SmtpEmailProvider(settings({ provider: 'smtp', enabled: true, smtpHost: 'smtp.example.test' }), credentials(null));

    const result = await provider.send(messageFrom());

    expect(result).toEqual({ success: true, messageId: 'smtp-1' });
    const [mail] = smtpSendMailMock.mock.calls[0] as [{ attachments: Array<Record<string, unknown>> }];
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments[0]).toMatchObject({
      filename: 'brand-mark.png',
      contentType: 'image/png',
      contentDisposition: 'inline',
      cid: 'brand-mark',
    });
    expect((mail.attachments[0]!.content as Buffer).equals(Buffer.from(PNG, 'base64'))).toBe(true);
  });

  it('SES sends it as Content.Simple.Attachments with a ContentId, INLINE, BASE64', async () => {
    sesSendMock.mockResolvedValue({ MessageId: 'ses-1' });
    const provider = new SesEmailProvider(
      settings({ provider: 'ses', enabled: true, sesRegion: 'eu-west-1', sesAccessKeyId: 'AKIAEXAMPLE' }),
      credentials('a-secret-access-key-value'),
    );

    const result = await provider.send(messageFrom());

    expect(result).toEqual({ success: true, messageId: 'ses-1' });
    const [command] = sesSendMock.mock.calls[0] as [{ input: { Content: { Simple: { Attachments: Array<Record<string, unknown>> } } } }];
    const parts = command.input.Content.Simple.Attachments;
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      FileName: 'brand-mark.png',
      ContentType: 'image/png',
      ContentDisposition: 'INLINE',
      ContentTransferEncoding: 'BASE64',
      ContentId: 'brand-mark',
    });
    expect((parts[0]!.RawContent as Buffer).equals(Buffer.from(PNG, 'base64'))).toBe(true);
  });

  it('neither transport adds an attachments field to a message without parts', async () => {
    smtpSendMailMock.mockResolvedValue({ messageId: 'smtp-2' });
    sesSendMock.mockResolvedValue({ MessageId: 'ses-2' });
    const plain = messageFrom(createEmailRenderContext({ appName: TEST_APP_NAME }));

    await new SmtpEmailProvider(settings({ provider: 'smtp', enabled: true, smtpHost: 'smtp.example.test' }), credentials(null)).send(plain);
    await new SesEmailProvider(
      settings({ provider: 'ses', enabled: true, sesRegion: 'eu-west-1', sesAccessKeyId: 'AKIAEXAMPLE' }),
      credentials('a-secret-access-key-value'),
    ).send(plain);

    expect(smtpSendMailMock.mock.calls[0]![0]).not.toHaveProperty('attachments');
    expect((sesSendMock.mock.calls[0]![0] as { input: { Content: { Simple: object } } }).input.Content.Simple).not.toHaveProperty('Attachments');
  });
});
