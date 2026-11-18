// =============================================================================
// The client trust policy (PP-15.5, docs/specs/oauth-server.md §2.15)
// =============================================================================
//
// Every client can describe itself to the server, so WHO MAY BE A CLIENT is a
// deployment decision. The default is closed. The rule, evaluated for every
// client at `/authorize`, `/register` and `/token`:
//
//   admit when the client is `registered` (an administrator made it), or
//   `allowAnyClientHost` is on, or its host is in `allowedClientHosts`, or its
//   host is `loopback` and `allowLoopbackClients` is on.
//
// A CIMD client additionally needs every non-loopback redirect URI on the
// `client_id` URL's host or on a host in `allowedClientHosts` (a vendor's
// document may live on a different host from its callback; the administrator
// then allows both).
//
// `evaluateClientTrust` is PURE; `ClientTrustPolicy` reads the settings.
// =============================================================================

import { Injectable } from '@nestjs/common';

import type { OAuthServerSettingsValue } from '../oauth-server-settings.schemas';
import { OAuthServerSettingsReader } from '../oauth-server-settings.reader';
import { LOOPBACK_CLIENT_HOST, redirectUriHost } from './client-redirects';

/** The part of a client the policy looks at. @stability experimental */
export interface TrustSubject {
  /** How the client came to exist. */
  readonly kind: 'cimd' | 'dynamic' | 'registered';
  /** The client's host. */
  readonly host: string;
  /** The client's redirect URIs. */
  readonly redirectUris: readonly string[];
}

/** The settings the policy reads. @stability experimental */
export type TrustSettings = Pick<OAuthServerSettingsValue, 'allowedClientHosts' | 'allowAnyClientHost' | 'allowLoopbackClients'>;

/** Why a client was refused. @stability experimental */
export type TrustRefusalReason = 'host_not_allowed' | 'loopback_not_allowed' | 'redirect_host_not_allowed';

/**
 * The policy's answer.
 *
 * @stability experimental
 */
export type TrustVerdict =
  | {
      /** The client is admitted. */
      readonly admitted: true;
    }
  | {
      /** The client is refused. */
      readonly admitted: false;
      /** The refused host. */
      readonly host: string;
      /** Why it was refused. */
      readonly reason: TrustRefusalReason;
    };

/**
 * Whether `host` alone is admitted (the CIMD pre-fetch check): no document has
 * been read yet, so only the `client_id` URL's host counts.
 *
 * @param host - the lower-cased host.
 * @param settings - the settings.
 *
 * @stability experimental
 */
export function isHostAdmitted(host: string, settings: TrustSettings): boolean {
  return settings.allowAnyClientHost || settings.allowedClientHosts.includes(host);
}

/**
 * The policy as a pure function.
 *
 * @param subject - the client.
 * @param settings - the settings.
 * @returns the verdict.
 *
 * @stability experimental
 */
export function evaluateClientTrust(subject: TrustSubject, settings: TrustSettings): TrustVerdict {
  if (subject.kind === 'registered') return { admitted: true };
  const host = subject.host;
  if (subject.kind === 'cimd') {
    if (!isHostAdmitted(host, settings)) return { admitted: false, host, reason: 'host_not_allowed' };
    if (!settings.allowAnyClientHost) {
      for (const uri of subject.redirectUris) {
        const uriHost = redirectUriHost(uri);
        if (uriHost === LOOPBACK_CLIENT_HOST) continue;
        if (uriHost !== host && !settings.allowedClientHosts.includes(uriHost)) {
          return { admitted: false, host, reason: 'redirect_host_not_allowed' };
        }
      }
    }
    return { admitted: true };
  }
  // dynamic
  if (host === LOOPBACK_CLIENT_HOST) {
    if (settings.allowLoopbackClients || settings.allowAnyClientHost) return { admitted: true };
    return { admitted: false, host, reason: 'loopback_not_allowed' };
  }
  if (isHostAdmitted(host, settings)) return { admitted: true };
  return { admitted: false, host, reason: 'host_not_allowed' };
}

/**
 * Evaluates {@link evaluateClientTrust} against the live settings.
 *
 * @stability experimental
 */
@Injectable()
export class ClientTrustPolicy {
  constructor(private readonly settings: OAuthServerSettingsReader) {}

  /**
   * Whether the client may connect.
   *
   * @param subject - the client.
   * @returns the verdict.
   */
  async evaluate(subject: TrustSubject): Promise<TrustVerdict> {
    return evaluateClientTrust(subject, await this.settings.read());
  }
}
