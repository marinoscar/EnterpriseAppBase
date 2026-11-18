import { Logger } from '@nestjs/common';
import {
  BaseEmailProvider,
  type EmailMessage,
  type EmailSendResult,
  type EmailTransportDefinition,
  type SecretRedactor,
} from '@marinoscar/platform-api/email';
import type { GenericRateLimitClassifier } from '@marinoscar/platform-api/email';
import { z } from 'zod';

// =============================================================================
// EXAMPLE: an email transport an app adds WITHOUT touching a package (PP-14.8)
// =============================================================================
//
// `log` "sends" every message into memory and writes one REDACTED line to the
// application log: no mail server, no account, no network. It is the smallest
// complete transport, the one a developer wants on a laptop ("did the welcome
// email fire, and what did it say?"), and the one the example specs
// (`test/examples/email/log-transport.spec.ts`) run the conformance kit and the
// email consumers against.
//
// WHAT A TRANSPORT IS. A definition (`id`, `label`, `settingsSchema`,
// `defaults`, `secrets`) that the admin page renders as a generated form, and
// `build`, which turns the administrator's settings (and, through `secret(name)`,
// the encrypted secrets) into an object with `send`. It is registered once, at
// import time, from `app-registrations/email.ts`; from then on an administrator
// can pick it at /admin/settings/email, and every email the application sends
// (notifications, broadcasts, the admin "Send test email") goes through it.
//
// EXTEND `BaseEmailProvider`. It implements `send` once, around your `deliver`:
// `send` NEVER throws (every failure is `{ success: false, error }`), the error
// text is scrubbed of every secret you `redact.protect(...)` and length-capped,
// and a thrown throttle is classified (`rateLimited`, `retryAfterMs`) with the
// classifier the app gave `EmailModule.forRoot` (handed to `build` as
// `classifyRateLimit`). A transport that implements `EmailProvider` directly
// loses all three.
//
// SECRETS. The optional `sinkToken` stands for whatever credential a real
// transport has (an API key). It is declared in `secrets`, so it is stored
// encrypted under the credential purpose `email_log`, written through the admin
// form (blank keeps the stored one), read by `secret('sinkToken')` at SEND time
// (a rotation takes effect on the next message) and never part of the settings.
// The transport registers it with `redact.protect` the moment it holds it.
//
// WHAT IT LOGS. One line per message: a masked recipient, the number of
// attachments and the id. Never the subject, the body, the headers or the full
// address: a body carries invitation and reset links, and application logs are
// retained far more widely than mail.
//
// OFF UNTIL SELECTED. Registering the transport changes nothing for a running
// deployment: `provider` stays what it was until an administrator selects "Log
// (in memory)" and saves.
// =============================================================================

/** The transport id: the key of `transports`, the value of `provider`, the credential purpose suffix. */
export const LOG_TRANSPORT_ID = 'log';

/** The settings of the transport. */
export interface LogTransportSettings extends Record<string, unknown> {
  /** How many of the latest messages are kept in memory. */
  keep: number;
}

/**
 * Where the transport puts what it "sends". Module state on purpose: the
 * application builds the transport when its settings change, and a test (or a
 * developer in a REPL) reads the same list. In memory only, never persisted.
 */
export const logTransportRecorder = {
  /** The messages received, oldest first, capped at the `keep` setting. */
  sent: [] as EmailMessage[],
  /** Set to make the next sends fail with this error (a test seam: whatever an SDK would throw or reject with). */
  failure: undefined as unknown,
  /** Messages accepted since the last reset (not capped). */
  total: 0,
  /** Forgets every message and any scripted failure. */
  reset(): void {
    this.sent = [];
    this.failure = undefined;
    this.total = 0;
  },
};

/** `jane.doe@example.test` becomes `j***@example.test`. */
export function maskAddress(address: string): string {
  const at = address.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${address.slice(0, 1)}***${address.slice(at)}`;
}

/**
 * The `log` transport: records into {@link logTransportRecorder} and logs one
 * redacted line.
 */
class LogEmailTransport extends BaseEmailProvider {
  protected readonly logger: Logger;
  protected readonly transportName = 'Log';

  constructor(
    private readonly keep: number,
    private readonly sinkToken: () => Promise<string | null>,
    logger: Logger,
    classifyRateLimit: GenericRateLimitClassifier | undefined,
  ) {
    super();
    this.logger = logger;
    this.rateLimitClassifier = classifyRateLimit;
  }

  protected async deliver(msg: EmailMessage, redact: SecretRedactor): Promise<EmailSendResult> {
    // Register the secret the instant it is held, BEFORE anything that might throw with it in the text.
    redact.protect(await this.sinkToken());

    if (logTransportRecorder.failure !== undefined) throw logTransportRecorder.failure;

    logTransportRecorder.total += 1;
    logTransportRecorder.sent.push(msg);
    if (logTransportRecorder.sent.length > this.keep) {
      logTransportRecorder.sent.splice(0, logTransportRecorder.sent.length - this.keep);
    }

    const id = `log-${logTransportRecorder.total}`;
    this.logger.log(`Recorded ${id} for ${maskAddress(msg.to)} (${msg.attachments?.length ?? 0} attachment(s))`);

    return { success: true, messageId: id };
  }
}

/**
 * The `log` transport definition, registered by `app-registrations/email.ts`.
 */
export const logEmailTransport: EmailTransportDefinition<LogTransportSettings> = {
  id: LOG_TRANSPORT_ID,
  label: 'Log (in memory)',
  description: 'Keeps the latest messages in memory and logs one redacted line each. Nothing leaves this server.',
  settingsSchema: z.object({
    keep: z.number().int().min(1).max(1000).describe('How many of the latest messages to keep in memory.').meta({ label: 'Messages kept' }),
  }),
  defaults: { keep: 100 },
  secrets: [
    {
      name: 'sinkToken',
      label: 'Sink token',
      required: false,
      help: 'Optional. Stands for the API key a real transport would have; it is stored encrypted and never logged.',
    },
  ],
  build: ({ settings, secret, logger, classifyRateLimit }) =>
    new LogEmailTransport(settings.keep, () => secret('sinkToken'), logger, classifyRateLimit),
  summary: (settings) => `In-memory log, keeping ${settings.keep as number} messages`,
  egressCapability: 'Email (in-memory log)',
  // Nothing leaves the server, so the network-egress view lists no host.
  egressHosts: () => [],
};
