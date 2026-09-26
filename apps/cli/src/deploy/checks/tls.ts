import type { Check, CheckContext, CheckResult } from './types.js';
import { contextFs, contextServedCertificate } from './types.js';

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

    const timer = await context
      .runCommand(['systemctl', 'is-enabled', 'certbot.timer'], {
        cwd: process.cwd(),
        timeoutMs: 15_000,
      })
      .then(() => true)
      .catch(() => false);

    if (timer) return { status: 'pass', detail: 'certbot.timer is enabled' };

    const cron = contextFs(context).exists('/etc/cron.d/certbot');
    if (cron) return { status: 'pass', detail: '/etc/cron.d/certbot' };

    return {
      status: 'warn',
      detail: 'no renewal timer or cron entry found',
      // A certificate nobody renews is a 90-day timer on an outage.
      remedy: 'Set up automatic renewal, or the site breaks 90 days from issuance with no warning.',
    };
  },
};

/** `<proxyRoot>/letsencrypt/renewal/*.conf`, as HOST paths. */
function renewalConfs(context: CheckContext): string[] {
  const dir = `${context.proxyRoot}/letsencrypt/renewal`;
  return contextFs(context)
    .readdir(dir)
    .filter((name) => name.endsWith('.conf'))
    .sort()
    .map((name) => `${dir}/${name}`);
}

/**
 * Renewal configs a dockerised `certbot renew` can actually follow.
 *
 * A certificate issued by a HOST certbot with `--config-dir <proxyRoot>/...`
 * records host paths in its renewal config. The dockerised certbot sees the
 * same directory mounted at /etc/letsencrypt, cannot resolve them, and reports
 * "expected /etc/letsencrypt/live/<domain>/cert.pem to be a symlink" -- the
 * certificate silently stops renewing, and the first symptom is an expired
 * certificate ninety days later. This turns that into a doctor failure today.
 *
 * Container mode only: in host mode the host paths are the right paths.
 * Required only when there is a renewal config to judge, which is what
 * `severityFor` says; with none, there is nothing that can stop renewing.
 */
const certificateRenewalPaths: Check = {
  id: 'certificate-renewal-paths',
  title: 'Renewal configs use container paths',
  severity: 'recommended',
  severityFor: (context) =>
    context.proxyRuntime?.mode === 'container' && renewalConfs(context).length > 0
      ? 'required'
      : 'recommended',
  async run(context) {
    if (context.proxyRuntime?.mode !== 'container') {
      return {
        status: 'skip',
        detail:
          context.proxyRuntime === undefined
            ? 'proxy runtime unknown'
            : 'the proxy runs on the host, so host paths are correct',
      };
    }

    const confs = renewalConfs(context);
    if (confs.length === 0) {
      return { status: 'skip', detail: 'no renewal configs yet' };
    }

    const hostRoot = `${context.proxyRoot.replace(/\/+$/, '')}/`;
    const fs = contextFs(context);
    const offending = confs.filter((path) => fs.readFile(path)?.includes(hostRoot) === true);

    if (offending.length === 0) {
      return { status: 'pass', detail: `${confs.length} renewal config(s) use container paths` };
    }

    const domains = offending.map((path) => path.slice(path.lastIndexOf('/') + 1, -'.conf'.length));
    return {
      status: 'fail',
      detail: `${offending.length} renewal config(s) record host paths under ${hostRoot}: ${domains.join(', ')}`,
      remedy:
        `A dockerised certbot renew cannot follow these, so the certificate will silently stop renewing. ` +
        `Rewrite them to the paths certbot sees inside the container: ` +
        `sed -i -e 's#${hostRoot}letsencrypt#/etc/letsencrypt#g' -e 's#${hostRoot}webroot#/var/www/certbot#g' ${context.proxyRoot}/letsencrypt/renewal/*.conf ` +
        `-- then confirm with: docker run --rm -v ${context.proxyRoot}/letsencrypt:/etc/letsencrypt -v ${context.proxyRoot}/webroot:/var/www/certbot certbot/certbot:latest renew --dry-run. ` +
        `Future certificates are issued by the dockerised certbot (no --config-dir/--work-dir/--logs-dir), which records container paths.`,
    };
  },
};

/** How far apart two expiries may be and still be the same certificate. */
const SAME_CERTIFICATE_TOLERANCE_MS = 60_000;

/**
 * The certificate the proxy SERVES, against the one on disk.
 *
 * A renewed certificate on disk is not a served certificate: nginx reads it
 * when it loads its configuration, so until the proxy reloads it keeps serving
 * the old one -- right up to its expiry, on a server whose files all look
 * fine. The gap between the two is a reload that did not happen.
 */
const certificateServed: Check = {
  id: 'certificate-served',
  title: 'Served certificate is current',
  severity: 'recommended',
  requires: ['certificate-present'],
  async run(context) {
    if (context.domain === undefined) {
      return { status: 'skip', detail: 'no domain given' };
    }

    const path = livePath(context, 'fullchain.pem');
    if (!contextFs(context).exists(path)) {
      return { status: 'skip', detail: 'no certificate on disk yet' };
    }

    let onDisk: Date;
    try {
      const result = await context.runCommand(
        ['openssl', 'x509', '-enddate', '-noout', '-in', path],
        { cwd: process.cwd(), timeoutMs: 15_000 },
      );
      const raw = /notAfter=(.+)/.exec(result.stdout)?.[1]?.trim();
      onDisk = new Date(raw ?? '');
      if (Number.isNaN(onDisk.getTime())) {
        return { status: 'skip', detail: 'could not read the on-disk expiry' };
      }
    } catch {
      return { status: 'skip', detail: 'openssl is not available to read the on-disk expiry' };
    }

    let served: Date;
    try {
      served = (await contextServedCertificate(context)(context.domain)).notAfter;
    } catch (error) {
      // Not this check's question: whether the site is reachable at all is
      // what the DNS and port checks answer.
      return {
        status: 'skip',
        detail: `could not read the served certificate: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const gap = onDisk.getTime() - served.getTime();
    if (Math.abs(gap) <= SAME_CERTIFICATE_TOLERANCE_MS) {
      return { status: 'pass', detail: `serving the on-disk certificate (expires ${onDisk.toISOString()})` };
    }

    const runtime = context.proxyRuntime;
    const reload =
      runtime?.mode === 'container'
        ? `docker exec ${runtime.container} nginx -t && docker exec ${runtime.container} nginx -s reload`
        : 'nginx -t && nginx -s reload';

    if (gap > 0) {
      return {
        status: 'warn',
        detail: `the proxy serves a certificate expiring ${served.toISOString()}, but the one on disk expires ${onDisk.toISOString()}`,
        remedy: `A renewal was not followed by a reload. Reload the proxy: ${reload}`,
      };
    }

    return {
      status: 'warn',
      detail: `the served certificate expires ${served.toISOString()}, AFTER the one on disk (${onDisk.toISOString()})`,
      remedy: `Something other than this proxy may be answering for ${context.domain} (a CDN, or DNS pointing elsewhere). Check where it resolves.`,
    };
  },
};

export const TLS_CHECKS: readonly Check[] = [
  certificatePresent,
  certificateValidity,
  certificateRenewal,
  certificateRenewalPaths,
  certificateServed,
];
