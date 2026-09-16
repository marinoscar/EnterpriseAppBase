import type { Check, CheckContext, CheckResult } from './types.js';
import { contextFs, contextProxyRuntime, contextReadDir, contextReadFile } from './types.js';

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
