import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { UsageError } from '../errors.js';
import { confirm, type PromptContext } from '../prompt.js';
import type { runCommand } from './executor.js';
import type { DeployHooks } from './hooks.js';
import {
  CONTAINER_CERT_ROOT,
  CONTAINER_WEBROOT,
  DEFAULT_PROXY_CONTAINER,
} from './proxy.js';

// =============================================================================
// Standing the shared proxy up, ONCE, on a box that has none  (issue #391)
// =============================================================================
//
// docs/deployment/vps.md has told operators since #168 that "if this is the
// first app ever deployed to this box, `install` bootstraps this for you".
// Nothing implemented it: the `proxy-root` check simply failed as `required`
// and the install stopped, which is a documented promise the tool did not keep.
//
// THE ONE RULE THIS MODULE IS BUILT AROUND: AN EXISTING PROXY ROOT IS NEVER
// TOUCHED. It belongs to whichever application got there first, and the entire
// multi-app model rests on that - a second install rewriting the compose file,
// the default server block or the mounts underneath a proxy that is already
// serving somebody else's site takes every one of those sites down, and does it
// at the moment a completely unrelated deployment ran. So the existence of the
// directory is the whole test, and the answer to "it exists" is to skip. Not to
// merge, not to repair, not to "fix" a file that looks wrong: those are all
// decisions about another application's infrastructure that this tool has no
// standing to make.
//
// IT IS ALSO THE ONE PLACE THE DEPLOY TOOL PROVISIONS HOST INFRASTRUCTURE, and
// the only thing in the whole design that binds a public port. That is why it
// asks first, and why the non-interactive path needs a flag stating it out
// loud rather than inheriting a default.
//
// THE MOUNT POINTS ARE IMPORTED, NEVER RETYPED. `CONTAINER_CERT_ROOT` and
// `CONTAINER_WEBROOT` are the paths every vhost this tool renders and every
// certbot argv it builds already assume. A proxy bootstrapped with different
// ones would produce an install where each half is internally consistent and
// the two disagree - which is #389 exactly, reintroduced from the other end.
// =============================================================================

/**
 * The proxy's compose file.
 *
 * `compose.yml`, the name Compose v2 prefers; it is found with no `-f` when the
 * working directory is the proxy root, which is how every call here invokes it.
 */
export const PROXY_COMPOSE_FILE = 'compose.yml';

/**
 * The default server block, named so it sorts first in `conf.d`.
 *
 * nginx applies `default_server` to whichever block declares it, not to the
 * first one loaded, so the numeric prefix is for the human reading `ls`, not
 * for nginx.
 */
export const PROXY_DEFAULT_CONF = '000-default.conf';

/** Marks the files this module wrote, and nobody else's. */
export const BOOTSTRAP_MARKER = '# Managed by appctl deploy (proxy bootstrap).';

/**
 * The box-wide network the proxy project owns.
 *
 * Created here because it is part of the host infrastructure this bootstrap is
 * responsible for, and because a stack that would rather be reached by
 * container name than by a loopback port has nowhere to attach without it.
 * STATED PLAINLY: the nginx service below runs in the HOST network namespace
 * and therefore does not join this network itself - see `renderProxyCompose`
 * for why it has to.
 */
export const PROXY_NETWORK = 'proxy';

/** Pinned rather than floating: an unattended `up -d` must be reproducible. */
export const PROXY_IMAGE = 'nginx:1.27-alpine';

/** Directories the rest of this package addresses, relative to the proxy root. */
export const PROXY_DIRECTORIES = [
  join('nginx', 'conf.d'),
  join('nginx', 'snippets'),
  'letsencrypt',
  'webroot',
] as const;

export interface ProxyBootstrapOptions {
  proxyRoot: string;
  runCommand: typeof runCommand;
  hooks?: DeployHooks | undefined;
  /** States the answer up front; required under --non-interactive. */
  bootstrapProxy?: boolean | undefined;
  nonInteractive?: boolean | undefined;
  promptContext?: PromptContext | undefined;
  /** Container name to write into the compose file. */
  container?: string | undefined;
  networkName?: string | undefined;
  /** Asks the question; injected by the tests. Defaults to `confirm`. */
  confirm?: ((question: string) => Promise<boolean>) | undefined;
}

export type BootstrapOutcome = 'created' | 'exists' | 'declined';

export interface BootstrapResult {
  outcome: BootstrapOutcome;
  /** One line for the journal and the hooks. Never a secret. */
  detail: string;
  proxyRoot: string;
}

/**
 * Renders the proxy's compose project.
 *
 * `network_mode: host`, AND THAT IS LOAD-BEARING RATHER THAN LAZY. Every vhost
 * `renderVhost` produces proxies to `http://127.0.0.1:<bindPort>`, because
 * `vps.compose.yml` binds the application's own nginx to loopback and nothing
 * else. Inside a bridge-networked container, `127.0.0.1` is that container's
 * own loopback and the application is unreachable: the config renders, nginx
 * validates it, the reload succeeds, and every request 502s. Sharing the host's
 * network namespace is what makes the rendered vhost mean what it says, and it
 * is also what publishes 80 and 443 - there is deliberately no `ports:` list,
 * because in this mode one would be ignored.
 *
 * The certificates are mounted READ-ONLY. certbot writes them through its own
 * `docker run -v` (see `issueCertificate`), so nginx needs no write access to
 * the tree it serves from, and a proxy that cannot modify its own certificates
 * is one fewer way for a compromised edge to matter.
 */
export function renderProxyCompose(options?: {
  container?: string | undefined;
  image?: string | undefined;
}): string {
  const container = options?.container ?? DEFAULT_PROXY_CONTAINER;

  return `${BOOTSTRAP_MARKER}
# The shared reverse proxy for every application on this host.
#
# It is NOT part of any application's repository: it outlives each of them, and
# each of them writes one file into nginx/conf.d. Edit it by hand if you need
# to - appctl only ever creates this project, and never modifies one it finds.

services:
  nginx:
    image: ${options?.image ?? PROXY_IMAGE}
    container_name: ${container}
    restart: unless-stopped
    # The host's network namespace. Every vhost written here proxies to
    # 127.0.0.1:<port>, which is where each application binds; a bridge
    # network would make that address the container's own loopback and every
    # request would 502 against a configuration that looks correct.
    network_mode: host
    volumes:
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - ./nginx/snippets:/etc/nginx/snippets:ro
      - ./letsencrypt:${CONTAINER_CERT_ROOT}:ro
      - ./webroot:${CONTAINER_WEBROOT}:ro
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
`;
}

/**
 * The default server block: answers the ACME challenge, and nothing else.
 *
 * SERVED OVER PLAIN HTTP ON PURPOSE, and never redirected to HTTPS. Renewal
 * uses the same webroot challenge as issuance, so a blanket redirect here
 * breaks every future renewal on the box - the failure that shows up sixty
 * days later, on a host whose files all still look right.
 *
 * Everything else gets 444 (close without a response) rather than a page: this
 * block is what a request for an unknown name, or for the server's bare IP,
 * lands on, and answering those with anything at all only invites more.
 */
export function renderDefaultServer(): string {
  return `${BOOTSTRAP_MARKER}
# The default vhost. Each application writes its own <domain>.conf beside this.

server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    # Left on plain HTTP deliberately: certbot renews through this same
    # webroot, and redirecting it would break every renewal on this host.
    location /.well-known/acme-challenge/ {
        root ${CONTAINER_WEBROOT};
    }

    # An unknown hostname, or a bare-IP request. Closed without a response.
    location / {
        return 444;
    }
}
`;
}

/** True when this box already has a shared proxy that is not ours to touch. */
export function proxyRootPresent(proxyRoot: string): boolean {
  return existsSync(proxyRoot);
}

/**
 * Creates the shared docker network when it is missing.
 *
 * `inspect` then `create`, rather than `create` and swallowing the "already
 * exists" error: the second shape cannot tell that failure apart from a daemon
 * that refused for any other reason, and quietly continuing past the latter is
 * how an install ends up reporting success over infrastructure that was never
 * made.
 */
export async function ensureSharedNetwork(options: {
  runCommand: typeof runCommand;
  cwd: string;
  name?: string | undefined;
}): Promise<'created' | 'exists'> {
  const name = options.name ?? PROXY_NETWORK;

  const present = await options
    .runCommand(['docker', 'network', 'inspect', name], {
      cwd: options.cwd,
      timeoutMs: 30_000,
    })
    .then(() => true)
    .catch(() => false);

  if (present) return 'exists';

  await options.runCommand(['docker', 'network', 'create', name], {
    cwd: options.cwd,
    timeoutMs: 60_000,
  });
  return 'created';
}

/** Writes a file only when its content would change. Reports whether it did. */
function writeIfChanged(path: string, contents: string): boolean {
  if (existsSync(path) && readFileSync(path, 'utf8') === contents) return false;
  writeFileSync(path, contents, { mode: 0o644 });
  return true;
}

/**
 * Stands up the shared proxy, if and only if this box has none.
 *
 * Idempotent in the only sense that matters here: the second call finds the
 * directory and stops, having run nothing and written nothing.
 */
export async function bootstrapProxy(
  options: ProxyBootstrapOptions,
): Promise<BootstrapResult> {
  const { proxyRoot } = options;

  if (proxyRootPresent(proxyRoot)) {
    // The whole rule, in one branch. See the header: this directory belongs to
    // whichever application got here first.
    return {
      outcome: 'exists',
      detail: `${proxyRoot} already exists; leaving it exactly as it is`,
      proxyRoot,
    };
  }

  const approved = await approve(options);
  if (!approved) {
    return {
      outcome: 'declined',
      detail: `${proxyRoot} was not created`,
      proxyRoot,
    };
  }

  options.hooks?.onProgress?.(`Creating the shared proxy at ${proxyRoot}`);

  for (const directory of PROXY_DIRECTORIES) {
    mkdirSync(join(proxyRoot, directory), { recursive: true });
  }

  writeIfChanged(
    join(proxyRoot, PROXY_COMPOSE_FILE),
    renderProxyCompose({
      ...(options.container === undefined ? {} : { container: options.container }),
    }),
  );
  writeIfChanged(
    join(proxyRoot, 'nginx', 'conf.d', PROXY_DEFAULT_CONF),
    renderDefaultServer(),
  );

  await ensureSharedNetwork({
    runCommand: options.runCommand,
    cwd: proxyRoot,
    ...(options.networkName === undefined ? {} : { name: options.networkName }),
  });

  // No `-f`: the file is `compose.yml` in this working directory, which is
  // what Compose v2 looks for unaided.
  await options.runCommand(['docker', 'compose', 'up', '-d'], {
    cwd: proxyRoot,
    timeoutMs: 10 * 60_000,
    ...(options.hooks?.onLog === undefined
      ? {}
      : { onLine: (line: string) => options.hooks?.onLog?.(line) }),
  });

  return {
    outcome: 'created',
    detail: `created and started the shared proxy at ${proxyRoot}`,
    proxyRoot,
  };
}

/**
 * Asks before provisioning host infrastructure.
 *
 * `--non-interactive` NEVER PROMPTS - it fails instead, naming the flag. An
 * unattended run that silently binds ports 80 and 443 on a server is not a
 * default anybody should be able to get without saying so.
 */
async function approve(options: ProxyBootstrapOptions): Promise<boolean> {
  if (options.bootstrapProxy === true) return true;

  if (options.nonInteractive === true) {
    throw new UsageError(
      `There is no shared reverse proxy at ${options.proxyRoot}. Pass --bootstrap-proxy to have this install create one (it binds ports 80 and 443 on this server), or create it yourself and re-run.`,
    );
  }

  const ask =
    options.confirm ??
    ((question: string) =>
      confirm(
        question,
        // Destructive-by-default convention: provisioning host infrastructure
        // is not something a stray Enter should do.
        { defaultValue: false },
        options.promptContext,
      ));

  return await ask(
    `No shared reverse proxy at ${options.proxyRoot}. Create one now? It binds ports 80 and 443 on this server.`,
  );
}
