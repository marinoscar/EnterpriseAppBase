// =============================================================================
// WebhooksModule.forRoot() options (issue #1046)
// =============================================================================
//
// CODE OPTIONS, not environment variables or system settings: a retry ceiling
// or an endpoint limit is a product decision an app makes once. Nothing here
// holds a secret; signing secrets live in the encrypted credentials store.
// =============================================================================

import type { ModuleMetadata } from '@nestjs/common';

import type { HostResolver } from './egress/egress-guard';
import type { WebhookTransport } from './egress/transport';
import { WEBHOOK_DEFAULTS } from './webhooks.constants';

/**
 * Injection token of the resolved {@link WebhooksModuleOptions}.
 *
 * @stability experimental
 */
export const WEBHOOKS_OPTIONS: unique symbol = Symbol.for('@marinoscar/platform/webhooks/OPTIONS');

/**
 * Options of `WebhooksModule.forRoot()`; every field is optional.
 *
 * @stability experimental
 */
export interface WebhooksModuleOptions {
  /** The product name in the `User-Agent` (`<name>-Webhooks/1.0`); a function is read per request. Default `App`. */
  appName?: string | (() => string);
  /** Allow `http:` targets. Development only. Default `false`. */
  allowInsecureHttp?: boolean;
  /** Allow private, loopback and link-local targets and ports below 1024. On-premises and development only. Default `false`. */
  allowPrivateTargets?: boolean;
  /** Host names exempt from the private-address check (an internal receiver an operator vouches for). Default none. */
  allowedHosts?: readonly string[];
  /** Consecutive failed deliveries that switch an endpoint off. Default 20. */
  circuitBreakerThreshold?: number;
  /** Hours the previous secret keeps signing after a rotation. Default 24. */
  rotationOverlapHours?: number;
  /** Days a delivery row is kept. Default 30. */
  deliveryRetentionDays?: number;
  /** The most endpoints one owner may have, per scope. Defaults 20 user, 50 org, 50 system. */
  limits?: {
    /** The most endpoints one member may own. */
    user?: number;
    /** The most endpoints one organization may have. */
    org?: number;
    /** The most endpoints the deployment may have. */
    system?: number;
  };
  /** The deadline of one delivery request, in milliseconds. Default 10000. */
  requestTimeoutMs?: number;
  /** Attempts before a delivery is `dead`. Default 10. */
  maxDeliveryAttempts?: number;
  /** The slice's cron tasks. */
  tasks?: {
    /** Register the daily retention purge cron. Default `true`. */
    purge?: boolean;
  };
  /** Replace the HTTP transport (tests, a proxy). Default: Node's `http(s).request` to the pinned address. */
  transport?: WebhookTransport;
  /** Replace the DNS resolver (tests). Default: the operating system's. */
  resolver?: HostResolver;
  /** Modules imported next to the slice: the app's host module binding `WEBHOOKS_SYSTEM_PRISMA`. */
  imports?: ModuleMetadata['imports'];
}

/**
 * {@link WebhooksModuleOptions} with every default applied.
 *
 * @stability experimental
 */
export interface ResolvedWebhooksModuleOptions {
  /** Reads the product name. */
  readonly appName: () => string;
  /** See the option. */
  readonly allowInsecureHttp: boolean;
  /** See the option. */
  readonly allowPrivateTargets: boolean;
  /** See the option. */
  readonly allowedHosts: readonly string[];
  /** See the option. */
  readonly circuitBreakerThreshold: number;
  /** See the option. */
  readonly rotationOverlapHours: number;
  /** See the option. */
  readonly deliveryRetentionDays: number;
  /** See the option. */
  readonly limits: {
    /** The most endpoints one member may own. */
    readonly user: number;
    /** The most endpoints one organization may have. */
    readonly org: number;
    /** The most endpoints the deployment may have. */
    readonly system: number;
  };
  /** See the option. */
  readonly requestTimeoutMs: number;
  /** See the option. */
  readonly maxDeliveryAttempts: number;
  /** See the option. */
  readonly tasks: {
    /** Whether the daily purge cron is registered. */
    readonly purge: boolean;
  };
  /** The transport override, when given. */
  readonly transport: WebhookTransport | undefined;
  /** The resolver override, when given. */
  readonly resolver: HostResolver | undefined;
  /** The modules imported next to the slice. */
  readonly imports: NonNullable<ModuleMetadata['imports']>;
}

function positiveInt(name: string, value: number | undefined): void {
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`WebhooksModule.forRoot(): ${name} must be a positive integer (got ${String(value)})`);
  }
}

/**
 * The product token of a `User-Agent`: letters, digits and `-`.
 *
 * @param name - the application name.
 * @returns the token, `App` when nothing survives.
 *
 * @stability experimental
 */
export function userAgentToken(name: string): string {
  const token = name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return token || 'App';
}

/**
 * Validates `options` and applies the defaults.
 *
 * @param options - what the app passed.
 * @returns the resolved options (frozen).
 * @throws Error when a number is not a positive integer.
 *
 * @stability experimental
 */
export function resolveWebhooksModuleOptions(options: WebhooksModuleOptions = {}): ResolvedWebhooksModuleOptions {
  positiveInt('circuitBreakerThreshold', options.circuitBreakerThreshold);
  positiveInt('rotationOverlapHours', options.rotationOverlapHours);
  positiveInt('deliveryRetentionDays', options.deliveryRetentionDays);
  positiveInt('requestTimeoutMs', options.requestTimeoutMs);
  positiveInt('maxDeliveryAttempts', options.maxDeliveryAttempts);
  positiveInt('limits.user', options.limits?.user);
  positiveInt('limits.org', options.limits?.org);
  positiveInt('limits.system', options.limits?.system);
  const name = options.appName;
  return Object.freeze({
    appName: typeof name === 'function' ? () => userAgentToken(name()) : () => userAgentToken(name ?? 'App'),
    allowInsecureHttp: options.allowInsecureHttp ?? false,
    allowPrivateTargets: options.allowPrivateTargets ?? false,
    allowedHosts: Object.freeze([...(options.allowedHosts ?? [])]),
    circuitBreakerThreshold: options.circuitBreakerThreshold ?? WEBHOOK_DEFAULTS.circuitBreakerThreshold,
    rotationOverlapHours: options.rotationOverlapHours ?? WEBHOOK_DEFAULTS.rotationOverlapHours,
    deliveryRetentionDays: options.deliveryRetentionDays ?? WEBHOOK_DEFAULTS.deliveryRetentionDays,
    limits: Object.freeze({
      user: options.limits?.user ?? WEBHOOK_DEFAULTS.limits.user,
      org: options.limits?.org ?? WEBHOOK_DEFAULTS.limits.org,
      system: options.limits?.system ?? WEBHOOK_DEFAULTS.limits.system,
    }),
    requestTimeoutMs: options.requestTimeoutMs ?? WEBHOOK_DEFAULTS.requestTimeoutMs,
    maxDeliveryAttempts: options.maxDeliveryAttempts ?? WEBHOOK_DEFAULTS.maxDeliveryAttempts,
    tasks: Object.freeze({ purge: options.tasks?.purge ?? true }),
    transport: options.transport,
    resolver: options.resolver,
    imports: [...(options.imports ?? [])],
  });
}
