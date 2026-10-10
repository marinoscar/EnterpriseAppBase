// =============================================================================
// AboutModule options (issue #891)
// =============================================================================
//
// The report is the platform's, but one fact in it is the APP's: the version of
// the API the process is running. The platform cannot find it (walking up from
// this package would find the package's own `package.json`, never the app's),
// so the app hands it a resolver, exactly as it hands `createOpenApiDocument`
// its `version`.
// =============================================================================

/**
 * What {@link AboutModule.forRoot} takes from the app.
 *
 * @example
 * ```ts
 * // apps/api/src/platform/about.config.ts
 * export const aboutModule = AboutModule.forRoot({ apiVersion: resolveApiVersion });
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface AboutModuleOptions {
  /**
   * The API's own version, as the app resolves it (`resolveApiVersion(__dirname)`
   * of the host slice, called from a directory inside the APP). Called per
   * request and must never throw.
   */
  apiVersion: () => string;
}

/** The resolved options, as injected. */
export type ResolvedAboutOptions = Readonly<AboutModuleOptions>;

/** Injection token for the resolved {@link AboutModuleOptions}. */
export const ABOUT_OPTIONS = Symbol('ABOUT_OPTIONS');
