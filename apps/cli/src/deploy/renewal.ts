import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { findRenewalOwner, type CheckFs, type RenewalOwner } from './checks/index.js';
import type { runCommand } from './executor.js';
import type { DeployHooks } from './hooks.js';
import {
  CERTBOT_IMAGE,
  CONTAINER_CERT_ROOT,
  CONTAINER_WEBROOT,
  DEFAULT_PROXY_CONTAINER,
  type ProxyRuntime,
} from './proxy.js';

// =============================================================================
// Making sure something renews the certificate  (issue #391, epic #388)
// =============================================================================
//
// A certificate nobody renews is a ninety-day timer on an outage, and it is the
// quietest failure in this whole epic: everything works, for two months.
//
// TWO HALVES, AND THE SECOND ONE IS THE ONE PEOPLE FORGET.
//
//   RENEW. `certbot renew` writes a new certificate into letsencrypt/live.
//   RELOAD. nginx holds its certificate IN MEMORY. A renewal that writes a new
//     file and reloads nothing leaves the OLD certificate being served until
//     the process happens to restart - on a server whose files all look
//     correct, whose `openssl x509 -enddate` on disk reads perfectly fine, and
//     which is nonetheless serving an expired certificate to every visitor.
//     That is exactly what `certificate-served` (#390) detects, and this is
//     what stops it happening.
//
// AND THE RULE THAT DECIDES WHETHER WE DO ANYTHING AT ALL: IF SOMETHING
// ALREADY OWNS RENEWAL, WE DO NOTHING. Not "add ours as well" - two schedules
// against one letsencrypt/live tree is not redundancy, it is two processes
// renewing the same certificates and spending a rate-limit budget that Let's
// Encrypt counts PER REGISTERED DOMAIN, shared with every other subdomain on
// the box. The answer comes from `findRenewalOwner`, which doctor's
// `certificate-renewal` check calls too - one probe, one answer, no second
// implementation that could disagree with the report an operator was shown.
// =============================================================================

/**
 * Where the entry is written.
 *
 * The path `findRenewalOwner` already recognises as a cron-d owner, chosen
 * deliberately: an entry somewhere else would renew the certificates perfectly
 * well while `doctor` went on reporting "no renewal timer, cron entry or
 * scheduled renewal script found", and the obvious response to that warning is
 * to install a second schedule - the exact thing this module exists to avoid.
 * We only ever CREATE this file, never overwrite one we found, because a file
 * that is already there makes `findRenewalOwner` report an owner and we stand
 * down before reaching the write.
 */
export const RENEWAL_CRON_PATH = '/etc/cron.d/certbot';

/**
 * Twice a day, at an odd minute.
 *
 * Twice because a renewal window is 30 days wide and a single daily attempt
 * makes one missed run (a reboot, a busy host) matter more than it should.
 * The odd minute is the convention certbot's own packaging follows: every
 * client on earth attempting renewal at midnight is a load spike Let's Encrypt
 * has asked people not to create.
 */
export const RENEWAL_SCHEDULE = '17 3,15 * * *';

export const RENEWAL_MARKER = '# Managed by appctl deploy (certificate renewal).';

export type RenewalAction = 'stood-down' | 'installed' | 'unchanged' | 'failed';

export interface RenewalResult {
  action: RenewalAction;
  /** One line for the journal and the hooks. Never a secret. */
  detail: string;
  /** The mechanism already responsible, when one was found. */
  owner?: RenewalOwner | undefined;
  path?: string | undefined;
}

export interface RenewalOptions {
  proxyRoot: string;
  /** The proxy as this deployment addresses it; decides which command runs. */
  runtime: ProxyRuntime;
  runCommand: typeof runCommand;
  hooks?: DeployHooks | undefined;
  /** Injected by the tests, and by any caller that has already probed. */
  fs?: CheckFs | undefined;
  /** Where to write. Defaults to RENEWAL_CRON_PATH. */
  cronPath?: string | undefined;
}

/**
 * Anything that would change the meaning of a crontab line.
 *
 * A path with a space in it silently splits into two arguments; a `%` is
 * cron's own newline escape and truncates the command. Both are refused rather
 * than quoted: a proxy root this tool cannot express in a cron line is one the
 * operator should know about now, not the first time renewal was due.
 */
const CRON_UNSAFE = /[^A-Za-z0-9_@+=:,./-]/;

export function isCronSafePath(path: string): boolean {
  return path !== '' && !CRON_UNSAFE.test(path);
}

/**
 * The command the entry runs: renew, then validate, then reload.
 *
 * `--quiet` because cron mails anything a job prints, and a twice-daily "no
 * certificates are due for renewal" email teaches an operator to filter the
 * one message that matters.
 *
 * NO `--webroot`/`-w` ON RENEW, deliberately. certbot recorded the webroot per
 * certificate at issuance time, and this box's proxy is shared: forcing one
 * webroot here would override the recorded one for every OTHER application's
 * certificate too, and break precisely the renewals this tool did not issue.
 *
 * The reload is chained with `&&` so it runs only after a successful renewal
 * AND a successful `nginx -t`. Reloading a proxy whose configuration does not
 * validate is how one application's bad night becomes every application's.
 */
export function renderRenewalCommand(options: {
  proxyRoot: string;
  runtime: ProxyRuntime;
}): string {
  const { proxyRoot, runtime } = options;

  if (runtime.mode === 'container') {
    const container = runtime.container ?? DEFAULT_PROXY_CONTAINER;
    // The same image and the same two mounts `issueCertificate` uses, imported
    // rather than retyped: a renewal that mounts the tree somewhere else finds
    // no renewal configuration and quietly does nothing.
    const certbot = [
      'docker run --rm',
      `-v ${join(proxyRoot, 'letsencrypt')}:${CONTAINER_CERT_ROOT}`,
      `-v ${join(proxyRoot, 'webroot')}:${CONTAINER_WEBROOT}`,
      `${CERTBOT_IMAGE} renew --quiet`,
    ].join(' ');

    return `${certbot} && docker exec ${container} nginx -t && docker exec ${container} nginx -s reload`;
  }

  const certbot = [
    'certbot renew --quiet',
    `--config-dir ${runtime.certRoot}`,
    `--work-dir ${join(runtime.certRoot, 'work')}`,
    `--logs-dir ${join(runtime.certRoot, 'logs')}`,
  ].join(' ');

  return `${certbot} && nginx -t && nginx -s reload`;
}

/**
 * The whole file.
 *
 * Deterministic, so a second run produces byte-identical content and the write
 * is skipped - which is what makes `--resume` and a repeated install free.
 *
 * SHELL and PATH are set explicitly: cron's default PATH is famously short
 * (`/usr/bin:/bin`), and `docker` lives in /usr/local/bin on a good number of
 * installations. A renewal entry that cannot find its own binary fails silently
 * twice a day for sixty days.
 */
export function renderRenewalEntry(options: {
  proxyRoot: string;
  runtime: ProxyRuntime;
  schedule?: string | undefined;
}): string {
  const command = renderRenewalCommand(options);

  return `${RENEWAL_MARKER}
# Renews every certificate on this host and RELOADS the shared proxy, because
# nginx holds its certificate in memory: renewing without reloading leaves the
# old one being served until the process restarts.

SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin

${options.schedule ?? RENEWAL_SCHEDULE} root ${command}
`;
}

/**
 * Installs a renewal schedule, unless something already owns renewal.
 *
 * NEVER THROWS. This runs after the site is published and healthy; a server
 * where /etc/cron.d cannot be written (an unprivileged install, a read-only
 * /etc) has a real problem worth reporting, but not one worth turning a
 * successful deployment into a failed one over. The caller reports the result.
 */
export async function ensureRenewal(options: RenewalOptions): Promise<RenewalResult> {
  // The one probe, shared with doctor. NOT re-implemented, and NOT re-run per
  // mechanism: `findRenewalOwner` already knows about the systemd timer, the
  // cron.d entry and the central script, in that order.
  const owner = await findRenewalOwner({
    runCommand: options.runCommand,
    proxyRoot: options.proxyRoot,
    ...(options.fs === undefined ? {} : { fs: options.fs }),
  });

  if (owner !== undefined) {
    // Reported, not silent: "we deliberately did nothing" and "we forgot" look
    // identical in a log that says nothing.
    const detail = `renewal is already handled by ${owner.description}; leaving it alone`;
    options.hooks?.onProgress?.(detail);
    return { action: 'stood-down', detail, owner };
  }

  const path = options.cronPath ?? RENEWAL_CRON_PATH;

  if (!isCronSafePath(options.proxyRoot) || !isCronSafePath(path)) {
    const detail = `${options.proxyRoot} cannot be written into a cron entry safely, so no renewal was scheduled`;
    options.hooks?.onProgress?.(detail);
    return { action: 'failed', detail, path };
  }

  const contents = renderRenewalEntry({
    proxyRoot: options.proxyRoot,
    runtime: options.runtime,
  });

  try {
    if (existsSync(path) && readFileSync(path, 'utf8') === contents) {
      // Identical content at the same path: nothing to do, and nothing to say
      // beyond the fact that it is already there.
      return { action: 'unchanged', detail: `renewal already scheduled in ${path}`, path };
    }

    mkdirSync(dirname(path), { recursive: true });
    // 0644 and no group or world write: cron REFUSES to run a file in
    // /etc/cron.d that is group-writable, and does it without saying so
    // anywhere the operator will look.
    writeFileSync(path, contents, { mode: 0o644 });
  } catch (error) {
    const detail = `could not write ${path} (${error instanceof Error ? error.message : String(error)}); certificates will NOT renew automatically`;
    options.hooks?.onProgress?.(detail);
    return { action: 'failed', detail, path };
  }

  const detail = `scheduled twice-daily renewal in ${path}, with a proxy reload`;
  options.hooks?.onProgress?.(detail);
  return { action: 'installed', detail, path };
}
