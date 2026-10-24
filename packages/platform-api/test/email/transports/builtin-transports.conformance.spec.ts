// =============================================================================
// The built-in email transports pass the transport kit (PP-14.8)
// =============================================================================
//
// `ses` and `smtp` register through `registerEmailTransport` like any other
// transport, so they run the same kit an app's transport runs. Their SDKs are
// mocked at the module level (nothing here opens a socket): the AWS client
// records the command it was given, nodemailer records the mail it was given.
// =============================================================================

const sesSendMock = jest.fn();
const sesDestroyMock = jest.fn();

jest.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: jest.fn().mockImplementation(() => ({ send: sesSendMock, destroy: sesDestroyMock })),
  SendEmailCommand: jest.fn().mockImplementation((input: unknown) => ({ __command: 'SendEmailCommand', input })),
}));

const smtpSendMailMock = jest.fn();
const smtpCloseMock = jest.fn();

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: smtpSendMailMock, close: smtpCloseMock })),
}));

import { Logger } from '@nestjs/common';

import { describeEmailTransportConformance } from '../../../src/email/testing/transport-conformance';
import type { ReceivedEmail } from '../../../src/email/testing/transport-conformance';
import '../../../src/email/transports/builtin-email-transports';

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  jest.spyOn(Logger.prototype, 'error').mockImplementation();
});

beforeEach(() => {
  sesSendMock.mockReset();
  smtpSendMailMock.mockReset();
});

describeEmailTransportConformance('ses', {
  describe,
  it,
  expect,
  settings: { region: 'us-east-1', accessKeyId: 'AKIAEXAMPLEKEYID0001' },
  secrets: { secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' },
  backend: {
    accept: () => {
      sesSendMock.mockResolvedValue({ MessageId: 'ses-message-id' });
      return (): ReceivedEmail[] =>
        sesSendMock.mock.calls.map(([command]) => {
          const input = command.input;
          const simple = input.Content.Simple;
          return {
            to: input.Destination.ToAddresses,
            from: input.FromEmailAddress,
            subject: simple.Subject.Data,
            html: simple.Body.Html.Data,
            text: simple.Body.Text.Data,
            headers: Object.fromEntries((simple.Headers ?? []).map((header: { Name: string; Value: string }) => [header.Name, header.Value])),
            attachments: (simple.Attachments ?? []).map(
              (part: { FileName: string; ContentType: string; RawContent: Buffer; ContentId?: string; ContentDisposition: string }) => ({
                filename: part.FileName,
                contentType: part.ContentType,
                contentBase64: Buffer.from(part.RawContent).toString('base64'),
                contentId: part.ContentId,
                disposition: part.ContentDisposition,
              }),
            ),
          };
        });
    },
    failWith: (error) => {
      sesSendMock.mockRejectedValue(error);
    },
  },
});

describeEmailTransportConformance('smtp', {
  describe,
  it,
  expect,
  settings: { host: 'smtp.example.test', port: 587, useTls: true, username: 'mailer' },
  secrets: { password: 'correct-horse-battery-staple' },
  backend: {
    accept: () => {
      smtpSendMailMock.mockResolvedValue({ messageId: '<smtp-message-id@example.test>' });
      return (): ReceivedEmail[] =>
        smtpSendMailMock.mock.calls.map(([mail]) => ({
          to: mail.to,
          from: mail.from,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          headers: mail.headers,
          attachments: (mail.attachments ?? []).map(
            (part: { filename: string; contentType: string; content: Buffer; cid?: string; contentDisposition: string }) => ({
              filename: part.filename,
              contentType: part.contentType,
              contentBase64: Buffer.from(part.content).toString('base64'),
              contentId: part.cid,
              disposition: part.contentDisposition,
            }),
          ),
        }));
    },
    failWith: (error) => {
      smtpSendMailMock.mockRejectedValue(error);
    },
  },
});
