// =============================================================================
// The two built-in email transports: `ses` and `smtp` (PP-14.8)
// =============================================================================
//
// They register through `registerEmailTransport`, exactly as an app's
// transport does, and WRAP the classes that have always done the work
// (`SesEmailProvider`, `SmtpEmailProvider`): the same code builds the client,
// holds the cache, redacts the secret and classifies a throttle. What changed
// is where they read their configuration from: not the settings service
// directly, but the settings and the secret the slice hands `build`.
//
//   ses   region + access key id                  secret: secretAccessKey  (email_ses/default)
//   smtp  host + port + TLS flag + username       secret: password         (smtp/default)
//
// The two credential addresses are the ones the store has always used, so a
// stored SMTP password or SES key keeps working.
// =============================================================================

import { z } from 'zod';

import { SES_CREDENTIAL_LABEL, SES_CREDENTIAL_NAME, SES_CREDENTIAL_PURPOSE } from '../ses-credential.constants';
import { SMTP_CREDENTIAL_LABEL, SMTP_CREDENTIAL_NAME, SMTP_CREDENTIAL_PURPOSE } from '../smtp-credential.constants';
import { DEFAULT_SMTP_PORT } from '../email-settings.schema';
import { SesEmailProvider } from '../providers/ses-email.provider';
import { SmtpEmailProvider } from '../providers/smtp-email.provider';
import { emailTransportKind, registerEmailTransport, type EmailTransportDefinition } from './email-transport';

/**
 * The ids of the transports the platform ships.
 *
 * @stability experimental
 */
export const BUILTIN_EMAIL_TRANSPORT_IDS = ['ses', 'smtp'] as const;

/**
 * The settings of the `ses` transport.
 *
 * @stability experimental
 */
export interface SesTransportSettings extends Record<string, unknown> {
  /** Region override; empty means the deployment's fallback. */
  region: string;
  /** The AWS access key id (an identifier, not a secret). */
  accessKeyId: string;
}

/**
 * The settings of the `smtp` transport.
 *
 * @stability experimental
 */
export interface SmtpTransportSettings extends Record<string, unknown> {
  /** Server host; empty means not configured. */
  host: string;
  /** Submission port. */
  port: number;
  /** Require TLS. */
  useTls: boolean;
  /** Username; empty means unauthenticated submission. */
  username: string;
}

/**
 * The `ses` transport definition. Registered at import time by this module.
 *
 * @stability experimental
 */
export const sesEmailTransport: EmailTransportDefinition<SesTransportSettings> = {
  id: 'ses',
  label: 'Amazon SES',
  description: 'Sends through the Amazon SES v2 API with an AWS access key.',
  settingsSchema: z.object({
    region: z
      .string()
      .trim()
      .describe('The region holding your verified sender identity, e.g. us-east-1. Leave blank to use the deployment default.')
      .meta({ label: 'Region' }),
    accessKeyId: z.string().trim().describe('e.g. AKIAIOSFODNN7EXAMPLE').meta({ label: 'Access Key ID' }),
  }),
  defaults: { region: '', accessKeyId: '' },
  secrets: [{ name: 'secretAccessKey', label: 'Secret Access Key', required: true }],
  credentialAddress: () => ({ purpose: SES_CREDENTIAL_PURPOSE, name: SES_CREDENTIAL_NAME, label: SES_CREDENTIAL_LABEL }),
  build: ({ settings, secret, classifyRateLimit, sesRegionFallback }) =>
    new SesEmailProvider(
      {
        get: async () => ({
          provider: 'ses',
          enabled: true,
          ...(settings.region ? { sesRegion: settings.region } : {}),
          ...(settings.accessKeyId ? { sesAccessKeyId: settings.accessKeyId } : {}),
        }),
      },
      { getSecret: () => secret('secretAccessKey') },
      { classifyRateLimit, sesRegionFallback: sesRegionFallback ?? (() => undefined) },
    ),
  missing: (settings, secrets) => {
    const missing: string[] = [];
    if (!settings.region) missing.push('SES region');
    if (settings.accessKeyId && !secrets.secretAccessKey) missing.push('SES secret access key');
    return missing;
  },
  summary: (settings) => `Amazon SES in ${settings.region}`,
  egressCapability: 'Email (Amazon SES)',
  egressHosts: (settings, options) => {
    const region = settings.region || options?.sesRegionFallback?.() || '';
    return region ? [`email.${region}.amazonaws.com`] : [];
  },
};

/**
 * The `smtp` transport definition. Registered at import time by this module.
 *
 * @stability experimental
 */
export const smtpEmailTransport: EmailTransportDefinition<SmtpTransportSettings> = {
  id: 'smtp',
  label: 'SMTP',
  description: 'Sends through an SMTP relay (nodemailer).',
  settingsSchema: z.object({
    host: z.string().trim().describe('e.g. smtp.example.com').meta({ label: 'Host' }),
    port: z.number().int().min(1).max(65535).describe('587 for STARTTLS, 465 for implicit TLS.').meta({ label: 'Port' }),
    useTls: z.boolean().describe('Refuse to send over an unencrypted connection.').meta({ label: 'Require TLS' }),
    username: z.string().trim().describe('Leave blank for a relay that authorises by source IP.').meta({ label: 'Username' }),
  }),
  defaults: { host: '', port: DEFAULT_SMTP_PORT, useTls: true, username: '' },
  secrets: [{ name: 'password', label: 'Password', required: false }],
  credentialAddress: () => ({ purpose: SMTP_CREDENTIAL_PURPOSE, name: SMTP_CREDENTIAL_NAME, label: SMTP_CREDENTIAL_LABEL }),
  build: ({ settings, secret, classifyRateLimit }) =>
    new SmtpEmailProvider(
      {
        get: async () => ({
          provider: 'smtp',
          enabled: true,
          ...(settings.host ? { smtpHost: settings.host } : {}),
          smtpPort: settings.port,
          smtpUseTls: settings.useTls,
          ...(settings.username ? { smtpUsername: settings.username } : {}),
        }),
      },
      { getSecret: () => secret('password') },
      { classifyRateLimit },
    ),
  missing: (settings, secrets) => {
    const missing: string[] = [];
    if (!settings.host) missing.push('SMTP host');
    if (settings.username && !secrets.password) missing.push('SMTP password');
    return missing;
  },
  summary: (settings) => `SMTP via ${settings.host}:${settings.port}`,
  egressCapability: 'Email (SMTP relay)',
  egressHosts: (settings) => (settings.host ? [settings.host] : []),
};

/**
 * Registers `ses` and `smtp`. Runs when this module is first imported, and is
 * safe to call again (a second call does nothing).
 *
 * @stability experimental
 */
export function registerBuiltinEmailTransports(): void {
  if (!emailTransportKind.has(sesEmailTransport.id)) registerEmailTransport(sesEmailTransport);
  if (!emailTransportKind.has(smtpEmailTransport.id)) registerEmailTransport(smtpEmailTransport);
}

registerBuiltinEmailTransports();
