// =============================================================================
// Email transports: the `email-transport` pluggable kind (PP-14.8)
// =============================================================================
//
// A transport is the part of the email slice that knows ONE way of putting a
// rendered message on the network: Amazon SES, an SMTP relay, a hosted API
// (SendGrid, Postmark), a file or a log for local development. The slice itself
// (the notification channel, the admin "Send test email") only ever talks to an
// `EmailTransport`; which one was built, with which settings and secrets, is
// runtime configuration an administrator edits at /admin/settings/email.
//
//   definition   id + label + settingsSchema + defaults + secrets   (what a form needs)
//   operations   build() -> EmailTransport { send, verify?, destroy? }
//
// `ses` and `smtp` register through `registerEmailTransport` exactly as an
// app's transport does (`./builtin-email-transports.ts`): no private fast path.
//
// FRAMEWORK-LIGHT, AND A LEAF: this file imports the pluggable-kind primitive,
// the credential purpose registry and types. The settings service, the Doctor
// and the template import it without pulling an SDK in; the built-ins' SDK
// imports live in their own files.
// =============================================================================

import type { Logger } from '@nestjs/common';
import { EMAIL_TRANSPORT_ID_PATTERN } from '@marinoscar/platform-contract/email';
import type { PluggableDescriptor } from '@marinoscar/platform-contract/settings';

import {
  definePluggableKind,
  type PluggableBuildInput,
  type PluggableImplementation,
  type PluggableKind,
  type PluggableSecretPresence,
} from '../../core/index';
import { credentialPurposeRegistry, registerCredentialPurpose } from '../../credentials/index';
import type { GenericRateLimitClassifier } from '../email-rate-limit';
import type { EmailProvider } from '../providers/email-provider.interface';

/**
 * A transport's non-secret settings, as its `settingsSchema` parses them.
 *
 * @stability experimental
 */
export type EmailTransportSettings = Record<string, unknown>;

/**
 * A built transport: the thing the slice calls to put one message on the
 * network.
 *
 * `send` is the existing {@link EmailProvider} contract: it NEVER throws, every
 * failure is `{ success: false, error }`, and a throttle is classified
 * (`rateLimited`, `retryAfterMs`). Extend `BaseEmailProvider` to inherit all
 * of that instead of re-implementing it: it implements `send` once around your
 * `deliver`, redacts the secrets you register with `redact.protect(...)` and
 * caps the error length.
 *
 * @example
 * ```ts
 * class SendgridTransport extends BaseEmailProvider {
 *   protected readonly logger = new Logger('SendgridTransport');
 *   protected readonly transportName = 'SendGrid';
 *   protected async deliver(msg: EmailMessage, redact: SecretRedactor) { ... }
 * }
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export interface EmailTransport extends EmailProvider {
  /**
   * An optional pre-flight: can this transport send with the configuration it
   * was built with (credentials accepted, host reachable)? Called by the admin
   * "Send test email" before it sends, never by the Doctor (the Doctor never
   * touches the network). NEVER THROWS: `{ ok: false, message }` on failure.
   * The message is shown to an administrator, so it must carry no secret.
   */
  verify?(): Promise<{ ok: boolean; message: string }>;
  /**
   * Releases what the transport holds (a connection pool, a client). Called
   * when the settings change and the transport is replaced. Optional.
   */
  destroy?(): void | Promise<void>;
}

/**
 * What the slice passes to `build` besides the transport's own settings and
 * secrets.
 *
 * @stability experimental
 */
export interface EmailTransportBuildContext {
  /** A logger scoped to the email slice. Never log a secret or a recipient list through it. */
  logger: Logger;
  /**
   * The generic HTTP / SDK rate-limit classifier the app gave
   * `EmailModule.forRoot({ classifyRateLimit })`, or `undefined`. Hand it to
   * `BaseEmailProvider.rateLimitClassifier` so a throttle from your API reads
   * as one.
   */
  classifyRateLimit?: GenericRateLimitClassifier;
  /** The SES region the app named as a fallback (`EmailModule.forRoot({ sesRegionFallback })`). Only the `ses` transport reads it. */
  sesRegionFallback?: () => string | undefined;
}

/**
 * The argument of `build`: the context, the transport's settings (parsed with
 * its `settingsSchema`, defaults filled) and a resolver for its declared
 * secrets.
 *
 * `secret(name)` resolves one of the transport's DECLARED secrets and returns
 * `null` when none is stored. Hold the value only for the call; ask again for
 * the next send, so a rotation takes effect without a restart.
 *
 * @typeParam S - the transport's parsed settings.
 *
 * @stability experimental
 */
export type EmailTransportBuildInput<S extends EmailTransportSettings = EmailTransportSettings> = PluggableBuildInput<
  EmailTransportBuildContext,
  S
>;

/**
 * Where one of a transport's secrets lives in the credential store.
 *
 * @stability experimental
 */
export interface EmailTransportSecretAddress {
  /** The credential purpose (permanent once rows exist). */
  purpose: string;
  /** The name within the purpose. */
  name: string;
  /** The non-secret label stored beside the credential (default: the secret's declared label). */
  label?: string;
}

/**
 * Extra context for {@link EmailTransportDefinition.egressHosts}.
 *
 * @stability experimental
 */
export interface EmailTransportEgressOptions {
  /** The SES region fallback the app configured, if any. */
  sesRegionFallback?: () => string | undefined;
}

/**
 * What an app or package registers with {@link registerEmailTransport}: a
 * pluggable implementation (id, label, settings schema, defaults, secrets,
 * `build`) plus the optional hooks the Doctor and the credential store use.
 *
 * @typeParam S - the transport's parsed settings.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export interface EmailTransportDefinition<S extends EmailTransportSettings = EmailTransportSettings>
  extends PluggableImplementation<EmailTransport, EmailTransportBuildContext, S> {
  /**
   * Where the transport's secrets live when it must not use `email_<id>` (the
   * built-ins keep the SMTP password at `(smtp, default)` and the SES secret
   * access key at `(email_ses, default)`). The purpose is then the caller's to
   * register.
   */
  credentialAddress?(secretName: string): EmailTransportSecretAddress;
  /**
   * The names of the settings and secrets this configuration still needs,
   * `[]` when complete: the Doctor reports them and the admin sees them.
   * `secrets` says which of the declared secrets are stored. Default: every
   * `required` declared secret that is absent. Pure: no I/O; names, never values.
   */
  missing?(settings: S, secrets: Readonly<Record<string, boolean>>): string[];
  /** One phrase the Doctor shows for a complete configuration (`SMTP via smtp.example.com:587`). Default: the label. */
  summary?(settings: S): string;
  /** The capability the network-egress view names (`Email (SMTP relay)`). Default: `Email (<label>)`. */
  egressCapability?: string;
  /** The hosts a transport with these settings calls, for the Doctor's network-egress view. Empty for a local transport. */
  egressHosts?(settings: S, options?: EmailTransportEgressOptions): readonly string[];
}

/**
 * The `email-transport` pluggable kind. Its implementations are the
 * {@link EmailTransportDefinition}s themselves. Use
 * {@link registerEmailTransport} and the helpers below rather than the kind
 * directly.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const emailTransportKind: PluggableKind<EmailTransport, EmailTransportBuildContext> = definePluggableKind<
  EmailTransport,
  EmailTransportBuildContext
>({
  kind: 'email-transport',
  label: 'Email transport',
});

/** Setting names that look like a secret: a secret is declared in `secrets`, never a setting. */
const SECRET_LOOKING_FIELDS: ReadonlySet<string> = new Set(
  [
    'secretAccessKey',
    'secretKey',
    'sessionToken',
    'secret',
    'password',
    'smtpPassword',
    'apiKey',
    'apiKeys',
    'key',
    'token',
    'privateKey',
  ].map((name) => name.toLowerCase()),
);

/**
 * The credential purpose a transport's secrets use by default (`email_<id>`).
 *
 * @param id - the transport id.
 * @stability experimental
 */
export function emailTransportCredentialPurpose(id: string): string {
  return `email_${id}`;
}

function assertValidDefinition(def: EmailTransportDefinition<any>): void {
  const where = `Email transport "${def.id}"`;

  if (typeof def.id !== 'string' || !EMAIL_TRANSPORT_ID_PATTERN.test(def.id)) {
    throw new Error(`Invalid email transport id ${JSON.stringify(def.id)}: it must match ${EMAIL_TRANSPORT_ID_PATTERN}.`);
  }
  if (typeof def.label !== 'string' || def.label.trim() === '') throw new Error(`${where}: label must be a non-empty string.`);
  if (typeof def.build !== 'function') throw new Error(`${where}: build must be a function.`);
  for (const hook of ['credentialAddress', 'missing', 'summary', 'egressHosts'] as const) {
    if (def[hook] !== undefined && typeof def[hook] !== 'function') throw new Error(`${where}: ${hook} must be a function.`);
  }
  if (typeof def.settingsSchema !== 'object' || def.settingsSchema === null || typeof def.settingsSchema.shape !== 'object') {
    throw new Error(`${where}: settingsSchema must be a z.object(...).`);
  }
  for (const field of Object.keys(def.settingsSchema.shape)) {
    if (SECRET_LOOKING_FIELDS.has(field.toLowerCase())) {
      throw new Error(
        `${where}: settingsSchema declares "${field}", which looks like a secret. A secret is never a setting: ` +
          'declare it in `secrets`; it is stored encrypted in the credential store.',
      );
    }
  }
  const parsedDefaults = def.settingsSchema.safeParse(def.defaults);
  if (!parsedDefaults.success) {
    throw new Error(
      `${where}: defaults do not parse with settingsSchema: ` +
        parsedDefaults.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; '),
    );
  }
}

/**
 * Registers an email transport. Call it at import time, before the
 * application bootstraps (the reference app does it from
 * `apps/api/src/app-registrations/email.ts`, which `platform/email/email.config.ts`
 * imports first). `ses` and `smtp` register through this same function.
 *
 * Registering is all it takes: `GET /api/email-settings` describes the
 * transport (`descriptors`, and a generated form on the admin page), its
 * settings are stored under `transports.<id>` and validated by its
 * `settingsSchema`, its secrets get a credential purpose (`email_<id>`) unless
 * `credentialAddress` names one, and once an administrator selects it every
 * email the application sends (notifications, broadcasts, the admin test)
 * goes through the transport it builds.
 *
 * @param def - the transport.
 * @throws Error when the definition is malformed (an id that does not match the pattern, a secret-looking settings field, defaults that do not parse, a missing `build`).
 * @throws RegistryError `DUPLICATE_ID` when the id is registered, `FROZEN` after the application bootstrapped.
 *
 * @example
 * ```ts
 * registerEmailTransport({
 *   id: 'sendgrid',
 *   label: 'SendGrid',
 *   settingsSchema: z.object({ apiBase: z.string().describe('API base URL') }),
 *   defaults: { apiBase: 'https://api.sendgrid.com' },
 *   secrets: [{ name: 'apiKey', label: 'API key', required: true }],
 *   build: ({ settings, secret, logger, classifyRateLimit }) =>
 *     new SendgridTransport(settings.apiBase, () => secret('apiKey'), logger, classifyRateLimit),
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerEmailTransport<S extends EmailTransportSettings>(def: EmailTransportDefinition<S>): void {
  assertValidDefinition(def);

  const purpose = emailTransportCredentialPurpose(def.id);
  const ownsPurpose = (def.secrets ?? []).length > 0 && def.credentialAddress === undefined;
  if (ownsPurpose && credentialPurposeRegistry.has(purpose)) {
    throw new Error(`Email transport "${def.id}": the credential purpose "${purpose}" is already registered by another owner. Pick another transport id.`);
  }

  // The definition itself is the registered implementation, so the hooks
  // (`missing`, `summary`, ...) travel with it.
  emailTransportKind.register(def);

  if (ownsPurpose) {
    registerCredentialPurpose({ purpose, owner: 'email', label: `${def.label} secrets`, tiers: ['system'] });
  }
}

/**
 * Every registered email transport, in registration order (the built-ins
 * first; the order the admin page lists them).
 *
 * @stability experimental
 */
export function emailTransportDefinitions(): readonly EmailTransportDefinition<any>[] {
  return emailTransportKind.list() as readonly EmailTransportDefinition<any>[];
}

/**
 * The ids of every registered email transport, in registration order.
 *
 * @stability experimental
 */
export function emailTransportIds(): string[] {
  return emailTransportKind.ids();
}

/**
 * The transport registered under `id`, or `undefined`.
 *
 * @param id - the transport id.
 * @stability experimental
 */
export function getEmailTransport(id: string): EmailTransportDefinition<any> | undefined {
  return emailTransportKind.has(id) ? (emailTransportKind.get(id) as EmailTransportDefinition<any>) : undefined;
}

/**
 * The transport registered under `id`.
 *
 * @param id - the transport id.
 * @throws PluggableUnknownError when none is registered; the message names the registered ids.
 * @stability experimental
 */
export function requireEmailTransport(id: string): EmailTransportDefinition<any> {
  return emailTransportKind.get(id) as EmailTransportDefinition<any>;
}

/** The labels of the shipped transports, for a caller that renders before they register (a template test). */
const BUILTIN_LABELS: Readonly<Record<string, string>> = { ses: 'Amazon SES', smtp: 'SMTP' };

/**
 * The human label of a transport: its registered label, else the shipped
 * label of a built-in, else the id itself. What the Doctor, the egress view and
 * the test email name it by.
 *
 * @param id - the transport id.
 * @stability experimental
 */
export function labelOfEmailTransport(id: string): string {
  return getEmailTransport(id)?.label ?? BUILTIN_LABELS[id] ?? id;
}

/**
 * Where `transport`'s secret `name` lives in the credential store.
 *
 * @param transport - a registered transport.
 * @param name - one of the secrets it declares.
 * @returns the `(purpose, name)` address.
 * @stability experimental
 */
export function emailTransportSecretAddress(
  transport: Pick<EmailTransportDefinition<any>, 'id' | 'credentialAddress' | 'secrets'>,
  name: string,
): Required<EmailTransportSecretAddress> {
  const label = transport.secrets?.find((spec) => spec.name === name)?.label ?? name;
  if (transport.credentialAddress) {
    const address = transport.credentialAddress(name);
    return { purpose: address.purpose, name: address.name, label: address.label ?? label };
  }
  return { purpose: emailTransportCredentialPurpose(transport.id), name, label };
}

/**
 * The descriptor of every registered transport for a generated form: its
 * non-secret fields, then one write-only `secret` field per declared secret
 * carrying only whether a value is stored.
 *
 * @param presence - which of a transport's secrets are stored.
 * @stability experimental
 */
export function describeEmailTransports(presence: (id: string) => PluggableSecretPresence): PluggableDescriptor[] {
  return emailTransportKind.describeAll(presence);
}

/**
 * The names of a transport's still-missing settings and secrets
 * ({@link EmailTransportDefinition.missing}, or every required secret that is absent).
 *
 * @param transport - a registered transport.
 * @param settings - its parsed settings.
 * @param present - which of its declared secrets are stored.
 * @stability experimental
 */
export function missingEmailTransportFields(
  transport: EmailTransportDefinition<any>,
  settings: EmailTransportSettings,
  present: Readonly<Record<string, boolean>>,
): string[] {
  if (transport.missing) return transport.missing(settings, present);
  return (transport.secrets ?? []).filter((secret) => secret.required && present[secret.name] !== true).map((secret) => secret.label);
}
