// =============================================================================
// EmailModule options (issue #737, PP-8.4)
// =============================================================================
//
// Every tunable of the email slice, as a `forRoot()` option. NONE IS AN
// ENVIRONMENT VARIABLE: which transport, the SMTP relay, the SES identity and
// the sender are configured at runtime on `/admin/settings/email` (the `email`
// row of `system_settings` plus the credential store). What is here is what
// the APP knows at composition time: its product name, its URL, its look, and
// the queue's rate-limit classifier.
// =============================================================================

import type { GenericRateLimitClassifier } from './email-rate-limit';
import type { EmailLayoutOptions } from './templates/layout-theme';

/**
 * Options of `EmailModule.forRoot`.
 *
 * @stability experimental
 */
export interface EmailModuleOptions {
  /**
   * The product name, in subjects, the wordmark and the footer. Required:
   * core exposes no product-identity token (the reference app passes
   * `APP_NAME` from its shared identity).
   */
  appName: string;
  /**
   * The deployment's base URL (the test email's "Open email settings" link,
   * `EmailRenderContext.appUrl`), or a function read when it is needed.
   * Default: none (the link is omitted).
   */
  appUrl?: string | (() => string | undefined);
  /** The layout theme, inline brand mark and footer. Default: the platform layout. */
  layout?: EmailLayoutOptions;
  /** Register the nine platform templates (idempotent). Default `true`. */
  registerDefaultTemplates?: boolean;
  /**
   * The generic HTTP / SDK rate-limit classifier email layers its SMTP and SES
   * rules over. Default: none (only the email-specific rules apply). The
   * reference app passes the job queue's `classifyRateLimit`.
   */
  classifyRateLimit?: GenericRateLimitClassifier;
  /**
   * The SES region used when the settings name none, read at send time.
   * Default: none (an SES send without a region fails, naming the setting).
   * The reference app reads its existing `SES_REGION` deployment variable.
   */
  sesRegionFallback?: () => string | undefined;
}

/**
 * The options with every default filled in.
 *
 * @stability experimental
 */
export interface ResolvedEmailModuleOptions {
  /** The product name. */
  readonly appName: string;
  /** The base URL, read now. */
  readonly appUrl: () => string | undefined;
  /** The layout option, as given. */
  readonly layout: EmailLayoutOptions | undefined;
  /** Whether the platform templates were registered. */
  readonly registerDefaultTemplates: boolean;
  /** The generic classifier, or `undefined`. */
  readonly classifyRateLimit: GenericRateLimitClassifier | undefined;
  /** The SES region fallback, read now. */
  readonly sesRegionFallback: () => string | undefined;
}

/**
 * Injection token of the {@link ResolvedEmailModuleOptions}. `Symbol.for`, so
 * two copies of this file agree.
 *
 * @stability experimental
 */
export const EMAIL_OPTIONS: unique symbol = Symbol.for('@marinoscar/platform/email/OPTIONS');

/**
 * Fills in the defaults and checks the options.
 *
 * @param options - the `forRoot` options.
 * @returns the resolved options (frozen).
 * @throws Error when `appName` is missing or a function option is not one.
 *
 * @stability experimental
 */
export function resolveEmailModuleOptions(options: EmailModuleOptions): ResolvedEmailModuleOptions {
  if (!options || typeof options.appName !== 'string' || options.appName.trim() === '') {
    throw new Error('EmailModule.forRoot: { appName } is required (the product name in subjects and footers).');
  }
  for (const key of ['classifyRateLimit', 'sesRegionFallback'] as const) {
    if (options[key] !== undefined && typeof options[key] !== 'function') {
      throw new Error(`EmailModule.forRoot: ${key} must be a function.`);
    }
  }
  const appUrl = options.appUrl;
  return Object.freeze({
    appName: options.appName.trim(),
    appUrl: typeof appUrl === 'function' ? appUrl : () => appUrl,
    layout: options.layout,
    registerDefaultTemplates: options.registerDefaultTemplates ?? true,
    classifyRateLimit: options.classifyRateLimit,
    sesRegionFallback: options.sesRegionFallback ?? (() => undefined),
  });
}

/**
 * Options of a module built without `forRoot` (a unit test constructing a
 * provider by hand): no classifier, no SES fallback, no URL.
 *
 * @internal
 */
export const UNCONFIGURED_EMAIL_OPTIONS: Pick<
  ResolvedEmailModuleOptions,
  'appUrl' | 'classifyRateLimit' | 'sesRegionFallback'
> = Object.freeze({
  appUrl: () => undefined,
  classifyRateLimit: undefined,
  sesRegionFallback: () => undefined,
});
