/**
 * Fixtures of `GET /api/email-settings` as the API serves it since email
 * transports became pluggable (PP-14.8): `transports` (every registered
 * transport's settings, defaults filled), `descriptors` (one per transport),
 * `secretStatuses`, and the deprecated flat read view of the built-ins
 * (`smtpHost`, `sesRegion`, ... and the two legacy secret statuses).
 *
 * `log` is the reference app's example transport (an optional secret);
 * `relay-api` is invented for these tests, so a transport with a REQUIRED
 * secret and a setting of every control kind has something to be tested against.
 */

import type { PluggableDescriptor } from '@marinoscar/platform-contract/settings';

import type { EmailSettings } from '../../src/email/headless/index.js';

export const NO_SECRET = { configured: false, hint: null, updatedAt: null, updatedByUserId: null };
export const SAVED_SECRET = { configured: true, hint: '••••ab12', updatedAt: null, updatedByUserId: 'admin-user-id' };

/** The descriptors of the two built-in transports, as the API serves them. */
export const builtinDescriptors = (): PluggableDescriptor[] => [
  {
    kind: 'email-transport',
    id: 'ses',
    label: 'Amazon SES',
    description: 'Sends through the Amazon SES v2 API with an AWS access key.',
    fields: [
      { kind: 'string', name: 'region', label: 'Region', help: 'The region holding your verified sender identity.' },
      { kind: 'string', name: 'accessKeyId', label: 'Access Key ID', help: 'e.g. AKIAIOSFODNN7EXAMPLE' },
      { kind: 'secret', name: 'secretAccessKey', label: 'Secret Access Key', hasValue: false, required: true },
    ],
  },
  {
    kind: 'email-transport',
    id: 'smtp',
    label: 'SMTP',
    description: 'Sends through an SMTP relay (nodemailer).',
    fields: [
      { kind: 'string', name: 'host', label: 'Host', help: 'e.g. smtp.example.com' },
      { kind: 'number', name: 'port', label: 'Port', min: 1, max: 65535, integer: true },
      { kind: 'boolean', name: 'useTls', label: 'Require TLS' },
      { kind: 'string', name: 'username', label: 'Username' },
      { kind: 'secret', name: 'password', label: 'Password', hasValue: false, required: false },
    ],
  },
];

/** The reference app's example transport: an in-memory log with an optional secret. */
export const logDescriptor = (): PluggableDescriptor => ({
  kind: 'email-transport',
  id: 'log',
  label: 'Log (in memory)',
  description: 'Keeps the latest messages in memory and logs one redacted line each. Nothing leaves this server.',
  fields: [
    { kind: 'number', name: 'keep', label: 'Messages kept', help: 'How many of the latest messages to keep in memory.', min: 1, max: 1000, integer: true },
    { kind: 'secret', name: 'sinkToken', label: 'Sink token', help: 'Optional. Stored encrypted and never logged.', hasValue: false, required: false },
  ],
});

/** An invented transport with a required secret, a select, a switch and a number. */
export const relayDescriptor = (hasValue = false): PluggableDescriptor => ({
  kind: 'email-transport',
  id: 'relay-api',
  label: 'Relay API',
  description: 'A hosted relay reached over HTTPS.',
  fields: [
    { kind: 'string', name: 'apiBase', label: 'API base URL', maxLength: 200 },
    { kind: 'enum', name: 'region', label: 'Data region', options: ['us', 'eu'] },
    { kind: 'boolean', name: 'sandbox', label: 'Sandbox mode' },
    { kind: 'number', name: 'retries', label: 'Retries', min: 0, max: 5, integer: true },
    { kind: 'secret', name: 'apiKey', label: 'API key', hasValue, required: true },
  ],
});

const SMTP_DEFAULTS = { host: '', port: 587, useTls: true, username: '' };
const SES_DEFAULTS = { region: '', accessKeyId: '' };

/**
 * The response for a configured SMTP transport, with the flat read view the
 * response carries beside `transports`. Pass `overrides` to change any field.
 */
export function emailSettingsFixture(overrides: Partial<EmailSettings> = {}): EmailSettings {
  return {
    provider: 'smtp',
    enabled: true,
    fromAddress: 'no-reply@example.test',
    fromName: 'Example App',
    smtpHost: 'smtp.example.test',
    smtpPort: 587,
    smtpUseTls: true,
    smtpUsername: 'relay-user',
    transports: {
      ses: { ...SES_DEFAULTS },
      smtp: { host: 'smtp.example.test', port: 587, useTls: true, username: 'relay-user' },
    },
    descriptors: builtinDescriptors(),
    secretStatuses: { ses: { secretAccessKey: NO_SECRET }, smtp: { password: SAVED_SECRET } },
    smtpPasswordStatus: SAVED_SECRET,
    sesSecretAccessKeyStatus: NO_SECRET,
    settingsError: null,
    version: 3,
    updatedAt: null,
    updatedBy: null,
    ...overrides,
  };
}

/** A configured SES transport with a saved secret. */
export function sesSettingsFixture(overrides: Partial<EmailSettings> = {}): EmailSettings {
  return emailSettingsFixture({
    provider: 'ses',
    sesRegion: 'eu-west-1',
    sesAccessKeyId: 'AKIAEXAMPLEKEYID0001',
    smtpHost: undefined,
    smtpPort: undefined,
    smtpUseTls: undefined,
    smtpUsername: undefined,
    transports: { ses: { region: 'eu-west-1', accessKeyId: 'AKIAEXAMPLEKEYID0001' }, smtp: { ...SMTP_DEFAULTS } },
    secretStatuses: { ses: { secretAccessKey: SAVED_SECRET }, smtp: { password: NO_SECRET } },
    smtpPasswordStatus: NO_SECRET,
    sesSecretAccessKeyStatus: SAVED_SECRET,
    ...overrides,
  });
}

/** A fresh install: no transport chosen, switched off, nothing stored. */
export function freshSettingsFixture(overrides: Partial<EmailSettings> = {}): EmailSettings {
  return emailSettingsFixture({
    provider: null,
    enabled: false,
    fromAddress: undefined,
    fromName: undefined,
    smtpHost: undefined,
    smtpPort: undefined,
    smtpUseTls: undefined,
    smtpUsername: undefined,
    transports: { ses: { ...SES_DEFAULTS }, smtp: { ...SMTP_DEFAULTS } },
    secretStatuses: { ses: { secretAccessKey: NO_SECRET }, smtp: { password: NO_SECRET } },
    smtpPasswordStatus: NO_SECRET,
    sesSecretAccessKeyStatus: NO_SECRET,
    version: 0,
    ...overrides,
  });
}
