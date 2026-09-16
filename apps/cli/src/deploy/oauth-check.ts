import type { FetchLike } from './health.js';

// =============================================================================
// Is OAuth actually going to work?  (issue #391, epic #388)
// =============================================================================
//
// Every other precondition in this pipeline fails loudly. A wrong OAuth
// credential fails SILENTLY AND LATE: the stack builds, migrates, seeds, goes
// green, publishes over HTTPS, and then the first person to click "Sign in"
// gets a Google error page. Nothing the deployment tool looked at was wrong,
// because the deployment tool never looked.
//
// THREE LAYERS, CHEAPEST FIRST, and each one catches something the next cannot:
//
//   1. THE SHAPE of GOOGLE_CLIENT_ID. Free, offline, and catches the paste
//      that grabbed the wrong field out of the console.
//   2. THE CALLBACK URL against the domain being deployed. Free, offline, and
//      it is the TOP ROW of the runbook's troubleshooting table - the login
//      loop whose cause is `GOOGLE_CALLBACK_URL` disagreeing with the domain
//      actually being served.
//   3. A LIVE CREDENTIAL PROBE. One request, no browser, no user, no token.
//
// LAYER 3 IS THE COUNTER-INTUITIVE ONE AND IT IS WORTH STATING PRECISELY. We
// POST to the token endpoint with a deliberately invalid `code`. Google
// authenticates the CLIENT before it evaluates the GRANT, so the two failures
// mean opposite things:
//
//      invalid_client  ->  the id/secret pair was REJECTED. Wrong credential.
//      invalid_grant   ->  the id/secret pair was ACCEPTED, and only the code
//                          we deliberately made up was rejected. CORRECT.
//
// So the "error" we want to see is `invalid_grant`. Nothing is issued, nothing
// is consumed, and no user is involved.
//
// A NETWORK FAILURE IS A WARNING, NEVER A HARD FAIL. An air-gapped server, an
// egress-filtered one, or one deployed during a Google outage must still be
// able to install; refusing would make this check the reason a deployment
// cannot happen, which is a worse outcome than the misconfiguration it is
// looking for. The first two layers still ran, and they are the ones that
// catch the common mistakes anyway.
//
// NOTHING HERE EVER PUTS THE CLIENT SECRET IN A STRING IT RETURNS. The probe
// reads one field out of the response - the `error` code, a fixed token from a
// known set - and never the body, never the request, never the value it sent.
// The caller registers the secret with the journal's redactor before calling
// in, which is belt and braces on top of that.
// =============================================================================

/** Google's OAuth 2.0 token endpoint. */
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/**
 * Every Google OAuth client id ends this way.
 *
 * It is the one stable, documented invariant of the format, which is why the
 * check is written against the suffix rather than against the shape of the
 * random part - that part has changed before and may again.
 */
export const GOOGLE_CLIENT_ID_SUFFIX = '.apps.googleusercontent.com';

/** Long enough for a round trip to Google, short enough not to look hung. */
const PROBE_TIMEOUT_MS = 15_000;

export type OAuthStatus = 'pass' | 'warn' | 'fail';

/** Display-safe by construction: no field may hold a credential. */
export interface OAuthFinding {
  /** Stable, so a test and a journal line can both name it. */
  id: string;
  status: OAuthStatus;
  detail: string;
  remedy?: string | undefined;
}

/** The callback URL a deployment on `domain` must be configured with. */
export function expectedCallbackUrl(domain: string): string {
  return `https://${domain}/api/auth/google/callback`;
}

/** Layer 1: the id looks like a Google OAuth client id. */
export function checkClientIdShape(clientId: string | undefined): OAuthFinding {
  const value = (clientId ?? '').trim();

  if (value === '') {
    return {
      id: 'oauth-client-id',
      status: 'fail',
      detail: 'GOOGLE_CLIENT_ID is empty',
      // Not a warning: an empty client id crashes bootstrap outright with
      // "OAuth2Strategy requires a clientID option", so the stack would not
      // start at all.
      remedy: `Set GOOGLE_CLIENT_ID to the OAuth client id from the Google Cloud console; it ends in ${GOOGLE_CLIENT_ID_SUFFIX}.`,
    };
  }

  if (!value.endsWith(GOOGLE_CLIENT_ID_SUFFIX)) {
    return {
      id: 'oauth-client-id',
      status: 'fail',
      detail: `GOOGLE_CLIENT_ID does not end in ${GOOGLE_CLIENT_ID_SUFFIX}`,
      remedy:
        'This is usually the project number, the API key or the client SECRET pasted into the id field. Copy the "Client ID" from the OAuth 2.0 Client IDs section of the Google Cloud console.',
    };
  }

  return { id: 'oauth-client-id', status: 'pass', detail: 'looks like a Google client id' };
}

/** Layer 2: the callback URL matches the domain being deployed. */
export function checkCallbackUrl(
  callbackUrl: string | undefined,
  domain: string,
): OAuthFinding {
  const expected = expectedCallbackUrl(domain);
  const value = (callbackUrl ?? '').trim();

  if (value === '') {
    return {
      id: 'oauth-callback-url',
      status: 'fail',
      detail: 'GOOGLE_CALLBACK_URL is empty',
      remedy: `Set it to ${expected}, and register that exact URL as an authorised redirect URI for this OAuth client.`,
    };
  }

  if (value !== expected) {
    return {
      id: 'oauth-callback-url',
      status: 'fail',
      detail: `GOOGLE_CALLBACK_URL is ${value}, but this deployment serves ${domain}`,
      // The top row of the runbook's troubleshooting table, caught before the
      // install rather than after the first failed login.
      remedy: `Set it to ${expected}. A callback URL that disagrees with the domain being served makes the login redirect loop, or Google reject the callback outright.`,
    };
  }

  return { id: 'oauth-callback-url', status: 'pass', detail: expected };
}

export interface CredentialProbeOptions {
  clientId: string;
  clientSecret: string;
  /** Sent as `redirect_uri`; Google validates the client before the grant. */
  redirectUri: string;
  fetch?: FetchLike | undefined;
  timeoutMs?: number | undefined;
}

/**
 * Layer 3: ask Google whether it recognises this id and secret.
 *
 * The runtime `fetch`, injected the way `health.ts` injects it - no new
 * dependency, and a test drives every branch without a network.
 */
export async function probeCredentials(
  options: CredentialProbeOptions,
): Promise<OAuthFinding> {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    // Deliberately invalid, and deliberately obvious in Google's logs about
    // what it was. No code is consumed and no token can be issued.
    code: 'appctl-deploy-preflight-invalid-code',
    client_id: options.clientId,
    client_secret: options.clientSecret,
    redirect_uri: options.redirectUri,
  });

  let payload: unknown;
  try {
    const response = await doFetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(options.timeoutMs ?? PROBE_TIMEOUT_MS),
    });
    payload = await response.json().catch(() => undefined);
  } catch (error) {
    // Air-gapped, egress-filtered, or Google is having a bad day. See the
    // header: this must never be the reason an install cannot proceed.
    return {
      id: 'oauth-credentials',
      status: 'warn',
      detail: `could not reach Google to verify the credentials (${describe(error)})`,
      remedy:
        'The credentials were not checked. If sign-in fails after this install, confirm GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the deployed .env.',
    };
  }

  // Only this one field is ever read out of the response, and it is a fixed
  // token from a documented set - never the body, which is not ours to log.
  const code = readErrorCode(payload);

  if (code === 'invalid_grant') {
    // The pair was ACCEPTED and only the made-up code was rejected. See the
    // header: this is the success case, and inverting it is the one way to get
    // this check exactly backwards.
    return {
      id: 'oauth-credentials',
      status: 'pass',
      detail: 'Google accepted the client id and secret',
    };
  }

  if (code === 'invalid_client' || code === 'unauthorized_client') {
    return {
      id: 'oauth-credentials',
      status: 'fail',
      detail: `Google rejected the client credentials (${code})`,
      remedy:
        'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET do not match a live OAuth client. Re-copy both from the Google Cloud console — a rotated secret, or a client deleted from a different project, both look like this.',
    };
  }

  if (code === undefined) {
    return {
      id: 'oauth-credentials',
      status: 'warn',
      detail: 'Google answered with something this check does not recognise',
      remedy: 'The credentials were not confirmed either way; sign-in is the real test.',
    };
  }

  // A documented error that is neither of the two above (`invalid_request`
  // from a malformed redirect_uri, most likely). Reported as itself rather
  // than forced into one of the two verdicts.
  return {
    id: 'oauth-credentials',
    status: 'warn',
    detail: `Google answered ${code}`,
    remedy: 'The credentials were not confirmed either way; check GOOGLE_CALLBACK_URL is registered on this OAuth client.',
  };
}

/**
 * All three layers, in order, over a resolved environment.
 *
 * Returns findings rather than throwing: the caller decides what a `fail`
 * means to it, and the journal gets every line either way.
 */
export async function verifyOAuthConfiguration(options: {
  env: ReadonlyMap<string, string>;
  domain: string;
  fetch?: FetchLike | undefined;
  /** Skips layer 3 entirely; the two offline layers still run. */
  skipProbe?: boolean | undefined;
}): Promise<OAuthFinding[]> {
  const clientId = options.env.get('GOOGLE_CLIENT_ID') ?? '';
  const clientSecret = options.env.get('GOOGLE_CLIENT_SECRET') ?? '';
  const callbackUrl = options.env.get('GOOGLE_CALLBACK_URL');

  const findings: OAuthFinding[] = [
    checkClientIdShape(clientId),
    checkCallbackUrl(callbackUrl, options.domain),
  ];

  // The live probe is skipped when the offline layers already know the id is
  // unusable: spending a round trip to be told the same thing in Google's
  // words adds nothing, and a request built from an obviously wrong id is
  // noise in somebody's audit log.
  const usable =
    clientId !== '' && clientSecret !== '' && findings[0]?.status === 'pass';

  if (options.skipProbe === true || !usable) {
    findings.push({
      id: 'oauth-credentials',
      status: 'warn',
      detail:
        options.skipProbe === true
          ? 'the live credential check was skipped'
          : 'not checked against Google, because the client id or secret is not usable as it stands',
    });
    return findings;
  }

  findings.push(
    await probeCredentials({
      clientId,
      clientSecret,
      redirectUri: callbackUrl ?? expectedCallbackUrl(options.domain),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    }),
  );

  return findings;
}

// =============================================================================
// AFTER the deployment is up: the wiring, end to end  (issue #391)
// =============================================================================
//
// The three layers above check what is in .env. This checks what the RUNNING
// APPLICATION does with it, which is a different question and the one that
// actually predicts whether a person can sign in:
//
//   GET /api/auth/providers   ->  does the API consider Google configured?
//   GET /api/auth/google      ->  does it redirect to Google, carrying the
//                                 client id and redirect URI it was given?
//
// NO CREDENTIALS ARE IN FLIGHT. The redirect is read, not followed; the client
// id is public by construction (it travels in a browser's address bar), and
// the secret is never involved. Nothing is echoed back into the result either
// way - a mismatch is reported as a mismatch, not by printing both values.
// =============================================================================

export interface SmokeOptions {
  /** Where the application answers; loopback during install, as elsewhere. */
  baseUrl: string;
  clientId?: string | undefined;
  callbackUrl?: string | undefined;
  fetch?: FetchLike | undefined;
  timeoutMs?: number | undefined;
}

/** True when the providers payload lists Google, whatever shape it arrived in. */
export function listsGoogle(payload: unknown): boolean | undefined {
  const data = (payload as { data?: unknown } | undefined)?.data ?? payload;
  const list = Array.isArray(data)
    ? data
    : (data as { providers?: unknown } | undefined)?.providers;

  // Not an answer we understand. Distinct from "it said no": a forked API that
  // shapes this differently must not be reported as broken.
  if (!Array.isArray(list)) return undefined;

  return list.some((entry) => {
    if (typeof entry === 'string') return entry.toLowerCase() === 'google';
    const name = (entry as { name?: unknown; id?: unknown } | null)?.name ??
      (entry as { id?: unknown } | null)?.id;
    return typeof name === 'string' && name.toLowerCase() === 'google';
  });
}

/**
 * Checks the live OAuth wiring.
 *
 * ONLY UNAMBIGUOUS EVIDENCE FAILS. An unreachable endpoint, an unparseable
 * body or a redirect this does not recognise is a `warn`, because the thing
 * that would be wrong in that case is this check's understanding of the API,
 * not the deployment. A 200 that lists no Google provider, or a redirect to
 * Google carrying the wrong client id or redirect URI, is neither ambiguous
 * nor survivable: sign-in is broken, and that is worth stopping for.
 */
export async function smokeOAuth(options: SmokeOptions): Promise<OAuthFinding> {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeout = options.timeoutMs ?? 10_000;

  let providers: unknown;
  try {
    const response = await doFetch(`${options.baseUrl}/api/auth/providers`, {
      signal: AbortSignal.timeout(timeout),
      redirect: 'manual',
    });
    if (response.status !== 200) {
      return {
        id: 'oauth-wiring',
        status: 'warn',
        detail: `GET /api/auth/providers answered ${response.status}`,
        remedy: 'The OAuth wiring could not be confirmed. Check the api container logs.',
      };
    }
    providers = await response.json().catch(() => undefined);
  } catch (error) {
    return {
      id: 'oauth-wiring',
      status: 'warn',
      detail: `could not reach /api/auth/providers (${describe(error)})`,
      remedy: 'The OAuth wiring could not be confirmed.',
    };
  }

  const google = listsGoogle(providers);
  if (google === false) {
    return {
      id: 'oauth-wiring',
      status: 'fail',
      detail: 'the API does not list google as an enabled provider',
      // The API only advertises Google when BOTH values are present, so this
      // is the deployed .env being incomplete - not a permissions problem.
      remedy:
        'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must both be set in the deployed .env, and the api container has to have been restarted since. Nobody can sign in until they are.',
    };
  }

  let location: string | undefined;
  try {
    const response = await doFetch(`${options.baseUrl}/api/auth/google`, {
      signal: AbortSignal.timeout(timeout),
      redirect: 'manual',
    });
    location = response.headers.get('location') ?? undefined;

    if (response.status < 300 || response.status >= 400 || location === undefined) {
      return {
        id: 'oauth-wiring',
        status: 'warn',
        detail: `GET /api/auth/google answered ${response.status} instead of a redirect`,
        remedy: 'The sign-in redirect could not be confirmed. Check the api container logs.',
      };
    }
  } catch (error) {
    return {
      id: 'oauth-wiring',
      status: 'warn',
      detail: `could not reach /api/auth/google (${describe(error)})`,
      remedy: 'The sign-in redirect could not be confirmed.',
    };
  }

  return compareAuthorizeRedirect(location, {
    ...(options.clientId === undefined ? {} : { clientId: options.clientId }),
    ...(options.callbackUrl === undefined ? {} : { callbackUrl: options.callbackUrl }),
  });
}

/**
 * Reads the authorize redirect and compares it with what was configured.
 *
 * Exported for its test: this is where the judgement lives, and it is a pure
 * function of a URL and two expected values.
 */
export function compareAuthorizeRedirect(
  location: string,
  expected: { clientId?: string | undefined; callbackUrl?: string | undefined },
): OAuthFinding {
  let url: URL;
  try {
    url = new URL(location);
  } catch {
    return {
      id: 'oauth-wiring',
      status: 'warn',
      detail: 'the sign-in redirect could not be parsed',
    };
  }

  if (!/(^|\.)google\.com$/i.test(url.hostname)) {
    return {
      id: 'oauth-wiring',
      status: 'warn',
      detail: `the sign-in redirect points at ${url.hostname}, which this check does not recognise`,
    };
  }

  const sentClientId = url.searchParams.get('client_id') ?? '';
  const sentRedirect = url.searchParams.get('redirect_uri') ?? '';

  // Values are compared, never reported. The client id is public, but a
  // result struct that habitually carries configuration values is one edit
  // away from carrying one that is not.
  if (expected.clientId !== undefined && sentClientId !== expected.clientId) {
    return {
      id: 'oauth-wiring',
      status: 'fail',
      detail: 'the sign-in redirect carries a different client id from GOOGLE_CLIENT_ID',
      remedy:
        'The running api container is using an older .env than the one on disk. Restart the stack, and check nothing overrides GOOGLE_CLIENT_ID in the compose environment.',
    };
  }

  if (expected.callbackUrl !== undefined && sentRedirect !== expected.callbackUrl) {
    return {
      id: 'oauth-wiring',
      status: 'fail',
      detail: 'the sign-in redirect asks Google to return to a different URL from GOOGLE_CALLBACK_URL',
      remedy:
        'Google rejects a redirect_uri that is not registered on the OAuth client, so sign-in will fail. Make GOOGLE_CALLBACK_URL, the registered redirect URI and the domain being served agree, then restart the stack.',
    };
  }

  return {
    id: 'oauth-wiring',
    status: 'pass',
    detail: 'the API lists google and redirects to it with the configured client',
  };
}

/** The `error` field of an OAuth error response, when there is one. */
function readErrorCode(payload: unknown): string | undefined {
  const error = (payload as { error?: unknown } | undefined)?.error;
  return typeof error === 'string' ? error : undefined;
}

function describe(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') return 'timed out';
  const cause = (error as { cause?: { code?: string } } | undefined)?.cause;
  if (typeof cause?.code === 'string') return cause.code;
  return error instanceof Error ? error.message : String(error);
}
