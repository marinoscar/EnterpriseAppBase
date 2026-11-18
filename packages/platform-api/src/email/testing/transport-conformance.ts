// =============================================================================
// Email transport conformance kit (PP-14.8)
// =============================================================================
//
// ONE suite every email transport runs, so "implements the email transport
// contract" means the same thing for the platform's `ses` and `smtp` and for an
// app's own. It builds the transport the way the slice does (from its settings
// and secrets) and drives `send` against a backend the caller controls:
//
//   import { describeEmailTransportConformance } from '@marinoscar/platform-api/email/testing';
//
//   describeEmailTransportConformance('sendgrid', {
//     describe, it, expect,
//     settings: { apiBase: 'https://api.example.test' },
//     secrets: { apiKey: 'SG.example-key-not-real' },
//     backend: {
//       accept: () => { fake.respondWith(202); return () => fake.requests.map(toReceivedEmail); },
//       failWith: (error) => fake.rejectWith(error),
//     },
//   });
//
// It is runner-agnostic like `describePluggableKindConformance`: it receives
// `describe`, `it` and `expect`, so Jest and Vitest both work and the package
// imports no test framework. Nothing here needs a network: point the transport
// at a fake (a mocked SDK, a local stub server, an in-memory recorder).
//
// WHAT IT CHECKS
//
//   - the definition: a valid id and label, defaults that parse with the
//     transport's own schema, secrets that are declared, and `build`;
//   - a built transport has `send`, and an ACCEPTED message is `{ success: true }`;
//   - `send` NEVER THROWS: a network error, a thrown string and a thrown object
//     all come back as `{ success: false, error }` with a non-empty error;
//   - the error text carries NO SECRET MATERIAL (a backend that echoes the
//     credential back must not get it into the result) and NO MESSAGE CONTENT
//     (the recipient address, the subject or the body);
//   - ATTACHMENTS and HEADERS are passed through (an inline part with its
//     Content-ID, a plain attachment, a custom header), and the message goes to
//     exactly its one recipient;
//   - a provider THROTTLE is classified: `rateLimited: true`;
//   - `verify`, when defined, never throws and returns `{ ok, message }` with no
//     secret in the message.
// =============================================================================

import { Logger } from '@nestjs/common';

import type { EmailAttachment, EmailMessage, EmailSendResult } from '../email.types';
import type { GenericRateLimitClassifier } from '../email-rate-limit';
import {
  emailTransportKind,
  getEmailTransport,
  type EmailTransport,
  type EmailTransportDefinition,
} from '../transports/email-transport';
import { EMAIL_TRANSPORT_ID_PATTERN } from '@marinoscar/platform-contract/email';

/**
 * The test runner's own globals, passed in.
 *
 * @stability experimental
 */
export interface EmailTransportConformanceHarness {
  /** The runner's `describe`. */
  describe: (name: string, fn: () => void) => unknown;
  /** The runner's `it`. Every case body the kit passes is an asynchronous function. */
  it: (name: string, fn: () => Promise<void>) => unknown;
  /** The runner's `expect`. */
  expect: (actual: unknown) => any;
}

/**
 * One message as the backend received it, in a neutral shape. The caller turns
 * its fake's record (an SES command, a nodemailer call, an HTTP request body)
 * into this.
 *
 * @stability experimental
 */
export interface ReceivedEmail {
  /** The recipient(s) the backend was asked to deliver to. */
  to?: string | readonly string[];
  /** The sender, as sent. */
  from?: string;
  /** The subject, as sent. */
  subject?: string;
  /** The HTML part. */
  html?: string;
  /** The text part. */
  text?: string;
  /** The custom headers, by name. */
  headers?: Readonly<Record<string, string>>;
  /** The MIME parts. */
  attachments?: readonly ReceivedEmailAttachment[];
}

/**
 * One MIME part as the backend received it.
 *
 * @stability experimental
 */
export interface ReceivedEmailAttachment {
  /** The file name. */
  filename: string;
  /** The MIME type, when the backend exposes it. */
  contentType?: string;
  /** The bytes, base64-encoded, when the backend exposes them. */
  contentBase64?: string;
  /** The Content-ID, without angle brackets. */
  contentId?: string;
  /** `inline` or `attachment` (any case). */
  disposition?: string;
}

/**
 * The backend the transport talks to, driven by the kit.
 *
 * @stability experimental
 */
export interface EmailTransportConformanceBackend {
  /**
   * Arranges for the backend to ACCEPT every send. Returns a reader of what it
   * received since (the kit calls it after sending).
   */
  accept(): (() => readonly ReceivedEmail[]) | Promise<() => readonly ReceivedEmail[]>;
  /**
   * Arranges for the backend to FAIL every send with `error` (an Error, a
   * string or an object: whatever the SDK would throw or reject with).
   */
  failWith(error: unknown): void | Promise<void>;
}

/**
 * One scenario of the kit; each is skippable by name.
 *
 * @stability experimental
 */
export type EmailTransportConformanceScenario =
  | 'definition'
  | 'accepts'
  | 'neverThrows'
  | 'errorHygiene'
  | 'attachments'
  | 'rateLimit'
  | 'verify';

/**
 * Options of {@link describeEmailTransportConformance}.
 *
 * @stability experimental
 */
export interface EmailTransportConformanceOptions extends EmailTransportConformanceHarness {
  /** VALID settings for the transport (parsed with its `settingsSchema`, defaults filled): a configuration a send would work with. */
  settings: Record<string, unknown>;
  /** A value for each secret the transport declares, by name. `{}` for a transport with none. */
  secrets: Record<string, string>;
  /** The fake backend. */
  backend: EmailTransportConformanceBackend;
  /** Scenarios to skip, each for a stated reason of the caller's. */
  skip?: readonly EmailTransportConformanceScenario[];
}

const RECIPIENT = 'conformance-recipient@example.test';
const SUBJECT = 'Conformance subject 7d1c';
const HTML_MARKER = 'conformance-html-body-3f9a';
const ATTACHMENT_BASE64 = Buffer.from('conformance attachment bytes').toString('base64');
const LOGO_BASE64 = Buffer.from('conformance logo bytes').toString('base64');

/** The generic HTTP / SDK classifier the kit builds the transport with: 429, 503, 529 and the AWS throttle names. */
const KIT_CLASSIFIER: GenericRateLimitClassifier = (err) => {
  if (err === null || typeof err !== 'object') return { rateLimited: false, retryAfterMs: null };
  const candidate = err as { name?: unknown; $metadata?: { httpStatusCode?: unknown }; headers?: Record<string, unknown> };
  const status = candidate.$metadata?.httpStatusCode;
  const throttled =
    status === 429 ||
    status === 503 ||
    status === 529 ||
    (typeof candidate.name === 'string' && /^(Throttling|ThrottlingException|TooManyRequestsException)$/.test(candidate.name));
  if (!throttled) return { rateLimited: false, retryAfterMs: null };
  const retryAfter = Number(candidate.headers?.['retry-after']);
  return { rateLimited: true, retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null };
};

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {}, fatal() {} } as unknown as Logger;

function message(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    to: RECIPIENT,
    from: 'Conformance <no-reply@example.test>',
    subject: SUBJECT,
    html: `<p>${HTML_MARKER}</p>`,
    text: HTML_MARKER,
    ...overrides,
  };
}

function throttleError(): Error {
  return Object.assign(new Error('Too many requests'), {
    name: 'TooManyRequestsException',
    $metadata: { httpStatusCode: 429 },
    headers: { 'retry-after': '30' },
  });
}

/**
 * Registers the email transport conformance suite.
 *
 * @param transport - a transport definition, or the id of a registered one.
 * @param options - the runner, valid settings and secrets, and the fake backend.
 *
 * @example
 * ```ts
 * import '../../../src/app-registrations/email';
 * import { describeEmailTransportConformance } from '@marinoscar/platform-api/email/testing';
 *
 * describeEmailTransportConformance('log', { describe, it, expect, settings: {}, secrets: {}, backend });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function describeEmailTransportConformance(
  transport: EmailTransportDefinition<any> | string,
  options: EmailTransportConformanceOptions,
): void {
  const { describe, it, expect } = options;
  const skip = new Set(options.skip ?? []);
  const label = typeof transport === 'string' ? transport : transport.id;

  const resolve = (): EmailTransportDefinition<any> => {
    const definition = typeof transport === 'string' ? getEmailTransport(transport) : transport;
    if (!definition) {
      throw new Error(
        `Email transport "${label}" is not registered (registered: ${emailTransportKind.ids().join(', ') || '(none)'}). ` +
          'Import the module that calls registerEmailTransport before running the kit.',
      );
    }
    return definition;
  };

  const build = async (): Promise<EmailTransport> => {
    const definition = resolve();
    const settings = definition.settingsSchema.parse({ ...definition.defaults, ...options.settings }) as Record<string, unknown>;
    return definition.build({
      logger: SILENT_LOGGER,
      classifyRateLimit: KIT_CLASSIFIER,
      settings,
      secret: async (name) => options.secrets[name] ?? null,
    });
  };

  const send = async (built: EmailTransport, msg: EmailMessage = message()): Promise<EmailSendResult> => {
    let result: EmailSendResult | undefined;
    let threw: unknown;
    try {
      result = await built.send(msg);
    } catch (error) {
      threw = error;
    }
    // THE CONTRACT: send never rejects.
    expect(threw).toBeUndefined();
    return result as EmailSendResult;
  };

  describe(`email transport conformance: ${label}`, () => {
    if (!skip.has('definition')) {
      describe('the definition', () => {
        it('has a valid id and label, parseable defaults and declared secrets', async () => {
          const definition = resolve();
          expect(EMAIL_TRANSPORT_ID_PATTERN.test(definition.id)).toBe(true);
          expect(typeof definition.label).toBe('string');
          expect(definition.label.trim()).not.toBe('');
          expect(definition.settingsSchema.safeParse(definition.defaults).success).toBe(true);
          expect(typeof definition.build).toBe('function');
          const declared = (definition.secrets ?? []).map((secret) => secret.name);
          for (const name of declared) expect(typeof options.secrets[name]).toBe('string');
          for (const name of Object.keys(options.secrets)) expect(declared).toContain(name);
        });

        it('builds a transport with a send function', async () => {
          const built = await build();
          expect(typeof built.send).toBe('function');
        });
      });
    }

    if (!skip.has('accepts')) {
      describe('an accepted message', () => {
        it('is { success: true }', async () => {
          const built = await build();
          await options.backend.accept();
          const result = await send(built);
          expect(result.success).toBe(true);
          if (result.messageId !== undefined) expect(typeof result.messageId).toBe('string');
        });
      });
    }

    if (!skip.has('neverThrows')) {
      describe('send never throws', () => {
        const failures: ReadonlyArray<readonly [string, () => unknown]> = [
          ['a network error', () => new Error('connect ECONNREFUSED 127.0.0.1:25')],
          ['a thrown string', () => 'upstream exploded'],
          ['a thrown object', () => ({ weird: true })],
        ];
        for (const [name, make] of failures) {
          it(`turns ${name} into { success: false, error }`, async () => {
            const built = await build();
            await options.backend.failWith(make());
            const result = await send(built);
            expect(result.success).toBe(false);
            expect(typeof result.error).toBe('string');
            expect((result.error as string).length).toBeGreaterThan(0);
          });
        }
      });
    }

    if (!skip.has('errorHygiene')) {
      describe('the error text', () => {
        it('carries no message content: not the recipient, the subject or the body', async () => {
          const built = await build();
          await options.backend.failWith(new Error('connect ECONNREFUSED 127.0.0.1:25'));
          const result = await send(built);
          expect(result.success).toBe(false);
          const text = result.error as string;
          expect(text).not.toContain(RECIPIENT);
          expect(text).not.toContain(SUBJECT);
          expect(text).not.toContain(HTML_MARKER);
        });

        it('carries no secret material, even when the backend echoes the credential back', async () => {
          const values = Object.values(options.secrets).filter((value) => value.length > 0);
          for (const value of values) {
            const built = await build();
            await options.backend.failWith(new Error(`authentication failed for credential ${value}`));
            const result = await send(built);
            expect(result.success).toBe(false);
            expect(result.error as string).not.toContain(value);
          }
        });
      });
    }

    if (!skip.has('attachments')) {
      describe('attachments and headers', () => {
        it('are passed through, to exactly the one recipient', async () => {
          const built = await build();
          const received = await options.backend.accept();
          const attachments: EmailAttachment[] = [
            { filename: 'brand-mark.png', contentType: 'image/png', contentBase64: LOGO_BASE64, contentId: 'brand-mark', disposition: 'inline' },
            { filename: 'report.txt', contentType: 'text/plain', contentBase64: ATTACHMENT_BASE64, disposition: 'attachment' },
          ];
          const result = await send(
            built,
            message({ headers: { 'X-Conformance-Id': 'abc-123', 'List-Unsubscribe': '<mailto:unsubscribe@example.test>' }, attachments }),
          );
          expect(result.success).toBe(true);

          const messages = received();
          expect(messages).toHaveLength(1);
          const [got] = messages as [ReceivedEmail];

          if (got.to !== undefined) {
            const recipients = typeof got.to === 'string' ? [got.to] : [...got.to];
            expect(recipients).toEqual([RECIPIENT]);
          }
          if (got.subject !== undefined) expect(got.subject).toBe(SUBJECT);

          expect(got.headers).toBeDefined();
          expect((got.headers as Record<string, string>)['X-Conformance-Id']).toBe('abc-123');
          expect((got.headers as Record<string, string>)['List-Unsubscribe']).toBe('<mailto:unsubscribe@example.test>');

          const parts = got.attachments ?? [];
          expect(parts).toHaveLength(2);
          for (const sent of attachments) {
            const part = parts.find((candidate) => candidate.filename === sent.filename);
            expect(part).toBeDefined();
            if (part?.contentType !== undefined) expect(part.contentType).toBe(sent.contentType);
            if (part?.contentBase64 !== undefined) expect(part.contentBase64).toBe(sent.contentBase64);
            if (sent.contentId !== undefined && part?.contentId !== undefined) expect(part.contentId.replace(/^<|>$/g, '')).toBe(sent.contentId);
            if (part?.disposition !== undefined) expect(part.disposition.toLowerCase()).toBe(sent.disposition);
          }
        });
      });
    }

    if (!skip.has('rateLimit')) {
      describe('a provider throttle', () => {
        it('is classified: { success: false, rateLimited: true }', async () => {
          const built = await build();
          await options.backend.failWith(throttleError());
          const result = await send(built);
          expect(result.success).toBe(false);
          expect(result.rateLimited).toBe(true);
          if (result.retryAfterMs !== undefined) expect(typeof result.retryAfterMs).toBe('number');
        });

        it('does not classify an ordinary failure as a throttle', async () => {
          const built = await build();
          await options.backend.failWith(new Error('connect ECONNREFUSED 127.0.0.1:25'));
          const result = await send(built);
          expect(result.success).toBe(false);
          expect(result.rateLimited).not.toBe(true);
        });
      });
    }

    if (!skip.has('verify')) {
      describe('verify', () => {
        it('never throws and returns { ok, message } with no secret in the message', async () => {
          const built = await build();
          if (!built.verify) return;
          await options.backend.failWith(new Error('verify failed'));
          let verdict: { ok: boolean; message: string } | undefined;
          let threw: unknown;
          try {
            verdict = await built.verify();
          } catch (error) {
            threw = error;
          }
          expect(threw).toBeUndefined();
          expect(typeof verdict?.ok).toBe('boolean');
          expect(typeof verdict?.message).toBe('string');
          for (const value of Object.values(options.secrets).filter((candidate) => candidate.length > 0)) {
            expect(verdict?.message as string).not.toContain(value);
          }
        });
      });
    }
  });
}
