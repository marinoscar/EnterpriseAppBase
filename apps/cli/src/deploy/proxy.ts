import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { UsageError } from '../errors.js';
import type { runCommand } from './executor.js';
import type { DeployHooks } from './hooks.js';

// =============================================================================
// Publishing the app through the shared proxy  (issue #181, epic #168)
// =============================================================================
//
// The application stack terminates no TLS and, behind vps.compose.yml, binds
// 127.0.0.1 only - it is not reachable from outside the server at all. This
// module is what publishes it on https://<domain>.
//
// THE PROXY IS SHARED, AND THAT IS THE WHOLE DIFFICULTY. A malformed vhost
// written here does not break one application; it breaks `nginx -t` for the
// entire server, and the next reload takes every site down with it. So:
//
//   - The certificate is issued BEFORE the vhost is written. A vhost naming an
//     ssl_certificate that does not exist FAILS nginx -t, which would leave
//     the shared proxy unable to reload for anybody.
//   - The vhost is validated before it is used, and REMOVED AND RE-VALIDATED
//     if validation fails, restoring whatever it overwrote.
//   - Reload, never restart. A restart drops connections for every other
//     application on the box.
//   - A vhost this tool did not write is never touched.
// =============================================================================

// =============================================================================
// TWO PATH SPACES, AND CONFLATING THEM IS THE BUG THIS PREVENTS  (issue #389)
// =============================================================================
//
// The shared proxy is normally a CONTAINER, and certbot is normally run as one
// too. Both of them see the proxy's directories through bind mounts:
//
//     <proxyRoot>/letsencrypt  ->  /etc/letsencrypt
//     <proxyRoot>/webroot      ->  /var/www/certbot
//
// So every path here belongs to exactly one of two spaces, and they are NOT
// interchangeable:
//
//   HOST PATHS - what THIS process can stat, and what `docker run -v` takes on
//     the left of the colon. `livePath()` is the host accessor, and
//     `certificateStatus()` and the TLS checks existsSync() it: correct, because
//     the bytes really are there.
//   SERVED PATHS - what nginx and certbot resolve INSIDE the container.
//     `servedCertPath()` and `ProxyRuntime.webroot` are these, and they are the
//     only paths that may be written into a vhost or into a certbot argv.
//
// Writing a host path where a served path belongs IS issue #389: the ACME
// challenge 404s because `root` names a directory the proxy container does not
// have, nginx cannot load `ssl_certificate`, and `--config-dir <host path>`
// bakes host paths into letsencrypt/renewal/<domain>.conf - after which a
// containerised `certbot renew` fails with "expected
// /etc/letsencrypt/live/<d>/cert.pem to be a symlink" and renewal stops
// silently, which is the expensive half: nothing reports it for 60 days.
//
// In HOST mode the two spaces coincide. That is precisely why the conflation
// survived review - it is invisible on a server with a host nginx and a host
// certbot, and wrong on every other server.
// =============================================================================

export interface ProxyTarget {
  domain: string;
  bindPort: number;
  /** Default /opt/infra/proxy. */
  proxyRoot: string;
}

/** How the shared proxy is operated on this server. */
export type ProxyMode = 'container' | 'host';

/**
 * The proxy as this deployment must address it.
 *
 * `certRoot` and `webroot` are SERVED paths (see the header): the strings that
 * go into the vhost and into certbot's argv. The host side of each mount is
 * always derived from `ProxyTarget.proxyRoot` instead, and never from here.
 */
export interface ProxyRuntime {
  mode: ProxyMode;
  /** Container the proxy runs in. Undefined in host mode. */
  container?: string | undefined;
  /** certbot's --config-dir equivalent, AS NGINX AND CERTBOT SEE IT. */
  certRoot: string;
  /** ACME webroot, AS NGINX AND CERTBOT SEE IT. */
  webroot: string;
}

/** The conventional name; overridable because a fork may name it anything. */
export const DEFAULT_PROXY_CONTAINER = 'proxy-nginx';
export const CONTAINER_CERT_ROOT = '/etc/letsencrypt';
export const CONTAINER_WEBROOT = '/var/www/certbot';

/** Pinned rather than floating: an image is what issues the certificate. */
export const CERTBOT_IMAGE = 'certbot/certbot:latest';

export interface ProxyOptions {
  runCommand: typeof runCommand;
  hooks?: DeployHooks | undefined;
  /**
   * @deprecated Pass `runtime` instead; it carries the container AND the paths
   * that container sees, which is the pair that must not disagree. Still
   * honoured on its own so a caller that only ever wanted `docker exec` works
   * unchanged.
   */
  proxyContainer?: string | undefined;
  /** How the proxy is operated, and the paths it resolves. */
  runtime?: ProxyRuntime | undefined;
  /** Upload cap, matched to MAX_FILE_SIZE so uploads do not 413 at the edge. */
  maxBodyBytes?: number | undefined;
}

export interface CertificateOptions extends ProxyOptions {
  /** Registration address; the admin email is the sensible default. */
  email: string;
  /** Use Let's Encrypt's staging environment. */
  staging?: boolean | undefined;
}

/** A hostname, and nothing that could break out of a config or a command. */
const HOSTNAME = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*$/i;

export function assertValidDomain(domain: string): void {
  // Validated before it reaches a config file OR an argv. Neither is a shell,
  // but a newline in a domain would let a vhost be extended with arbitrary
  // directives, which is the same class of problem.
  if (!HOSTNAME.test(domain)) {
    throw new UsageError(
      `"${domain}" is not a valid hostname, so it will not be written into the proxy configuration.`,
    );
  }
}

export function vhostPath(target: ProxyTarget): string {
  return join(target.proxyRoot, 'nginx', 'conf.d', `${target.domain}.conf`);
}

/**
 * A file in the certificate's live directory, AS A HOST PATH.
 *
 * Deliberately unchanged by #389: this is what `existsSync` must be given, and
 * what `docker run -v` needs on the left of the colon. It is NOT what goes into
 * a config file - `servedCertPath()` is. See the header.
 */
export function livePath(target: ProxyTarget, file: string): string {
  return join(target.proxyRoot, 'letsencrypt', 'live', target.domain, file);
}

/** The same file AS NGINX AND CERTBOT SEE IT. This is the config-safe one. */
export function servedCertPath(
  runtime: ProxyRuntime,
  domain: string,
  file: string,
): string {
  return join(runtime.certRoot, 'live', domain, file);
}

/** Host mode: the two path spaces coincide, so both come off `proxyRoot`. */
export function hostProxyRuntime(target: Pick<ProxyTarget, 'proxyRoot'>): ProxyRuntime {
  return {
    mode: 'host',
    certRoot: join(target.proxyRoot, 'letsencrypt'),
    webroot: join(target.proxyRoot, 'webroot'),
  };
}

/** Container mode: the served paths are the mount points, never `proxyRoot`. */
export function containerProxyRuntime(container: string): ProxyRuntime {
  return {
    mode: 'container',
    container,
    certRoot: CONTAINER_CERT_ROOT,
    webroot: CONTAINER_WEBROOT,
  };
}

export interface ResolveProxyRuntimeOptions {
  runCommand: typeof runCommand;
  /** States the answer and skips the probe. */
  proxyMode?: ProxyMode | undefined;
  /** Container to probe for, and to exec into. Defaults to proxy-nginx. */
  proxyContainer?: string | undefined;
}

/**
 * Works out how the shared proxy is operated here.
 *
 * NEVER THROWS, AND THAT IS THE CONTRACT. `docker` not installed, the daemon
 * unreachable, no such container, the probe timing out - every one of those
 * means "this is not the containerised setup", and a server running a host
 * nginx must not have its install aborted by a probe it never needed. An
 * explicit --proxy-mode always wins, because an operator who states it knows
 * something the probe cannot see.
 */
export async function resolveProxyRuntime(
  target: Pick<ProxyTarget, 'proxyRoot'>,
  options: ResolveProxyRuntimeOptions,
): Promise<ProxyRuntime> {
  const container = options.proxyContainer ?? DEFAULT_PROXY_CONTAINER;

  if (options.proxyMode === 'host') return hostProxyRuntime(target);
  if (options.proxyMode === 'container') return containerProxyRuntime(container);

  const running = await options
    .runCommand(['docker', 'inspect', '--format', '{{.State.Running}}', container], {
      cwd: process.cwd(),
      timeoutMs: 20_000,
    })
    // A stopped container answers `false` and is NOT container mode: exec into
    // it would fail, and there is nothing to reload.
    .then((result) => result.stdout.trim() === 'true')
    .catch(() => false);

  return running ? containerProxyRuntime(container) : hostProxyRuntime(target);
}

/** The runtime a call was given, or host mode derived from the target. */
function runtimeFor(target: Pick<ProxyTarget, 'proxyRoot'>, options: ProxyOptions): ProxyRuntime {
  if (options.runtime !== undefined) return options.runtime;

  // A caller that passed only the older `proxyContainer` has NAMED A
  // CONTAINER, so it means container mode - and falling through to host paths
  // here reproduces #389 through the very field kept for compatibility:
  // `containerFor` would still send `nginx -t` into that container, while the
  // vhost rendered from these same options pointed at host paths the
  // container cannot see. The two helpers must agree on the mode or they
  // recreate the split this module exists to close.
  if (options.proxyContainer !== undefined) {
    return containerProxyRuntime(options.proxyContainer);
  }

  return hostProxyRuntime(target);
}

/** The container to address, from either the runtime or the older field. */
function containerFor(options: ProxyOptions): string | undefined {
  return options.runtime?.container ?? options.proxyContainer;
}

/**
 * Renders the vhost.
 *
 * Deterministic: the same input produces byte-identical output, so re-running
 * an install produces no spurious diff and no needless reload.
 *
 * WHAT IS DELIBERATELY ABSENT: security headers. infra/nginx/nginx.conf
 * already sets HSTS, the CSP, X-Frame-Options and the rest, and nginx's
 * add_header REPLACES the inherited set rather than merging with it - so
 * adding any header here would silently delete the application's CSP.
 *
 * `runtime` is not optional, and that is the point: every path this renders is
 * one nginx must resolve itself, so there is no correct default to fall back on
 * when the caller has not said where nginx is running.
 */
export function renderVhost(
  target: ProxyTarget,
  runtime: ProxyRuntime,
  options?: { maxBodyBytes?: number | undefined },
): string {
  assertValidDomain(target.domain);

  const maxBody = options?.maxBodyBytes;
  const clientMaxBody = maxBody === undefined ? '100m' : `${Math.ceil(maxBody / (1024 * 1024))}m`;

  return `# Managed by appctl deploy. Edits will be overwritten.
# Application: ${target.domain}

server {
    listen 80;
    listen [::]:80;
    server_name ${target.domain};

    # Left served over HTTP on purpose: renewal uses the same webroot
    # challenge, and redirecting it to HTTPS breaks every future renewal.
    location /.well-known/acme-challenge/ {
        root ${runtime.webroot};
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name ${target.domain};

    ssl_certificate     ${servedCertPath(runtime, target.domain, 'fullchain.pem')};
    ssl_certificate_key ${servedCertPath(runtime, target.domain, 'privkey.pem')};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    # Matched to MAX_FILE_SIZE. Without this an upload fails at the edge with
    # a bare 413 that never reaches the application's own limits.
    client_max_body_size ${clientMaxBody};

    # No response headers are set here, deliberately. The application's own
    # nginx already sets HSTS, the CSP and the rest, and nginx REPLACES an
    # inherited header set rather than merging with it - so adding even one
    # here would silently delete all of them.

    location / {
        proxy_pass http://127.0.0.1:${target.bindPort};
        proxy_http_version 1.1;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        # The application forwards $scheme onward, so THIS is the value it
        # ultimately sees. Get it wrong and OAuth callbacks build http:// URLs
        # and the login redirect loops.
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host  $host;

        proxy_connect_timeout 60s;
        proxy_send_timeout    60s;
        proxy_read_timeout    60s;
    }

    # Server-sent events. The application's nginx already disables buffering
    # for this path; without the same treatment at the edge, that care is
    # undone one hop upstream and events arrive in batches or not at all.
    location /api/notifications/stream {
        proxy_pass http://127.0.0.1:${target.bindPort};
        proxy_http_version 1.1;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Connection        '';

        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }
}
`;
}

export interface CertInfo {
  exists: boolean;
  path: string;
}

export function certificateStatus(target: ProxyTarget): CertInfo {
  const path = livePath(target, 'fullchain.pem');
  return { exists: existsSync(path), path };
}

/**
 * Issues a certificate, unless a usable one already exists.
 *
 * Skipping when one exists is not an optimisation: re-issuing on every deploy
 * spends the rate limit (50 certificates per registered domain per week) for
 * nothing, and that limit is per DOMAIN, so it is shared with every other
 * subdomain on the same server.
 */
export async function issueCertificate(
  target: ProxyTarget,
  options: CertificateOptions,
): Promise<{ issued: boolean; path: string }> {
  assertValidDomain(target.domain);

  const status = certificateStatus(target);
  if (status.exists) {
    options.hooks?.onProgress?.(`Certificate for ${target.domain} already exists`);
    return { issued: false, path: status.path };
  }

  const runtime = runtimeFor(target, options);
  const argv =
    runtime.mode === 'container'
      ? [
          // The mounts are the ONLY place a host path may appear: `-v` takes
          // the host side on the left, and certbot never sees either string.
          'docker', 'run', '--rm',
          '-v', `${join(target.proxyRoot, 'letsencrypt')}:${CONTAINER_CERT_ROOT}`,
          '-v', `${join(target.proxyRoot, 'webroot')}:${CONTAINER_WEBROOT}`,
          CERTBOT_IMAGE, 'certonly',
          '--webroot', '-w', CONTAINER_WEBROOT,
          '-d', target.domain,
          '--non-interactive', '--agree-tos', '--no-eff-email',
          '--email', options.email,
          // NO --config-dir/--work-dir/--logs-dir HERE, deliberately. certbot
          // records whatever it is given into renewal/<domain>.conf, so a host
          // path passed once breaks `certbot renew` inside the container from
          // then on - which is issue #389's silent half. The image's defaults
          // already point at /etc/letsencrypt, which is the mount.
          ...(options.staging === true ? ['--staging'] : []),
        ]
      : [
          'certbot', 'certonly',
          '--webroot', '--webroot-path', runtime.webroot,
          '-d', target.domain,
          '--non-interactive', '--agree-tos',
          '--email', options.email,
          // Host mode keeps these: there is one path space, so recording it is
          // correct, and the proxy root is not certbot's default.
          '--config-dir', runtime.certRoot,
          '--work-dir', join(runtime.certRoot, 'work'),
          '--logs-dir', join(runtime.certRoot, 'logs'),
          ...(options.staging === true ? ['--staging'] : []),
        ];

  options.hooks?.onProgress?.(
    `Requesting a certificate for ${target.domain} (${runtime.mode === 'container' ? `${CERTBOT_IMAGE} in docker` : 'host certbot'})`,
  );

  try {
    await options.runCommand(argv, {
      cwd: target.proxyRoot,
      timeoutMs: 5 * 60_000,
      ...(options.hooks?.onLog === undefined
        ? {}
        : { onLine: (line: string) => options.hooks?.onLog?.(line) }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Rate limiting needs its own remedy: the fix is to WAIT, and retrying is
    // what put the operator there in the first place.
    if (/too many certificates|rateLimited|rate limit/i.test(message)) {
      throw new UsageError(
        `Let's Encrypt is rate-limiting this domain. Wait before trying again — retrying now makes it worse. Use --staging while working out the rest of the setup.\n${message}`,
      );
    }
    throw error;
  }

  return { issued: true, path: livePath(target, 'fullchain.pem') };
}

export interface InstallVhostResult {
  path: string;
  changed: boolean;
}

/**
 * Writes, validates and activates the vhost, rolling back on failure.
 *
 * The rollback is the reason this function exists rather than a `writeFileSync`
 * at the call site.
 */
export async function installVhost(
  target: ProxyTarget,
  options: ProxyOptions,
): Promise<InstallVhostResult> {
  assertValidDomain(target.domain);

  const path = vhostPath(target);
  const rendered = renderVhost(target, runtimeFor(target, options), {
    ...(options.maxBodyBytes === undefined ? {} : { maxBodyBytes: options.maxBodyBytes }),
  });

  const existed = existsSync(path);
  const previous = existed ? readFileSync(path, 'utf8') : undefined;

  if (previous === rendered) {
    // Byte-identical, so there is nothing to validate and nothing to reload.
    options.hooks?.onProgress?.(`Vhost for ${target.domain} is already current`);
    return { path, changed: false };
  }

  mkdirSync(join(target.proxyRoot, 'nginx', 'conf.d'), { recursive: true });
  writeFileSync(path, rendered, { mode: 0o644 });

  const validation = await validateProxy(options);
  if (!validation.ok) {
    // Put the proxy back EXACTLY as it was found, then confirm that actually
    // worked before reporting - a rollback that leaves nginx broken is worse
    // than the original failure.
    if (previous === undefined) {
      rmSync(path, { force: true });
    } else {
      writeFileSync(path, previous, { mode: 0o644 });
    }

    const after = await validateProxy(options);
    const restored = after.ok
      ? 'The proxy has been restored and still validates.'
      : 'WARNING: the proxy does not validate even after rolling back; it was already broken before this run.';

    throw new UsageError(
      `The vhost for ${target.domain} did not pass nginx -t, so it was removed.\n${validation.output}\n${restored}`,
    );
  }

  await reloadProxy(options);
  options.hooks?.onProgress?.(`Published ${target.domain}`);

  return { path, changed: true };
}

export interface ValidationResult {
  ok: boolean;
  output: string;
}

/** Runs `nginx -t`, in the container when the proxy is containerised. */
export async function validateProxy(options: ProxyOptions): Promise<ValidationResult> {
  const container = containerFor(options);
  const argv =
    container === undefined
      ? ['nginx', '-t']
      : ['docker', 'exec', container, 'nginx', '-t'];

  try {
    const result = await options.runCommand(argv, { cwd: process.cwd(), timeoutMs: 60_000 });
    return { ok: true, output: `${result.stdout}${result.stderr}`.trim() };
  } catch (error) {
    const failure = error as { result?: { stdout?: string; stderr?: string } };
    return {
      ok: false,
      output:
        `${failure.result?.stdout ?? ''}${failure.result?.stderr ?? ''}`.trim() ||
        (error instanceof Error ? error.message : String(error)),
    };
  }
}

/** Reloads, never restarts: a restart drops every other site's connections. */
export async function reloadProxy(options: ProxyOptions): Promise<void> {
  const container = containerFor(options);
  const argv =
    container === undefined
      ? ['nginx', '-s', 'reload']
      : ['docker', 'exec', container, 'nginx', '-s', 'reload'];

  await options.runCommand(argv, { cwd: process.cwd(), timeoutMs: 60_000 });
}

/** Removes a vhost this tool wrote. Used only to undo a failed install. */
export async function removeVhost(
  target: ProxyTarget,
  options: ProxyOptions,
): Promise<void> {
  const path = vhostPath(target);
  if (!existsSync(path)) return;

  // Only ever a file this tool wrote: the header is the marker, and a vhost
  // without it belongs to somebody else.
  const contents = readFileSync(path, 'utf8');
  if (!contents.startsWith('# Managed by appctl deploy')) {
    throw new UsageError(
      `${path} was not written by appctl, so it will not be removed. Remove it by hand if that is really what you want.`,
    );
  }

  rmSync(path, { force: true });
  const validation = await validateProxy(options);
  if (validation.ok) await reloadProxy(options);
}
