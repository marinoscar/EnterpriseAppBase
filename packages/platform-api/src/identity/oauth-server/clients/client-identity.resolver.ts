// =============================================================================
// The client resolver with client identity and the trust policy (PP-15.5)
// =============================================================================
//
// Implements the `ClientResolver` seam of PP-15.4:
//
//   - `resolveForAuthorization` (at `/authorize`; a person is waiting) answers
//     a metadata-document URL by fetching (or reusing) its document, and any
//     other id from the stored row; then the trust policy decides.
//   - `resolveStored` (at `/token` and `/revoke`) NEVER makes an outbound call:
//     it reads the row. The token service applies the trust policy to it.
//
// A host the policy refuses is refused BEFORE any fetch: the server does not
// make an outbound request on behalf of a host an administrator has not allowed.
// =============================================================================

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { PLATFORM_PRISMA } from '../../../core/index';
import type { IdentityOAuthClientRow, IdentityPrisma } from '../../data/identity-db';
import { IDENTITY_METRICS, NOOP_IDENTITY_METRICS, type IdentityMetrics } from '../../ports';
import { toClientRecord, type ClientRefused, type ClientResolution, type ClientResolver, type OAuthClientRecord } from '../client-resolver';
import { OAuthServerSettingsReader } from '../oauth-server-settings.reader';
import { registeredRedirectUris } from '../redirect-uri';
import { CimdError, CimdFetcher, parseCimdClientId } from './cimd.fetcher';
import { ClientRefusalRecorder } from './client-refusal.recorder';
import { ClientTrustPolicy, isHostAdmitted } from './client-trust.policy';

/**
 * The default resolver of the OAuth server: stored rows, metadata documents and
 * the trust policy.
 *
 * @stability experimental
 */
@Injectable()
export class ClientIdentityResolver implements ClientResolver {
  private readonly logger = new Logger(ClientIdentityResolver.name);

  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: IdentityPrisma,
    private readonly settings: OAuthServerSettingsReader,
    private readonly fetcher: CimdFetcher,
    private readonly trust: ClientTrustPolicy,
    private readonly refusals: ClientRefusalRecorder,
    @Optional() @Inject(IDENTITY_METRICS) private readonly metrics: IdentityMetrics = NOOP_IDENTITY_METRICS,
  ) {}

  /** @inheritdoc */
  async resolveForAuthorization(clientId: string): Promise<ClientResolution> {
    const url = parseCimdClientId(clientId);
    const row = url ? await this.resolveMetadataDocument(clientId, url) : await this.prisma.oAuthClient.findUnique({ where: { clientId } });
    if (row === 'refused' || row === 'unavailable') return this.refusedOrUnavailable(row, url);
    if (!row || row.disabledAt !== null) return { ok: false, code: 'unknown_client' };
    if (url && row.kind !== 'cimd') return { ok: false, code: 'unknown_client' };

    const record = toClientRecord(row);
    const verdict = await this.trust.evaluate({ kind: record.kind, host: record.host, redirectUris: record.redirectUris });
    if (!verdict.admitted) {
      await this.refusals.record(verdict.host, verdict.reason);
      return { ok: false, code: 'client_not_allowed', host: verdict.host };
    }
    return { ok: true, client: record };
  }

  /** @inheritdoc */
  async resolveStored(clientId: string): Promise<OAuthClientRecord | null> {
    const row = await this.prisma.oAuthClient.findUnique({ where: { clientId } });
    return row ? toClientRecord(row) : null;
  }

  private async refusedOrUnavailable(kind: 'refused' | 'unavailable', url: URL | null): Promise<ClientRefused> {
    if (kind === 'unavailable') return { ok: false, code: 'client_metadata_unavailable' };
    const host = url!.hostname.toLowerCase();
    await this.refusals.record(host, 'host_not_allowed');
    return { ok: false, code: 'client_not_allowed', host };
  }

  /**
   * The row of a metadata-document client, fetching when the cached copy is
   * missing or expired. `refused`: the host is not allowed (no fetch was made);
   * `unavailable`: no usable document and no cached copy; `null`: the feature is off.
   */
  private async resolveMetadataDocument(clientId: string, url: URL): Promise<IdentityOAuthClientRow | 'refused' | 'unavailable' | null> {
    const settings = await this.settings.read();
    if (!settings.clientIdMetadataDocuments) return null;
    const host = url.hostname.toLowerCase();
    if (!isHostAdmitted(host, settings)) return 'refused';

    const cached = await this.prisma.oAuthClient.findUnique<IdentityOAuthClientRow>({ where: { clientId } });
    if (cached && cached.disabledAt !== null) return cached;
    const now = new Date();
    if (cached && cached.metadataExpiresAt !== null && cached.metadataExpiresAt.getTime() > now.getTime()) return cached;

    try {
      const { metadata, expiresAt } = await this.fetcher.fetch(url, now);
      const data = {
        name: metadata.name,
        clientUri: metadata.clientUri,
        logoUri: metadata.logoUri,
        redirectUris: [...metadata.redirectUris],
        tokenEndpointAuthMethod: 'none',
        applicationType: metadata.applicationType,
        host,
        metadataFetchedAt: now,
        metadataExpiresAt: expiresAt,
      };
      const stored = await this.prisma.oAuthClient.upsert<IdentityOAuthClientRow>({
        where: { clientId },
        create: { clientId, kind: 'cimd', ...data },
        update: data,
      });
      if (!cached) this.metrics.add('oauthClientRegistrations', 1, { kind: 'cimd' });
      return stored;
    } catch (error) {
      const code = error instanceof CimdError ? error.code : 'unexpected';
      if (cached && registeredRedirectUris(cached.redirectUris).length > 0) {
        this.logger.warn(`Metadata document of ${host} could not be refreshed (${code}); using the cached copy`);
        return cached;
      }
      this.logger.warn(`Metadata document of ${host} is unavailable (${code})`);
      return 'unavailable';
    }
  }
}
