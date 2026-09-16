/**
 * The deployment record, as the web app sees it — issue #392, epic #388.
 *
 * ONE MODULE FOR ONE ROUTE, shaped exactly like `services/nodes.ts` (#271) and
 * `services/dbBackup.ts` (#287): `services/api.ts` stays the transport — the
 * `ApiService` instance, the refresh dance, the maintenance recogniser — and a
 * surface gets a module where its call sits next to the types it produces.
 * `getDeployment` goes through the shared `api` client, so it inherits the
 * token refresh, the 401 retry and the maintenance interception like every
 * other call in the app.
 *
 * =============================================================================
 * THE ENDPOINT ALWAYS ANSWERS 200. "NOT CONFIGURED" IS NOT AN ERROR.
 * =============================================================================
 *
 * A deployment that was never installed by `appctl deploy` — a developer's
 * compose stack, a container whose state file is not mounted — has no state
 * file to read, and that is the ORDINARY case rather than a failure. The API
 * answers `configured: false` with a `source.reason` saying which of the three
 * things happened (`not-found`, `unreadable`, `invalid`), and the page renders
 * an explanation. A rejection from this function therefore means something
 * genuinely went wrong (401, 403, 500, the connection dropped) and is the only
 * thing the page is entitled to draw as an error — see `hooks/useDeployment.ts`
 * for the same distinction stated on the hook's own contract.
 *
 * =============================================================================
 * EVERY FIELD UNDER `deployment` PAST THE REQUIRED CORE IS GENUINELY OPTIONAL
 * =============================================================================
 *
 * The state file is versioned, and a **v1** file carries no `host`, no `proxy`
 * and no `history` at all. They are optional in this contract for that reason
 * and not as defensive typing: an upgraded deployment gains them on its next
 * `appctl deploy update`, and until then the page must render correctly WITHOUT
 * them rather than draw three empty boxes. `previousSha` and `domain` are
 * optional for a different reason — the first install has no predecessor, and a
 * deployment reached by IP has no domain.
 *
 * =============================================================================
 * ⚠ THIS DATA ORIGINATES FROM A FILE ON A SERVER'S DISK
 * =============================================================================
 *
 * `repoUrl`, `domain` and `commitSha` come from a JSON state file, not from a
 * database column with a constraint on it. Nothing in this app may put any of
 * them into an `href` unvalidated — an `ssh://`/`git@` remote is not a web URL
 * at all, and a `javascript:` string in a hand-edited file would be a working
 * XSS the moment some component rendered it as a link. `deploymentCommitUrl`
 * and `deploymentDomainUrl` below are the ONLY two places in the web app that
 * turn any of it into a URL, and both return `null` rather than guessing.
 */

import { api } from './api';

// =============================================================================
// The wire contract — a mirror of `GET /api/admin/deployment`
// =============================================================================

/** Why the API has no deployment record to show. Absent when it has one. */
export type DeploymentSourceReason = 'not-found' | 'unreadable' | 'invalid';

/** Where the record was read from, and why it could not be. */
export interface DeploymentSource {
  /** Absolute path of the state file the API looked for. `null` when it has no configured location. */
  path: string | null;
  /**
   * `null` — not `undefined` — when the record WAS found: the API's DTO
   * declares this field nullable rather than optional
   * (`deployment/dto/deployment-info.dto.ts`). Both are accepted here so the
   * only thing any caller does with it is a truthiness check, never an `in`
   * test that one of the two shapes would answer wrongly.
   */
  reason?: DeploymentSourceReason | null;
}

/**
 * Facts about the PROCESS answering this request.
 *
 * ⚠ `hostname` is the API CONTAINER's hostname — a short random container id on
 * a compose deployment — and NOT the host the deployment runs on. The host's
 * own hostname is `DeploymentHost.hostname`. They are two different machines'
 * names in the same response, which is exactly why the page labels this whole
 * group as the running container rather than mixing it into Host.
 */
export interface DeploymentRuntime {
  apiVersion: string;
  /** ISO — when this process started, not when the deployment was installed. */
  startedAt: string;
  nodeVersion: string;
  nodeEnv: string;
  hostname: string;
}

/** The machine `appctl deploy` ran on. Absent from a v1 state file. */
export interface DeploymentHost {
  hostname: string;
  os: string;
  kernel: string;
  arch: string;
  cpus: number;
  memoryBytes: number;
  dockerVersion: string;
  composeVersion: string;
  publicIp?: string;
}

/** How traffic reaches this deployment. Absent from a v1 state file. */
export interface DeploymentProxy {
  domain: string;
  bindPort: number;
  /**
   * OPTIONAL on the wire (`apps/api/src/deployment/deploy-state.schema.ts`): a
   * proxy terminating on the host itself is not a container and has no name to
   * report. Rendered as an em dash rather than as an empty row.
   */
  container?: string;
  /** Whether the shared proxy runs as a container or on the host itself. */
  mode: 'container' | 'host';
  /** ISO — the TLS certificate's expiry, when the proxy reported one. */
  certNotAfter?: string;
}

/** What `appctl deploy` did. The two commands are not interchangeable to a reader. */
export type DeploymentCommand = 'install' | 'update';

/** One past deploy. The array is absent from a v1 state file. */
export interface DeploymentHistoryEntry {
  /** ISO. */
  at: string;
  command: DeploymentCommand;
  commitSha: string;
  previousSha?: string;
  ref: string;
  durationMs: number;
  appctlVersion: string;
  outcome: 'success' | 'failed';
}

/** The record itself. Absent entirely when `configured` is false. */
export interface DeploymentRecord {
  /** State-file schema version. `1` has no `host`, `proxy` or `history`. */
  version: number;
  repoUrl: string;
  ref: string;
  commitSha: string;
  previousSha?: string;
  domain?: string;
  bindPort: number;
  deployRoot: string;
  /** ISO — the first `appctl deploy install`. */
  installedAt: string;
  /** ISO — the most recent install or update. */
  lastDeployedAt: string;
  lastCommand: DeploymentCommand;
  appctlVersion: string;
  host?: DeploymentHost;
  proxy?: DeploymentProxy;
  history?: DeploymentHistoryEntry[];
}

export interface DeploymentResponse {
  configured: boolean;
  source: DeploymentSource;
  runtime: DeploymentRuntime;
  /**
   * `null` — not absent — when there is no record: the API declares it
   * nullable (`deploymentInfoSchema`). Typed to accept either, so the only
   * thing any caller does with it is a truthiness check. `configured` remains
   * the field to BRANCH on; this is the payload behind it.
   */
  deployment?: DeploymentRecord | null;
}

// =============================================================================
// The call
// =============================================================================

/**
 * `GET /api/admin/deployment` — `deployment:read`.
 *
 * Read-only, and the only route this surface has: there is nothing on this page
 * to write, because nothing about a deployment is settable from a browser. It
 * is changed by running `appctl deploy` on the server, and a control here that
 * appeared to change it would be lying.
 */
export async function getDeployment(): Promise<DeploymentResponse> {
  return api.get<DeploymentResponse>('/admin/deployment');
}

// =============================================================================
// Turning untrusted strings into links — the only two places that may
// =============================================================================

/** A commit sha, as git writes one. Abbreviations down to 7 are legitimate. */
const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

/**
 * A hostname: dot-separated LDH labels, at least two of them.
 *
 * At least two deliberately — a single label is not a domain anybody browses
 * to, and accepting one would let an arbitrary token become
 * `https://<token>/`. No leading/trailing hyphen per label, and no trailing
 * dot, because the value is being pasted into an `href` rather than resolved.
 */
const DOMAIN_PATTERN =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/**
 * The repository's BROWSABLE base URL, or `null` when there isn't one.
 *
 * `https:` ONLY, and that is the whole point of the function. A deployment
 * cloned over SSH has `git@github.com:acme/app.git` or `ssh://git@…` in its
 * state file, neither of which is a web address — and a page that
 * string-concatenated `/commit/<sha>` onto one would render a link that either
 * 404s or, with a hand-edited file, navigates somewhere chosen by whoever could
 * write to that server's disk. `http:` is refused too: a plaintext link out of
 * an admin console is not worth offering, and every forge this could point at
 * serves TLS.
 *
 * Any credentials in the URL are DROPPED rather than carried into the link.
 * `.git` and a trailing slash are trimmed so the result is the browsable base
 * a forge serves.
 */
export function deploymentRepoUrl(repoUrl: string | null | undefined): string | null {
  if (typeof repoUrl !== 'string' || repoUrl.trim() === '') return null;

  let parsed: URL;
  try {
    parsed = new URL(repoUrl.trim());
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:') return null;
  if (!parsed.hostname) return null;

  // Rebuilt from the parsed parts rather than returned as given, so a userinfo
  // section, a query string or a fragment cannot ride along into the `href`.
  const path = parsed.pathname.replace(/\.git$/i, '').replace(/\/+$/, '');
  return `https://${parsed.host}${path}`;
}

/**
 * A link to one commit on the forge, or `null`.
 *
 * BOTH halves are validated: a good repository URL with a junk sha still
 * produces `null`, because the sha is interpolated into the path and is exactly
 * as untrusted as the URL is. `/commit/<sha>` is the path GitHub, GitLab and
 * Gitea all serve; a forge that does not is a dead link, not an unsafe one.
 */
export function deploymentCommitUrl(
  repoUrl: string | null | undefined,
  commitSha: string | null | undefined,
): string | null {
  const base = deploymentRepoUrl(repoUrl);
  if (!base) return null;
  if (typeof commitSha !== 'string' || !COMMIT_SHA_PATTERN.test(commitSha)) return null;
  return `${base}/commit/${commitSha}`;
}

/**
 * `https://<domain>` for a domain that looks like one, or `null`.
 *
 * The state file's `domain` is a bare hostname, so there is no scheme to
 * inspect — which means the validation has to be positive (does this match a
 * hostname?) rather than negative (does this start with something bad?). A
 * blocklist would let `javascript:alert(1)` through the moment somebody wrote
 * the check as "not http".
 */
export function deploymentDomainUrl(domain: string | null | undefined): string | null {
  if (typeof domain !== 'string') return null;
  const trimmed = domain.trim();
  if (!trimmed || trimmed.length > 253) return null;
  if (!DOMAIN_PATTERN.test(trimmed)) return null;
  return `https://${trimmed}`;
}

// =============================================================================
// Certificate expiry — a verdict, not a colour
// =============================================================================

/**
 * How close a certificate is to expiring, before anything decides how to draw
 * it.
 *
 *   `unknown` — no `certNotAfter`, or one this code cannot parse.
 *   `expired` — already past.
 *   `expiring` — inside {@link CERT_EXPIRY_WARNING_DAYS}.
 *   `ok`      — further out than that.
 */
export type CertExpiryLevel = 'unknown' | 'expired' | 'expiring' | 'ok';

export interface CertExpiry {
  level: CertExpiryLevel;
  /** Whole days until expiry; NEGATIVE once past. `null` when `level` is `unknown`. */
  days: number | null;
}

/**
 * Thirty days, matching the window every ACME client renews inside. A
 * certificate with less than a month left on an admin console is a thing
 * somebody should look at, and one with more is not news.
 */
export const CERT_EXPIRY_WARNING_DAYS = 30;

const MS_PER_DAY = 86_400_000;

/**
 * Classify a certificate's expiry against `now`.
 *
 * `now` is a PARAMETER, like `formatRelativeTime`'s, so the verdict a test
 * asserts is not a function of the day the suite runs, and so the page's chip
 * and its text are judged against the same instant.
 *
 * A LEVEL RATHER THAN A COLOUR, deliberately. The page turns this into an icon
 * AND a sentence, because "the red one" is not information for a reader using a
 * screen reader or one of the several kinds of colour vision that cannot tell
 * this app's warning orange from its ordinary text.
 */
export function certExpiry(
  certNotAfter: string | null | undefined,
  now: Date = new Date(),
): CertExpiry {
  if (typeof certNotAfter !== 'string' || certNotAfter.trim() === '') {
    return { level: 'unknown', days: null };
  }

  const expiresAt = new Date(certNotAfter).getTime();
  if (Number.isNaN(expiresAt)) return { level: 'unknown', days: null };

  // Rounded toward negative infinity so "23 hours left" is 0 days rather than
  // 1: a certificate that dies this evening must not read as having a day.
  const days = Math.floor((expiresAt - now.getTime()) / MS_PER_DAY);

  if (days < 0) return { level: 'expired', days };
  if (days <= CERT_EXPIRY_WARNING_DAYS) return { level: 'expiring', days };
  return { level: 'ok', days };
}

// =============================================================================
// Formatting
// =============================================================================

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

/**
 * Human-readable memory. `null`/non-finite renders as an em dash rather than
 * "0 B", because a size that was never reported is not a size of zero.
 *
 * Local to this module rather than imported from `dbBackupTable.tsx`: that one
 * takes the API's DECIMAL STRING byte counts (a `BigInt` column published as a
 * string), and `memoryBytes` here is a plain JSON number. Widening one to take
 * both would make the string case silently accept a number that has already
 * lost precision.
 */
export function formatMemoryBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;

  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${BYTE_UNITS[unit]}`;
}

/** The first 7 characters of a commit sha — what every forge shows. */
export function shortCommitSha(sha: string | null | undefined): string {
  if (typeof sha !== 'string' || sha === '') return '—';
  return sha.slice(0, 7);
}

/** `install` / `update`, as a reader should see them. */
export const DEPLOYMENT_COMMAND_LABELS: Record<DeploymentCommand, string> = {
  install: 'Install',
  update: 'Update',
};

/**
 * What the API told us about a missing record, as a sentence.
 *
 * ⚠ NONE OF THESE IS AN ERROR MESSAGE, and none of them is phrased as one. A
 * deployment that was not installed by `appctl deploy` is the ordinary case for
 * a development stack; a state file that exists but is not mounted into the API
 * container is a deployment detail, not a fault in the application. An
 * administrator arriving here during an incident must not be told the page is
 * broken when it is working perfectly and simply has nothing to report.
 */
export const DEPLOYMENT_SOURCE_REASONS: Record<DeploymentSourceReason, string> = {
  'not-found':
    'No deployment state file was found. This deployment was not installed by ' +
    '`appctl deploy`, or the state file is not mounted into the API container.',
  unreadable:
    'A deployment state file exists, but this API process could not read it. ' +
    'Check that the file is mounted into the API container and readable by it.',
  invalid:
    'A deployment state file was found, but its contents could not be understood. ' +
    'It may be from a newer version of `appctl`, or it may have been edited by hand.',
};
