// =============================================================================
// The OAuth server's Doctor checks (PP-15.8, #1186; docs/specs/doctor.md §4)
// =============================================================================
//
// Five checks in the `auth` category, registered by `OAuthServerModule` (so only
// a deployment that mounts the server has them). Each judgement is a pure
// `decide...` function over facts; `run()` only reads.
//
//   oauth.public_url     APP_URL is a public https URL hosted clients can reach.
//   oauth.well_known     the two discovery documents answer at the PUBLIC URL
//                        (a proxy serving the SPA, or a WAF blocking the path,
//                        is the commonest "the client could not reach the server").
//   oauth.client_policy  which client hosts may connect.
//   oauth.resources      the registered protected resources and their scopes.
//   oauth.token_cleanup  the cleanup job is keeping the token tables small.
//
// READ-ONLY. The one network read, the well-known GET, goes through the same
// egress guard and pinned transport the metadata-document fetch uses: https and
// public addresses only, no redirect, a short deadline, a 64 KiB cap. A deployment
// whose public name resolves to a private address (a development stack, an
// air-gapped install) gets `skip`, never a probe of an internal address.
// NO SECRET MATERIAL: the results carry counts, hosts and URLs, never a token.
// =============================================================================

import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isIP } from 'node:net';

import {
  PLATFORM_PRISMA,
  PinnedGetError,
  WebhookEgressError,
  isBlockedAddress,
  nodePinnedGetTransport,
  resolveWebhookTarget,
  systemHostResolver,
  type HostResolver,
  type PinnedGetTransport,
  type WebhookEgressPolicy,
} from '../../../core/index';
import { DoctorCheckRegistry, type DoctorCheck, type DoctorCheckOutcome } from '../../../doctor/index';
import type { IdentityPrisma } from '../../data/identity-db';
import { OAUTH_CIMD_HOST_RESOLVER, OAUTH_CIMD_TRANSPORT } from '../clients/cimd.fetcher';
import { oauthResourceRegistry } from '../oauth-resource.registry';
import { OAuthServerSettingsReader } from '../oauth-server-settings.reader';
import type { OAuthServerSettingsValue } from '../oauth-server-settings.schemas';
import { OAUTH_TOKEN_RETENTION } from '../oauth-token-cleanup.handler';
import { oauthResourceIdentifier } from '../oauth-token.resolver';

/** Where an administrator fixes the problems these checks find. */
export const OAUTH_SETTINGS_PATH = '/admin/settings/oauth-clients';

const CATEGORY = 'auth';
const OFF: DoctorCheckOutcome = { status: 'skip', detail: 'The OAuth server is switched off' };

// ---- oauth.public_url --------------------------------------------------------------------

/**
 * Whether a host cannot be reached from the public internet, judged from the
 * name alone (no DNS): `localhost` and its subdomains, `.local`, `.internal`,
 * `.lan`, `.home.arpa`, a single-label name, or a private, loopback or
 * link-local IP literal.
 *
 * @param hostname - the URL's host (an IPv6 literal may carry brackets).
 * @returns whether hosted clients cannot reach it.
 *
 * @stability experimental
 */
export function isNonPublicHostName(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === '') return true;
  if (isIP(host) !== 0) return isBlockedAddress(host);
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (/\.(local|internal|lan|home\.arpa|intranet|corp)$/.test(host)) return true;
  return !host.includes('.');
}

/**
 * Pure: can a hosted client reach `APP_URL`?
 *
 * @param input - whether the server is on, and the configured `APP_URL`.
 * @returns `skip` while off; `warn` for an absent, non-https or non-public URL; else `pass`.
 *
 * @stability experimental
 */
export function decideOAuthPublicUrl(input: { enabled: boolean; appUrl: string | undefined }): DoctorCheckOutcome {
  if (!input.enabled) return OFF;
  const remedy = 'Set APP_URL to the public https address of this deployment (for example https://app.example.test) and restart the API.';
  if (!input.appUrl) {
    return { status: 'warn', detail: 'APP_URL is not set: the discovery documents and the 401 challenge cannot be built', remedy };
  }
  let url: URL;
  try {
    url = new URL(input.appUrl);
  } catch {
    return { status: 'warn', detail: 'APP_URL is not a valid URL', remedy };
  }
  const data = { scheme: url.protocol.replace(':', ''), host: url.hostname };
  if (url.protocol !== 'https:') {
    return { status: 'warn', detail: `APP_URL is ${url.protocol.replace(':', '')}:, not https: hosted clients refuse an insecure authorization server`, remedy, data };
  }
  if (isNonPublicHostName(url.hostname)) {
    return { status: 'warn', detail: `APP_URL host ${url.hostname} is a loopback or private name: hosted clients cannot reach it`, remedy, data };
  }
  return { status: 'pass', detail: `APP_URL is ${url.origin}`, data };
}

/** `auth` / `oauth.public_url`. */
@Injectable()
export class OAuthPublicUrlDoctorCheck implements DoctorCheck, OnModuleInit {
  readonly id = 'oauth.public_url';
  readonly category = CATEGORY;
  readonly label = 'OAuth public URL';
  readonly settingsPath = OAUTH_SETTINGS_PATH;

  constructor(
    private readonly registry: DoctorCheckRegistry,
    private readonly settings: OAuthServerSettingsReader,
    @Optional() private readonly config?: ConfigService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(): Promise<DoctorCheckOutcome> {
    const { enabled } = await this.settings.read();
    return decideOAuthPublicUrl({ enabled, appUrl: this.config?.get<string>('appUrl') });
  }
}

// ---- oauth.well_known --------------------------------------------------------------------

/** What one discovery request found. */
export interface WellKnownProbe {
  /** A label for the line: `authorization server` or `resource <id>`. */
  readonly what: string;
  /** The public URL requested. */
  readonly url: string;
  /** `ok`; `wrong` (answered, but not the expected JSON); `unreachable` (the server could not request its own public URL). */
  readonly outcome: 'ok' | 'wrong' | 'unreachable';
  /** Why, for `wrong` and `unreachable`: a closed sentence, never the body. */
  readonly why?: string;
}

/**
 * Pure: grades the probes.
 *
 * @param probes - one per document.
 * @returns `pass` when all answered as expected, `fail` when any answered wrongly, `warn` when only unreachable.
 *
 * @stability experimental
 */
export function decideOAuthWellKnown(probes: readonly WellKnownProbe[]): DoctorCheckOutcome {
  const wrong = probes.filter((probe) => probe.outcome === 'wrong');
  const unreachable = probes.filter((probe) => probe.outcome === 'unreachable');
  const data = { documents: probes.length, wrong: wrong.length, unreachable: unreachable.length };
  if (wrong.length > 0) {
    return {
      status: 'fail',
      detail: `${wrong.map((probe) => `${probe.what} (${probe.url}): ${probe.why ?? 'unexpected answer'}`).join('; ')}`,
      remedy:
        'Route /.well-known/oauth-authorization-server and /.well-known/oauth-protected-resource to the API (the nginx fragment platform/oauth-server.conf does), ' +
        'and make sure a CDN, WAF or the SPA fallback does not answer them. See docs/runbooks/oauth-server.md.',
      data,
    };
  }
  if (unreachable.length > 0) {
    return {
      status: 'warn',
      detail: `${unreachable.length} discovery document(s) could not be requested from this server through the public URL (${unreachable[0]!.why ?? 'network'})`,
      remedy: 'Check that the API can reach its own public address (hairpin routing, firewall, DNS), then verify from outside with curl: see docs/runbooks/oauth-server.md.',
      data,
    };
  }
  return { status: 'pass', detail: `${probes.length} discovery document(s) answer at the public URL`, data };
}

/** The policy of the probe: public https only, like the metadata-document fetch. */
const PROBE_POLICY: WebhookEgressPolicy = Object.freeze({ allowInsecureHttp: false, allowPrivateTargets: false, allowedHosts: Object.freeze([]) });
const PROBE_TIMEOUT_MS = 4_000;
const PROBE_MAX_BYTES = 64 * 1024;
/** Most protected resources probed (the check stays inside its deadline). */
const MAX_RESOURCES_PROBED = 5;

/** `auth` / `oauth.well_known`. */
@Injectable()
export class OAuthWellKnownDoctorCheck implements DoctorCheck, OnModuleInit {
  readonly id = 'oauth.well_known';
  readonly category = CATEGORY;
  readonly label = 'OAuth discovery documents';
  readonly settingsPath = OAUTH_SETTINGS_PATH;
  readonly dependsOn = ['oauth.public_url'];
  readonly timeoutMs = 12_000;

  private readonly transport: PinnedGetTransport;
  private readonly resolver: HostResolver;

  constructor(
    private readonly registry: DoctorCheckRegistry,
    private readonly settings: OAuthServerSettingsReader,
    @Optional() private readonly config?: ConfigService,
    @Optional() @Inject(OAUTH_CIMD_TRANSPORT) transport?: PinnedGetTransport,
    @Optional() @Inject(OAUTH_CIMD_HOST_RESOLVER) resolver?: HostResolver,
  ) {
    this.transport = transport ?? nodePinnedGetTransport;
    this.resolver = resolver ?? systemHostResolver;
  }

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(): Promise<DoctorCheckOutcome> {
    if (!(await this.settings.isEnabled())) return OFF;
    const appUrl = (this.config?.get<string>('appUrl') ?? '').replace(/\/+$/, '');
    if (!appUrl) return { status: 'skip', detail: 'APP_URL is not set' };

    const jobs: Array<{ what: string; url: string; expect: (doc: Record<string, unknown>) => boolean }> = [
      { what: 'authorization server', url: `${appUrl}/.well-known/oauth-authorization-server`, expect: (doc) => doc.issuer === appUrl },
    ];
    for (const resource of oauthResourceRegistry.list().slice(0, MAX_RESOURCES_PROBED)) {
      const identifier = oauthResourceIdentifier(appUrl, resource)!;
      jobs.push({
        what: `resource ${resource.id}`,
        url: `${appUrl}/.well-known/oauth-protected-resource${resource.path}`,
        expect: (doc) => doc.resource === identifier,
      });
    }

    // The egress guard first: a private or non-https public URL is a skip, never a probe.
    try {
      await resolveWebhookTarget(jobs[0]!.url, PROBE_POLICY, this.resolver);
    } catch (error) {
      if (error instanceof WebhookEgressError && (error.code === 'private_target' || error.code === 'scheme_not_allowed' || error.code === 'port_not_allowed')) {
        return { status: 'skip', detail: 'APP_URL is a private or non-https address: the discovery documents were not requested (see oauth.public_url)' };
      }
    }
    return decideOAuthWellKnown(await Promise.all(jobs.map((job) => this.probe(job))));
  }

  private async probe(job: { what: string; url: string; expect: (doc: Record<string, unknown>) => boolean }): Promise<WellKnownProbe> {
    const base = { what: job.what, url: job.url };
    try {
      const target = await resolveWebhookTarget(job.url, PROBE_POLICY, this.resolver);
      const response = await this.transport.get({
        target,
        headers: { accept: 'application/json', 'user-agent': 'platform-oauth-doctor/1', 'accept-encoding': 'identity' },
        timeoutMs: PROBE_TIMEOUT_MS,
        maxBytes: PROBE_MAX_BYTES,
      });
      if (response.status !== 200) return { ...base, outcome: 'wrong', why: `answered HTTP ${response.status}` };
      let doc: unknown;
      try {
        doc = JSON.parse(response.body.toString('utf8'));
      } catch {
        return { ...base, outcome: 'wrong', why: 'did not answer JSON (a proxy or the SPA is answering)' };
      }
      if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return { ...base, outcome: 'wrong', why: 'did not answer a JSON object' };
      return job.expect(doc as Record<string, unknown>) ? { ...base, outcome: 'ok' } : { ...base, outcome: 'wrong', why: 'issuer or resource does not equal APP_URL' };
    } catch (error) {
      if (error instanceof PinnedGetError) return { ...base, outcome: 'unreachable', why: error.code };
      if (error instanceof WebhookEgressError) return { ...base, outcome: 'unreachable', why: error.code };
      return { ...base, outcome: 'unreachable', why: 'network' };
    }
  }
}

// ---- oauth.client_policy -----------------------------------------------------------------

/**
 * Pure: the client trust policy.
 *
 * @param settings - the `oauthServer` settings.
 * @returns `skip` while off; `warn` when any host may connect; else `pass` listing the allowed hosts.
 *
 * @stability experimental
 */
export function decideOAuthClientPolicy(settings: Pick<OAuthServerSettingsValue, 'enabled' | 'allowAnyClientHost' | 'allowedClientHosts' | 'allowLoopbackClients' | 'clientIdMetadataDocuments' | 'dynamicClientRegistration'>): DoctorCheckOutcome {
  if (!settings.enabled) return OFF;
  const data = {
    allowedHosts: settings.allowedClientHosts.length,
    allowAnyClientHost: settings.allowAnyClientHost,
    allowLoopbackClients: settings.allowLoopbackClients,
    clientIdMetadataDocuments: settings.clientIdMetadataDocuments,
    dynamicClientRegistration: settings.dynamicClientRegistration,
  };
  if (settings.allowAnyClientHost) {
    return {
      status: 'warn',
      detail: 'Any client host may connect (allowAnyClientHost is on): a user can be asked to approve an app from a host nobody vetted',
      remedy: `Turn off "Allow any client host" at ${OAUTH_SETTINGS_PATH} and list the hosts you trust.`,
      data,
    };
  }
  const hosts = settings.allowedClientHosts;
  const shown = hosts.slice(0, 10).join(', ');
  return {
    status: 'pass',
    detail: hosts.length === 0 ? 'No client host is allowed yet (only pre-registered clients and, if enabled, loopback clients can connect)' : `${hosts.length} allowed client host(s): ${shown}${hosts.length > 10 ? ', ...' : ''}`,
    data,
  };
}

/** `auth` / `oauth.client_policy`. */
@Injectable()
export class OAuthClientPolicyDoctorCheck implements DoctorCheck, OnModuleInit {
  readonly id = 'oauth.client_policy';
  readonly category = CATEGORY;
  readonly label = 'OAuth client policy';
  readonly settingsPath = OAUTH_SETTINGS_PATH;

  constructor(
    private readonly registry: DoctorCheckRegistry,
    private readonly settings: OAuthServerSettingsReader,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(): Promise<DoctorCheckOutcome> {
    return decideOAuthClientPolicy(await this.settings.read());
  }
}

// ---- oauth.resources ---------------------------------------------------------------------

/**
 * Pure: the registered protected resources.
 *
 * @param enabled - whether the server is on.
 * @param resources - each registered resource id with its scope count.
 * @returns `skip` while off; `warn` when on with none; else `pass` listing them.
 *
 * @stability experimental
 */
export function decideOAuthResources(enabled: boolean, resources: ReadonlyArray<{ id: string; scopes: number }>): DoctorCheckOutcome {
  if (!enabled) return OFF;
  if (resources.length === 0) {
    return {
      status: 'warn',
      detail: 'The OAuth server is on, but no protected resource is registered: no client can be authorized',
      remedy: 'Register a resource with registerOAuthProtectedResource() (and its scopes with registerOAuthScope()) at import time in the app. See docs/specs/oauth-server.md §4.',
      data: { resources: 0 },
    };
  }
  return {
    status: 'pass',
    detail: `${resources.length} protected resource(s): ${resources.map((resource) => `${resource.id} (${resource.scopes} scope${resource.scopes === 1 ? '' : 's'})`).join(', ')}`,
    data: { resources: resources.length, scopes: resources.reduce((sum, resource) => sum + resource.scopes, 0) },
  };
}

/** `auth` / `oauth.resources`. */
@Injectable()
export class OAuthResourcesDoctorCheck implements DoctorCheck, OnModuleInit {
  readonly id = 'oauth.resources';
  readonly category = CATEGORY;
  readonly label = 'OAuth protected resources';
  readonly settingsPath = OAUTH_SETTINGS_PATH;

  constructor(
    private readonly registry: DoctorCheckRegistry,
    private readonly settings: OAuthServerSettingsReader,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(): Promise<DoctorCheckOutcome> {
    const enabled = await this.settings.isEnabled();
    return decideOAuthResources(enabled, oauthResourceRegistry.list().map((resource) => ({ id: resource.id, scopes: resource.scopes.length })));
  }
}

// ---- oauth.token_cleanup -----------------------------------------------------------------

/** How long past expiry a token may linger before the check warns, in milliseconds (7 days). */
export const OAUTH_TOKEN_CLEANUP_GRACE_MS = OAUTH_TOKEN_RETENTION.refreshTokenMs;

/**
 * Pure: is the cleanup job keeping up?
 *
 * @param staleTokens - tokens that expired more than 7 days ago and still exist.
 * @returns `warn` when any exist; else `pass`.
 *
 * @stability experimental
 */
export function decideOAuthTokenCleanup(staleTokens: number): DoctorCheckOutcome {
  if (staleTokens > 0) {
    return {
      status: 'warn',
      detail: `${staleTokens} OAuth token(s) expired more than 7 days ago are still stored: the cleanup job is not running`,
      remedy: 'Check that the job worker is running and the oauth.token.cleanup jobs succeed (Admin, Jobs settings); the job is queued hourly.',
      data: { staleTokens },
    };
  }
  return { status: 'pass', detail: 'No OAuth token expired more than 7 days ago is still stored', data: { staleTokens: 0 } };
}

/** `auth` / `oauth.token_cleanup`. */
@Injectable()
export class OAuthTokenCleanupDoctorCheck implements DoctorCheck, OnModuleInit {
  readonly id = 'oauth.token_cleanup';
  readonly category = CATEGORY;
  readonly label = 'OAuth token cleanup';
  readonly settingsPath = '/admin/settings/jobs';
  readonly dependsOn = ['db.connection'];

  constructor(
    private readonly registry: DoctorCheckRegistry,
    @Inject(PLATFORM_PRISMA) private readonly prisma: IdentityPrisma,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  /** Read-only: one count. */
  async run(): Promise<DoctorCheckOutcome> {
    const stale = await this.prisma.oAuthToken.count({ where: { expiresAt: { lt: new Date(Date.now() - OAUTH_TOKEN_CLEANUP_GRACE_MS) } } });
    return decideOAuthTokenCleanup(Number(stale ?? 0));
  }
}
