// =============================================================================
// The email render context (issue #737, PP-8.4)
// =============================================================================
//
// What every template renders with besides its data: the product name (in
// subjects, the wordmark and the footer), the deployment's base URL and the
// resolved layout. Until #737 the name was `APP_NAME`, imported from the
// reference app's shared identity package; a package cannot import that, so
// the app passes it to `EmailModule.forRoot({ appName })`.
//
// ONE CONTEXT PER PROCESS, configured by `forRoot` (or, for a manifest that
// renders or registers before Nest composes its modules, by
// `configureEmailRendering` with the same options). A template receives it
// as its second argument; when a caller omits it (a direct call, the
// notification channel's untyped lookup), the configured one is used.
// Rendering before anything configured it throws, naming the fix: a message
// that says "undefined" where the product name belongs is worse than none.
//
// FRAMEWORK-FREE.
// =============================================================================

import { resolveEmailLayout, type EmailLayoutOptions, type ResolvedEmailLayout } from './layout-theme';

/**
 * What a template renders with besides its data.
 *
 * @stability experimental
 */
export interface EmailRenderContext {
  /** The product name, in subjects, the wordmark and the footer. */
  readonly appName: string;
  /** The deployment's base URL (no trailing slash), or `null` when unknown. Platform templates take their links from their data. */
  readonly appUrl: string | null;
  /** The resolved layout: theme, brand mark, footer. */
  readonly layout: ResolvedEmailLayout;
}

/**
 * The rendering half of `EmailModuleOptions`.
 *
 * @stability experimental
 */
export interface EmailRenderingOptions {
  /** The product name. Required: core exposes no product-identity token. */
  appName: string;
  /** The deployment's base URL, or a function read at render time. Default: none. */
  appUrl?: string | (() => string | undefined);
  /** The layout theme, brand mark and footer. Default: the platform layout. */
  layout?: EmailLayoutOptions;
}

interface Configured {
  readonly appName: string;
  readonly appUrl: () => string | undefined;
  readonly layout: ResolvedEmailLayout;
}

let configured: Configured | null = null;

function normalizeAppUrl(url: string | undefined): string | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim().replace(/\/+$/, '');
  return trimmed === '' ? null : trimmed;
}

/**
 * Builds a render context from options without configuring anything: for a
 * test, or a caller that renders one message with a different theme.
 *
 * @param options - the product name, base URL and layout.
 * @returns the context.
 * @throws Error when `appName` is empty or the layout is invalid.
 *
 * @stability experimental
 */
export function createEmailRenderContext(options: EmailRenderingOptions): EmailRenderContext {
  const appName = typeof options.appName === 'string' ? options.appName.trim() : '';
  if (appName === '') {
    throw new Error('Email rendering needs a product name: pass { appName } to EmailModule.forRoot().');
  }
  const appUrl = typeof options.appUrl === 'function' ? options.appUrl() : options.appUrl;
  return Object.freeze({ appName, appUrl: normalizeAppUrl(appUrl), layout: resolveEmailLayout(options.layout) });
}

/**
 * Configures the process-wide render context. `EmailModule.forRoot` calls
 * it; call it directly only where templates render before the Nest module
 * graph is composed (a notification manifest, a seed, a test), with the same
 * options. The last call wins.
 *
 * @param options - the product name, base URL and layout.
 * @returns the context now in effect.
 * @throws Error when `appName` is empty or the layout is invalid.
 *
 * @extensionPoint option
 * @stability experimental
 */
export function configureEmailRendering(options: EmailRenderingOptions): EmailRenderContext {
  const context = createEmailRenderContext(options);
  const appUrl = options.appUrl;
  configured = Object.freeze({
    appName: context.appName,
    appUrl: typeof appUrl === 'function' ? appUrl : () => appUrl,
    layout: context.layout,
  });
  return context;
}

/**
 * Whether the render context has been configured.
 *
 * @returns `true` after `EmailModule.forRoot` or `configureEmailRendering`.
 *
 * @stability experimental
 */
export function isEmailRenderingConfigured(): boolean {
  return configured !== null;
}

/**
 * The configured render context (its `appUrl` read now).
 *
 * @returns the context.
 * @throws Error when nothing configured it yet.
 *
 * @stability experimental
 */
export function currentEmailRenderContext(): EmailRenderContext {
  if (!configured) {
    throw new Error(
      'Email rendering is not configured: call EmailModule.forRoot({ appName }) (or configureEmailRendering) ' +
        'before rendering an email template.',
    );
  }
  return Object.freeze({ appName: configured.appName, appUrl: normalizeAppUrl(configured.appUrl()), layout: configured.layout });
}

/**
 * The context a template renders with: the one it was given, or the
 * configured one.
 *
 * @param ctx - the context passed to the template, if any.
 * @returns the context to use.
 * @throws Error when `ctx` is omitted and nothing is configured.
 *
 * @stability experimental
 */
export function resolveEmailRenderContext(ctx?: EmailRenderContext): EmailRenderContext {
  return ctx ?? currentEmailRenderContext();
}
