// =============================================================================
// Reading a response from an API older than the transports (PP-14.8)
// =============================================================================
//
// `GET /api/email-settings` describes every registered transport (`descriptors`),
// carries each one's settings (`transports`) and the masked status of each of
// its secrets (`secretStatuses`). A response from a deployment whose API is
// older than that carries only the flat `ses*`/`smtp*` fields and the two
// legacy secret statuses. The page must still draw the two built-in forms for
// it (the web assets and the API are deployed together, but a rolling update or
// a cached bundle meets the other version for a while), so this fills in what
// the old response lacked from what it had. A response that carries the new
// fields is returned untouched.
// =============================================================================

import type { EmailCredentialStatusDto, EmailSettingsResponse } from '@marinoscar/platform-contract/email';
import type { PluggableDescriptor } from '@marinoscar/platform-contract/settings';

const NO_SECRET: EmailCredentialStatusDto = { configured: false, hint: null, updatedAt: null, updatedByUserId: null };

/** The built-in transports' descriptors, for a response that carried none. */
const BUILTIN_DESCRIPTORS: readonly PluggableDescriptor[] = [
  {
    kind: 'email-transport',
    id: 'ses',
    label: 'Amazon SES',
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
    fields: [
      { kind: 'string', name: 'host', label: 'Host' },
      { kind: 'number', name: 'port', label: 'Port', min: 1, max: 65535, integer: true },
      { kind: 'boolean', name: 'useTls', label: 'Require TLS' },
      { kind: 'string', name: 'username', label: 'Username' },
      { kind: 'secret', name: 'password', label: 'Password', hasValue: false, required: false },
    ],
  },
];

/**
 * A response, possibly from an API that predates pluggable transports.
 *
 * @stability experimental
 */
export type EmailSettingsWire = Omit<EmailSettingsResponse, 'transports' | 'descriptors' | 'secretStatuses'> &
  Partial<Pick<EmailSettingsResponse, 'transports' | 'descriptors' | 'secretStatuses'>>;

/**
 * The response with `transports`, `descriptors` and `secretStatuses` filled in
 * from the flat fields and the two legacy statuses when the API sent none.
 *
 * @param settings - the response.
 * @returns the same object when it already carries the three fields; otherwise a copy that does.
 *
 * @stability experimental
 */
export function withTransportDefaults(settings: EmailSettingsWire): EmailSettingsResponse {
  if (settings.transports && settings.descriptors && settings.secretStatuses) return settings as EmailSettingsResponse;

  return {
    ...settings,
    transports: settings.transports ?? {
      ses: { region: settings.sesRegion ?? '', accessKeyId: settings.sesAccessKeyId ?? '' },
      smtp: {
        host: settings.smtpHost ?? '',
        port: settings.smtpPort ?? 587,
        useTls: settings.smtpUseTls ?? true,
        username: settings.smtpUsername ?? '',
      },
    },
    descriptors: settings.descriptors && settings.descriptors.length > 0 ? settings.descriptors : [...BUILTIN_DESCRIPTORS],
    secretStatuses: settings.secretStatuses ?? {
      ses: { secretAccessKey: settings.sesSecretAccessKeyStatus ?? NO_SECRET },
      smtp: { password: settings.smtpPasswordStatus ?? NO_SECRET },
    },
  };
}
