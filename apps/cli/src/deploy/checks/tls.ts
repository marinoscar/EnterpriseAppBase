import type { Check, CheckContext, CheckFs, CheckResult } from './types.js';
import {
  contextFs,
  contextProxyRuntime,
  contextReadDir,
  contextReadFile,
  realFs,
} from './types.js';

// =============================================================================
// The certificate, if there is one yet  (issue #177, epic #168)
// =============================================================================
//
// NONE OF THESE ARE REQUIRED, and "no certificate" is a normal PASS on a first
// install - issuing one is what install is for. They exist so a re-run reports
// a known state rather than silently reissuing, and so an expiry creeping up
// is visible before it is an outage.
// =============================================================================

const WARN_WITHIN_DAYS = 30;

// =============================================================================
// ...AND TWO THAT ARE ABOUT THE CONTAINERISED PROXY  (issue #389, epic #388)
// =============================================================================
//
// Both failures below are SILENT ones: the site keeps serving for weeks, and
// then stops. `certificate-renewal-paths` catches a renewal configuration that
// records host paths a containerised `certbot renew` cannot follow (it fails
// with "expected /etc/letsencrypt/live/<d>/cert.pem to be a symlink"), and
// `certificate-served` catches a renewal that succeeded while nothing reloaded
// the proxy, so nginx is still holding the previous certificate in memory.
// =============================================================================

function livePath(context: CheckContext, file: string): string {
  return `${context.proxyRoot}/letsencrypt/live/${context.domain ?? ''}/${file}`;
}

/** Reads `notAfter=...` from `openssl x509 -enddate`. Exported for its test. */
export function parseNotAfter(output: string, now: Date): CheckResult {
  const match = /notAfter=(.+)/.exec(output);
  const raw = match?.[1]?.trim();

  if (raw === undefined) {
    return {
      status: 'warn',
      detail: 'could not read the certificate expiry',
      remedy: 'Check by hand: openssl x509 -enddate -noout -in <cert.pem>',
    };
  }

  const expiry = new Date(raw);
  if (Number.isNaN(expiry.getTime())) {
    return {
      status: 'warn',
      detail: `unrecognised expiry: ${raw}`,
      remedy: 'Check by hand: openssl x509 -enddate -noout -in <cert.pem>',
    };
  }

  const days = Math.floor((expiry.getTime() - now.getTime()) / 86_400_000);

  if (days < 0) {
    return {
      status: 'warn',
      detail: `expired ${-days} day(s) ago`,
      remedy: 'Renew it: certbot renew. Until then the site serves an invalid certificate.',
    };
  }
  if (days <= WARN_WITHIN_DAYS) {
    return {
      status: 'warn',
      detail: `expires in ${days} day(s)`,
      remedy: 'Renew it, and check that the renewal timer is actually running.',
    };
  }
  return { status: 'pass', detail: `valid for ${days} more day(s)` };
}

const certificatePresent: Check = {
  id: 'certificate-present',
  title: 'Certificate',
  severity: 'recommended',
  async run(context) {
    if (context.domain === undefined) {
      return { status: 'skip', detail: 'no domain given' };
    }

    const exists = contextFs(context).exists(livePath(context, 'fullchain.pem'));
    return exists
      ? { status: 'pass', detail: `already issued for ${context.domain}` }
      : {
          // Not a failure: on a first install this is the expected state and
          // issuing one is exactly what install does next.
          status: 'pass',
          detail: `none yet for ${context.domain}; install will request one`,
        };
  },
};

const certificateValidity: Check = {
  id: 'certificate-validity',
  title: 'Certificate validity',
  severity: 'recommended',
  requires: ['certificate-present'],
  async run(context) {
    if (context.domain === undefined) {
      return { status: 'skip', detail: 'no domain given' };
    }

    const path = livePath(context, 'cert.pem');
    if (!contextFs(context).exists(path)) {
      return { status: 'skip', detail: 'no certificate to inspect yet' };
    }

    try {
      // Read from disk rather than by making a TLS connection, so this works
      // before the vhost is live.
      const result = await context.runCommand(
        ['openssl', 'x509', '-enddate', '-noout', '-in', path],
        { cwd: process.cwd(), timeoutMs: 15_000 },
      );
      return parseNotAfter(result.stdout, new Date());
    } catch {
      return {
        status: 'skip',
        detail: 'openssl is not available to read the expiry',
      };
    }
  },
};

// =============================================================================
// WHO OWNS RENEWAL  (issue #390, epic #388)
// =============================================================================
//
// Until #390 this check knew two mechanisms: a systemd `certbot.timer` and
// `/etc/cron.d/certbot`. On the target server neither exists - renewal is a
// single script covering EVERY certificate on the box, scheduled from root's
// crontab - so the check reported "no renewal timer or cron entry found"
// against a server whose certificates renew perfectly well.
//
// That false warning is worse than a missing check, because the obvious
// response to it is to install a second schedule against the same
// certificates. Two renewers racing on one `letsencrypt/live` tree is a real
// failure mode, and doctor would have invited it.
//
// THE RESULT IS AN OWNER, NOT A BOOLEAN. Issue #391's install pipeline reads
// this to decide whether to schedule anything of its own, and "something
// already owns this" is the answer that stops it. The check itself has no
// second implementation: it calls `findRenewalOwner` and formats whatever
// comes back, so the thing doctor reports and the thing install consumes
// cannot drift apart.
// =============================================================================

/** How renewal is scheduled on this host. */
export type RenewalMechanism = 'systemd-timer' | 'cron-d' | 'central-script';

export interface RenewalOwner {
  mechanism: RenewalMechanism;
  /** The unit or path that owns it. A name or a path; never a secret. */
  reference: string;
  /** One line, for a check detail or an install log. */
  description: string;
}

/**
 * Where a host-wide renewal script conventionally lives.
 *
 * THESE ARE VALUES, NOT A PRODUCT ASSUMPTION - the same reason `repo.ts` names
 * no repository. A fork that keeps its renewal script somewhere else is not
 * broken; it simply falls through to the warning, exactly as a server with no
 * renewal at all does, and nothing here silently assumes a vendor's layout.
 * `<proxyRoot>/renew-certs.sh` is appended at probe time, because the shared
 * proxy directory is the one location that moves with the deployment.
 */
export const RENEWAL_SCRIPT_PATHS: readonly string[] = [
  '/usr/local/bin/renew-certs.sh',
  '/usr/local/sbin/renew-certs.sh',
  '/opt/infra/renew-certs.sh',
];

/** Only what `findRenewalOwner` needs, so #391 can call it without a full context. */
export type RenewalProbeContext = Pick<CheckContext, 'runCommand' | 'proxyRoot'> & {
  fs?: CheckFs | undefined;
};

/** True when a live (uncommented) crontab line invokes `path`. */
function crontabInvokes(crontab: string, path: string): boolean {
  return crontab
    .split('\n')
    // A commented-out entry schedules nothing. Treating one as an owner would
    // report renewal as handled by a line that has been disabled, which is the
    // single most expensive way for this check to be wrong.
    .some((line) => !line.trimStart().startsWith('#') && line.includes(path));
}

/**
 * The mechanism that owns certificate renewal on this host, if any.
 *
 * Read-only throughout: `systemctl is-enabled` queries, `crontab -l` lists, and
 * the script itself is only stat'ed. Nothing is installed, enabled or written.
 */
export async function findRenewalOwner(
  context: RenewalProbeContext,
): Promise<RenewalOwner | undefined> {
  const fs = context.fs ?? realFs;

  const timer = await context
    .runCommand(['systemctl', 'is-enabled', 'certbot.timer'], {
      cwd: process.cwd(),
      timeoutMs: 15_000,
    })
    .then(() => true)
    .catch(() => false);

  if (timer) {
    return {
      mechanism: 'systemd-timer',
      reference: 'certbot.timer',
      description: 'certbot.timer is enabled',
    };
  }

  if (fs.exists('/etc/cron.d/certbot')) {
    return {
      mechanism: 'cron-d',
      reference: '/etc/cron.d/certbot',
      description: '/etc/cron.d/certbot',
    };
  }

  // A script on disk is not a schedule. BOTH halves are required - the file has
  // to exist AND something has to run it - because a leftover script nobody
  // calls is precisely the state that looks like renewal and is not.
  const candidates = [...RENEWAL_SCRIPT_PATHS, `${context.proxyRoot}/renew-certs.sh`];
  const present = candidates.filter((path) => fs.exists(path));
  if (present.length === 0) return undefined;

  const crontab = await context
    .runCommand(['crontab', '-l'], { cwd: process.cwd(), timeoutMs: 15_000 })
    .then((result) => result.stdout)
    // No crontab at all exits non-zero; so does having no permission to read
    // one. Neither is an owner, and neither is an error worth reporting here.
    .catch(() => '');

  const scheduled = present.find((path) => crontabInvokes(crontab, path));
  if (scheduled === undefined) return undefined;

  return {
    mechanism: 'central-script',
    reference: scheduled,
    description: `${scheduled}, scheduled from root's crontab`,
  };
}

const certificateRenewal: Check = {
  id: 'certificate-renewal',
  title: 'Automatic renewal',
  severity: 'recommended',
  requires: ['certificate-present'],
  async run(context) {
    if (context.domain === undefined) {
      return { status: 'skip', detail: 'no domain given' };
    }
    if (!contextFs(context).exists(livePath(context, 'fullchain.pem'))) {
      return { status: 'skip', detail: 'nothing to renew yet' };
    }

    const owner = await findRenewalOwner(context);
    if (owner !== undefined) {
      return { status: 'pass', detail: owner.description };
    }

    return {
      status: 'warn',
      detail: 'no renewal timer, cron entry or scheduled renewal script found',
      // A certificate nobody renews is a 90-day timer on an outage.
      remedy: 'Set up automatic renewal, or the site breaks 90 days from issuance with no warning.',
    };
  },
};

/** The first PEM block in a blob of text. Exported for its test. */
export function extractPem(text: string): string | undefined {
  const match = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/.exec(text);
  return match?.[0];
}

/** Whitespace-insensitive comparison; openssl re-wraps what it prints. */
function samePem(left: string, right: string): boolean {
  return left.replace(/\s+/g, '') === right.replace(/\s+/g, '');
}

/**
 * Compares the certificate the proxy is serving with the one on disk.
 *
 * IDENTITY, NOT DATES, and deliberately. certbot only ever writes forward, so
 * "the served leaf is not the one on disk" already means the on-disk one is the
 * newer of the two and nothing picked it up - and answering that needs no
 * ASN.1 parsing of a certificate this CLI has no way to decode (there is no
 * shell, so `s_client | x509` is not available, and `runCommand` has no stdin
 * to feed a second openssl with).
 *
 * Exported for its test.
 */
export function compareServedCertificate(
  served: string,
  onDisk: string,
  reloadCommand: string,
): CheckResult {
  const servedPem = extractPem(served);
  const diskPem = extractPem(onDisk);

  if (servedPem === undefined || diskPem === undefined) {
    // Never a fail: not being able to read one of them says nothing about the
    // deployment, only about this probe.
    return { status: 'skip', detail: 'could not read a certificate to compare' };
  }

  return samePem(servedPem, diskPem)
    ? { status: 'pass', detail: 'the proxy is serving the certificate on disk' }
    : {
        status: 'warn',
        detail: 'the proxy is serving a different certificate from the one on disk',
        remedy: `A renewal wrote a new certificate and nothing reloaded the proxy, so nginx is still holding the old one in memory until it restarts. Reload it: ${reloadCommand}`,
      };
}

const certificateRenewalPaths: Check = {
  id: 'certificate-renewal-paths',
  title: 'Renewal config paths',
  // Required, because the symptom is an expiry 60 days from now with nothing
  // reporting it in between - the class of problem doctor exists for.
  severity: 'required',
  async run(context) {
    if (context.domain === undefined) {
      return { status: 'skip', detail: 'no domain given' };
    }
    if (!contextFs(context).exists(livePath(context, 'fullchain.pem'))) {
      return { status: 'skip', detail: 'no certificate has been issued yet' };
    }

    const runtime = await contextProxyRuntime(context);
    if (runtime.mode === 'host') {
      // Host mode has one path space, so recording the proxy root is correct
      // there and this check has nothing to say.
      return { status: 'pass', detail: 'host certbot; the recorded paths are this host\'s' };
    }

    const directory = `${context.proxyRoot}/letsencrypt/renewal`;
    const configs = contextReadDir(context)(directory).filter((name) =>
      name.endsWith('.conf'),
    );

    if (configs.length === 0) {
      return {
        status: 'skip',
        detail: `no renewal configuration in ${directory}`,
      };
    }

    const read = contextReadFile(context);
    const offenders = configs.filter((name) =>
      (read(`${directory}/${name}`) ?? '').includes(context.proxyRoot),
    );

    if (offenders.length === 0) {
      return {
        status: 'pass',
        detail: `${configs.length} renewal config(s) use the container's own paths`,
      };
    }

    return {
      status: 'fail',
      detail: `${offenders.join(', ')} record host paths under ${context.proxyRoot}`,
      remedy: `A containerised certbot resolves ${runtime.certRoot}, not ${context.proxyRoot}, so \`certbot renew\` fails with "expected ${runtime.certRoot}/live/<domain>/cert.pem to be a symlink" and renewal stops silently. Rewrite those paths to the container's view, or delete the renewal config and re-issue.`,
    };
  },
};

const certificateServed: Check = {
  id: 'certificate-served',
  title: 'Served certificate is current',
  severity: 'recommended',
  requires: ['certificate-present'],
  async run(context) {
    if (context.domain === undefined) {
      return { status: 'skip', detail: 'no domain given' };
    }

    const path = livePath(context, 'cert.pem');
    if (!contextFs(context).exists(path)) {
      return { status: 'skip', detail: 'no certificate to compare against yet' };
    }

    const onDisk = contextReadFile(context)(path);
    if (onDisk === undefined) {
      return { status: 'skip', detail: `could not read ${path}` };
    }

    // 127.0.0.1 rather than the public name: this asks what THIS proxy is
    // holding, which a public lookup could answer from somewhere else
    // entirely. -servername keeps SNI right so the vhost under test is picked.
    const served = await context
      .runCommand(
        [
          'openssl', 's_client',
          '-connect', '127.0.0.1:443',
          '-servername', context.domain,
        ],
        { cwd: process.cwd(), timeoutMs: 15_000 },
      )
      .then((result) => result.stdout)
      .catch(() => undefined);

    if (served === undefined) {
      // A server that cannot reach its own 443 - a firewall, a proxy bound
      // elsewhere, no openssl - must not make doctor fail. Rule 3.
      return { status: 'skip', detail: 'could not read the certificate being served on 443' };
    }

    const runtime = await contextProxyRuntime(context);
    const reload =
      runtime.container === undefined
        ? 'nginx -s reload'
        : `docker exec ${runtime.container} nginx -s reload`;

    return compareServedCertificate(served, onDisk, reload);
  },
};

export const TLS_CHECKS: readonly Check[] = [
  certificatePresent,
  certificateValidity,
  certificateRenewal,
  certificateRenewalPaths,
  certificateServed,
];
