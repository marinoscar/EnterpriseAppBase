/**
 * Fixtures of `GET /api/email-settings` as the API serves it since email
 * transports became pluggable (PP-14.8): `transports` (every registered
 * transport's settings, defaults filled), `descriptors` (one per transport)
 * and `secretStatuses`, beside the deprecated flat read view of the built-ins.
 *
 * `log` is the reference app's example transport (an in-memory log with an
 * optional secret); `relay-api` is invented for a test, so a transport with a
 * REQUIRED secret has something to be tested against.
 *
 * Deliberately self-contained (no import from `@marinoscar/platform-web`
 * values): some page tests replace that module with a mock.
 */

import type { EmailSettings } from '@marinoscar/platform-web/email/headless';

type PluggableDescriptor = EmailSettings['descriptors'][number];
type SecretStatus = EmailSettings['smtpPasswordStatus'];

const NO_SECRET: SecretStatus = { configured: false, hint: null, updatedAt: null, updatedByUserId: null };

/** The descriptors of the two built-in transports. */
export const builtinEmailDescriptors = (): PluggableDescriptor[] => [
  {
    kind: 'email-transport',
    id: 'ses',
    label: 'Amazon SES',
    description: 'Sends through the Amazon SES v2 API with an AWS access key.',
    fields: [
      { kind: 'string', name: 'region', label: 'Region' },
      { kind: 'string', name: 'accessKeyId', label: 'Access Key ID' },
      { kind: 'secret', name: 'secretAccessKey', label: 'Secret Access Key', hasValue: false, required: true },
    ],
  },
  {
    kind: 'email-transport',
    id: 'smtp',
    label: 'SMTP',
    description: 'Sends through an SMTP relay (nodemailer).',
    fields: [
      { kind: 'string', name: 'host', label: 'Host' },
      { kind: 'number', name: 'port', label: 'Port', min: 1, max: 65535, integer: true },
      { kind: 'boolean', name: 'useTls', label: 'Require TLS' },
      { kind: 'string', name: 'username', label: 'Username' },
      { kind: 'secret', name: 'password', label: 'Password', hasValue: false, required: false },
    ],
  },
];

/** The reference app's example transport. */
export const logEmailDescriptor = (): PluggableDescriptor => ({
  kind: 'email-transport',
  id: 'log',
  label: 'Log (in memory)',
  description: 'Keeps the latest messages in memory and logs one redacted line each. Nothing leaves this server.',
  fields: [
    { kind: 'number', name: 'keep', label: 'Messages kept', help: 'How many of the latest messages to keep in memory.', min: 1, max: 1000, integer: true },
    { kind: 'secret', name: 'sinkToken', label: 'Sink token', help: 'Optional. Stored encrypted and never logged.', hasValue: false, required: false },
  ],
});

/** An invented transport that declares a required secret. */
export const relayEmailDescriptor = (hasValue = false): PluggableDescriptor => ({
  kind: 'email-transport',
  id: 'relay-api',
  label: 'Relay API',
  description: 'A hosted relay reached over HTTPS.',
  fields: [
    { kind: 'string', name: 'apiBase', label: 'API base URL', maxLength: 200 },
    { kind: 'secret', name: 'apiKey', label: 'API key', hasValue, required: true },
  ],
});

/** The settings every response carries about the built-ins: defaults, nothing stored. */
const builtinTransports = () => ({
  ses: { region: '', accessKeyId: '' },
  smtp: { host: '', port: 587, useTls: true, username: '' },
});

/**
 * A response with the transport fields filled in from the flat view it carries
 * (`smtpHost`, `sesRegion`, ...) and the two legacy secret statuses, as the API
 * serves it. Pass the old-shaped fields; get the current shape.
 */
export function withTransportFields(
  base: Omit<EmailSettings, 'transports' | 'descriptors' | 'secretStatuses'>,
  extra: Partial<Pick<EmailSettings, 'transports' | 'descriptors' | 'secretStatuses'>> = {},
): EmailSettings {
  const defaults = builtinTransports();
  return {
    ...base,
    transports: {
      ses: { region: base.sesRegion ?? defaults.ses.region, accessKeyId: base.sesAccessKeyId ?? defaults.ses.accessKeyId },
      smtp: {
        host: base.smtpHost ?? defaults.smtp.host,
        port: base.smtpPort ?? defaults.smtp.port,
        useTls: base.smtpUseTls ?? defaults.smtp.useTls,
        username: base.smtpUsername ?? defaults.smtp.username,
      },
      ...extra.transports,
    },
    descriptors: extra.descriptors ?? builtinEmailDescriptors(),
    secretStatuses: {
      ses: { secretAccessKey: base.sesSecretAccessKeyStatus ?? NO_SECRET },
      smtp: { password: base.smtpPasswordStatus ?? NO_SECRET },
      ...extra.secretStatuses,
    },
  };
}

/** A configured SMTP response with the example `log` transport registered beside the built-ins. */
export function emailSettingsWithLogTransport(overrides: Partial<EmailSettings> = {}): EmailSettings {
  return withTransportFields(
    {
      provider: 'smtp',
      enabled: true,
      fromAddress: 'no-reply@example.com',
      fromName: 'Example App',
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpUseTls: true,
      smtpUsername: 'relay-user',
      smtpPasswordStatus: { configured: true, hint: '••••ab12', updatedAt: '2024-01-01T00:00:00.000Z', updatedByUserId: 'admin-user-id' },
      sesSecretAccessKeyStatus: NO_SECRET,
      settingsError: null,
      version: 3,
      updatedAt: '2024-01-01T00:00:00.000Z',
      updatedBy: { id: 'admin-user-id', email: 'admin@example.com' },
      ...overrides,
    },
    {
      descriptors: [...builtinEmailDescriptors(), logEmailDescriptor()],
      transports: { log: { keep: 100 } },
      secretStatuses: { log: { sinkToken: NO_SECRET } },
    },
  );
}
