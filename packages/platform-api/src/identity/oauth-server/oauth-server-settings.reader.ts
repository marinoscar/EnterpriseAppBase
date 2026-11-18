import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { IDENTITY_OAUTH_SETTINGS, type IdentityOAuthSettings } from '../ports';
import { OAUTH_SERVER_SETTINGS_DEFAULTS, type OAuthServerSettingsValue } from './oauth-server-settings.schemas';

/**
 * How long a read of the `oauthServer` settings is reused. The guard calls
 * the reader on every `oat_` request; a query per request would put the
 * settings table on the authentication path, so the answer is cached, at the
 * price of a switch taking up to this long to reach a replica.
 *
 * @stability experimental
 */
export const OAUTH_SETTINGS_CACHE_MS = 5000;

/**
 * The OAuth server's settings, cached for {@link OAUTH_SETTINGS_CACHE_MS}.
 * Without the settings slice (no `IDENTITY_OAUTH_SETTINGS` binding) or when a
 * read fails with nothing cached, the server reads as DISABLED: failing
 * closed means an `oat_` token is a `401`, never a silently open server.
 *
 * @stability experimental
 */
@Injectable()
export class OAuthServerSettingsReader {
  private readonly logger = new Logger(OAuthServerSettingsReader.name);
  private cached: { value: OAuthServerSettingsValue; at: number } | null = null;
  private inflight: Promise<OAuthServerSettingsValue> | null = null;

  constructor(@Optional() @Inject(IDENTITY_OAUTH_SETTINGS) private readonly source?: IdentityOAuthSettings) {}

  /** The current settings (cached). Never throws. */
  async read(): Promise<OAuthServerSettingsValue> {
    if (!this.source) return OAUTH_SERVER_SETTINGS_DEFAULTS;
    const now = Date.now();
    if (this.cached && now - this.cached.at < OAUTH_SETTINGS_CACHE_MS) return this.cached.value;
    // One read at a time: a burst of requests after expiry shares it.
    this.inflight ??= this.source
      .read()
      .then((value) => {
        this.cached = { value, at: Date.now() };
        return value;
      })
      .catch((error: unknown) => {
        this.logger.warn(`Could not read the oauthServer settings: ${error instanceof Error ? error.message : 'unknown error'}`);
        // Keep serving the last known value for another interval; none known: disabled.
        const value = this.cached?.value ?? OAUTH_SERVER_SETTINGS_DEFAULTS;
        this.cached = { value, at: Date.now() };
        return value;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  /** Whether the server is switched on. */
  async isEnabled(): Promise<boolean> {
    return (await this.read()).enabled === true;
  }

  /** Forgets the cached value (a test, or a settings write on this replica). */
  invalidate(): void {
    this.cached = null;
  }
}
