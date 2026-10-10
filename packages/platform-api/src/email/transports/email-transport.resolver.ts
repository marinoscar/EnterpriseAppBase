// =============================================================================
// EmailTransportResolver: the settings' `provider`, as a built transport (PP-14.8)
// =============================================================================
//
// The one place that turns "this stored email configuration" into a runnable
// `EmailTransport`: it finds the implementation in the registry, parses that
// transport's own settings, hands `build` a resolver for its declared secrets
// and caches the result until the settings change. The notification channel
// and the admin "Send test email" depend on THIS, never on a concrete SES or
// SMTP class, so a transport an app registered is used by both with no edit to
// either.
//
// PROVIDED ONCE, in `EmailModule`, and exported: a consumer writes
// `imports: [EmailModule]` and injects it. (Overriding a provider token in an
// app module never reached the package consumers; registering a transport does.)
//
// IT NEVER THROWS for a configuration problem. A transport nobody registered,
// settings that no longer parse and a `build` that throws all come back as
// `{ ok: false, error }`, the same shape every other pre-send refusal has, so
// a caller maps them to its own failure result without a try/catch.
// =============================================================================

import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';

import { PluggableSettingsError } from '../../core/index';
import { CredentialsService } from '../../credentials/index';
import { EMAIL_OPTIONS, UNCONFIGURED_EMAIL_OPTIONS, type ResolvedEmailModuleOptions } from '../email.options';
import type { EmailSettings } from '../email-settings.schema';
import { storedTransportSettings } from '../email-settings-compat';
import type { EmailMessage, EmailSendResult } from '../email.types';
import {
  emailTransportKind,
  emailTransportSecretAddress,
  type EmailTransport,
  type EmailTransportDefinition,
} from './email-transport';
// The built-in transports register on import: whatever resolves a transport by id finds them.
import './builtin-email-transports';

/**
 * An email transport ready to send with.
 *
 * @stability experimental
 */
export interface ActiveEmailTransport {
  /** The transport id (`settings.provider`). */
  id: string;
  /** Its human label. */
  label: string;
  /** The built transport. */
  transport: EmailTransport;
}

/**
 * The outcome of {@link EmailTransportResolver.resolve}: the transport, or why there is none.
 *
 * @stability experimental
 */
export type EmailTransportResolution = ({ ok: true } & ActiveEmailTransport) | { ok: false; error: string };

/** Longest error text a resolution failure carries. */
const MAX_ERROR_LENGTH = 500;

function describe(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH)}…` : text;
}

/**
 * Resolves and caches the active email transport. Cheap to call per send: the
 * transport is rebuilt only when its id or settings change (the previous one
 * is `destroy()`ed), and a transport reads its secrets itself, at send time,
 * through `build`'s `secret(name)`, so a rotated secret takes effect on the
 * next send.
 *
 * @stability experimental
 */
@Injectable()
export class EmailTransportResolver implements OnModuleDestroy {
  private readonly logger = new Logger('EmailTransports');
  private readonly options: Pick<ResolvedEmailModuleOptions, 'classifyRateLimit' | 'sesRegionFallback'>;

  /** Transport id to the last transport built for it and the fingerprint of its settings. */
  private readonly cache = new Map<string, { fingerprint: string; transport: EmailTransport }>();

  constructor(
    private readonly credentials: CredentialsService,
    @Optional() @Inject(EMAIL_OPTIONS) options?: Pick<ResolvedEmailModuleOptions, 'classifyRateLimit' | 'sesRegionFallback'>,
  ) {
    this.options = options ?? UNCONFIGURED_EMAIL_OPTIONS;
  }

  /**
   * The transport the settings select.
   *
   * @param settings - the stored email settings (`provider`, `transports`).
   * @returns the built transport, or `{ ok: false, error }` when `provider` is unset or names a transport nobody registered, its stored settings do not parse, or `build` throws.
   */
  async resolve(settings: Pick<EmailSettings, 'provider' | 'transports'>): Promise<EmailTransportResolution> {
    const id = settings.provider;
    if (!id) return { ok: false, error: 'No email provider is configured.' };

    if (!emailTransportKind.has(id)) {
      return {
        ok: false,
        error:
          `Email transport "${id}" is not registered (registered: ${emailTransportKind.ids().join(', ') || '(none)'}). ` +
          'Choose another transport at /admin/settings/email, or register it with registerEmailTransport.',
      };
    }

    const definition = emailTransportKind.get(id) as EmailTransportDefinition<any>;

    let parsed: Record<string, unknown>;
    try {
      parsed = emailTransportKind.parseSettings(id, storedTransportSettings(settings, id));
    } catch (error) {
      if (error instanceof PluggableSettingsError) {
        const fields = [...new Set(error.issues.map((issue) => issue.path.join('.') || '(root)'))].join(', ');
        return { ok: false, error: `The stored settings of email transport "${id}" are invalid at: ${fields}. Save the email configuration again.` };
      }
      return { ok: false, error: describe(error) };
    }

    const fingerprint = createHash('sha256').update(JSON.stringify(parsed)).digest('hex');
    const cached = this.cache.get(id);
    if (cached?.fingerprint === fingerprint) {
      return { ok: true, id, label: definition.label, transport: cached.transport };
    }

    let transport: EmailTransport;
    try {
      transport = await definition.build({
        logger: new Logger(`EmailTransport:${id}`),
        ...(this.options.classifyRateLimit ? { classifyRateLimit: this.options.classifyRateLimit } : {}),
        sesRegionFallback: this.options.sesRegionFallback,
        settings: parsed,
        secret: async (name) => {
          const address = emailTransportSecretAddress(definition, name);
          return this.credentials.getSecret(address.purpose, address.name);
        },
      });
    } catch (error) {
      return { ok: false, error: `Email transport "${id}" could not be built: ${describe(error)}` };
    }

    this.cache.set(id, { fingerprint, transport });
    if (cached) await this.release(id, cached.transport);

    return { ok: true, id, label: definition.label, transport };
  }

  /**
   * Resolves the transport the settings select and sends `message` through it.
   * NEVER THROWS: a transport that cannot be resolved is a failed result.
   *
   * @param settings - the stored email settings.
   * @param message - the finished message.
   */
  async send(settings: Pick<EmailSettings, 'provider' | 'transports'>, message: EmailMessage): Promise<EmailSendResult> {
    const resolved = await this.resolve(settings);
    if (!resolved.ok) return { success: false, error: resolved.error };
    return resolved.transport.send(message);
  }

  /** Releases every cached transport. */
  async onModuleDestroy(): Promise<void> {
    const entries = [...this.cache.entries()];
    this.cache.clear();
    await Promise.all(entries.map(([id, entry]) => this.release(id, entry.transport)));
  }

  private async release(id: string, transport: EmailTransport): Promise<void> {
    try {
      await transport.destroy?.();
    } catch (error) {
      this.logger.warn(`Email transport "${id}" failed to release its resources: ${describe(error)}`);
    }
  }
}
