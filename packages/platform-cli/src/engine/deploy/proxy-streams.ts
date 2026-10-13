import { UsageError } from '../errors.js';
import { createCliRegistry } from '../../core/index.js';

// =============================================================================
// App routes the shared host proxy must not buffer  (PP-14.22)
// =============================================================================
//
// The shared host proxy (`renderVhost`) carries three platform SSE locations
// with buffering off and a long timeout. Everything else falls under
// `location /`: buffered, cut at 60 seconds. An app's own streaming route
// (an SSE chat answer, say) works through the inner nginx
// (`infra/nginx/app.d/locations`) but is buffered and cut at the edge, because
// the edge vhost has never heard of it.
//
// An app now declares its routes - `createCli({ proxy: { streamPaths } })`,
// `registerProxyStreamPath`, or `ProxyTarget.streamPaths` /
// `extraLocations` for a caller that builds the target itself - and
// `renderVhost` adds one location per route with the same directives as the
// platform's SSE locations.
//
// THE PATH GOES INTO AN NGINX CONFIG THAT THE WHOLE SERVER SHARES, so it is
// validated hard (`assertValidProxyPath`): a leading `/`, a short allowlist of
// URL characters, and nothing nginx treats as syntax (whitespace, quotes, `;`,
// `{`, `}`, `$`, `#`, backslash, a newline). A rejected path never reaches the
// config; a malformed vhost breaks `nginx -t` for every site on the box.
// =============================================================================

/**
 * The timeout a stream route gets unless it names one: an hour, like the notification stream.
 *
 * @stability experimental
 */
export const DEFAULT_STREAM_TIMEOUT_SECONDS = 3600;

/** The longest timeout a route may ask for: a day. */
export const MAX_PROXY_TIMEOUT_SECONDS = 86_400;

/**
 * One extra location of the host-proxy vhost.
 *
 * @stability experimental
 */
export interface ProxyExtraLocation {
  /** URL path prefix, starting with `/`; validated by {@link assertValidProxyPath}. */
  path: string;
  /** `proxy_read_timeout` and `proxy_send_timeout`, in whole seconds (1 to 86400). */
  timeoutSeconds: number;
  /** `false` renders `proxy_buffering off` (a stream); `true` keeps the proxy's buffering. */
  buffering: boolean;
}

/**
 * A stream route an app registers.
 *
 * @stability experimental
 */
export interface ProxyStreamPathRegistration {
  /** URL path prefix, starting with `/`. */
  path: string;
  /** Read and send timeout in seconds. Default {@link DEFAULT_STREAM_TIMEOUT_SECONDS}. */
  timeoutSeconds?: number | undefined;
}

/** A path nginx can carry verbatim: a leading `/`, then URL-safe characters only. */
const SAFE_PATH = /^\/[A-Za-z0-9._~/:@+,=-]*$/;

/**
 * The platform's own SSE locations, which an app route must not redeclare.
 *
 * @stability experimental
 */
export const PLATFORM_STREAM_PATHS: readonly string[] = Object.freeze([
  '/api/notifications/stream',
  '/api/ai/responses/stream',
  '/api/admin/telemetry/assistant/stream',
]);

/**
 * Throws unless `path` is safe to write into an nginx `location` line.
 *
 * @param path - The candidate URL path prefix.
 * @throws UsageError naming the path and the rule it broke.
 * @stability experimental
 */
export function assertValidProxyPath(path: string): void {
  if (typeof path !== 'string' || path === '') {
    throw new UsageError('A proxy stream path must be a non-empty string starting with "/".');
  }
  const shown = JSON.stringify(path);
  if (!path.startsWith('/')) {
    throw new UsageError(`Proxy path ${shown} must start with "/".`);
  }
  if (path === '/') {
    throw new UsageError('Proxy path "/" is the catch-all location the vhost already has; name the streaming route itself.');
  }
  if (path.length > 200) {
    throw new UsageError(`Proxy path ${shown.slice(0, 40)}... is longer than 200 characters.`);
  }
  if (!SAFE_PATH.test(path)) {
    throw new UsageError(
      `Proxy path ${shown} contains a character that is not allowed in a vhost location ` +
        '(whitespace, quotes, ";", "{", "}", "$", "#", backslash and control characters are refused). ' +
        'Use letters, digits and . _ ~ / : @ + , = - only.',
    );
  }
  if (path.includes('//') || path.split('/').some((segment) => segment === '..')) {
    throw new UsageError(`Proxy path ${shown} must not contain "//" or ".." segments.`);
  }
}

/**
 * Throws unless the location is renderable.
 *
 * @param location - The candidate location.
 * @throws UsageError on a bad path, a non-integer or out-of-range timeout, or a non-boolean `buffering`.
 * @stability experimental
 */
export function assertValidExtraLocation(location: ProxyExtraLocation): void {
  assertValidProxyPath(location.path);
  const { timeoutSeconds } = location;
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > MAX_PROXY_TIMEOUT_SECONDS) {
    throw new UsageError(
      `Proxy path ${JSON.stringify(location.path)}: timeoutSeconds must be a whole number from 1 to ${MAX_PROXY_TIMEOUT_SECONDS}.`,
    );
  }
  if (typeof location.buffering !== 'boolean') {
    throw new UsageError(`Proxy path ${JSON.stringify(location.path)}: buffering must be true or false.`);
  }
}

/** Normalises a registration (a bare string or an object) to an extra location. */
export function streamPathToLocation(entry: string | ProxyStreamPathRegistration): ProxyExtraLocation {
  const registration = typeof entry === 'string' ? { path: entry } : entry;
  return {
    path: registration.path,
    timeoutSeconds: registration.timeoutSeconds ?? DEFAULT_STREAM_TIMEOUT_SECONDS,
    buffering: false,
  };
}

const registry = createCliRegistry<ProxyExtraLocation>({
  name: 'proxy stream path',
  registerFn: 'registerProxyStreamPath',
  idOf: (entry) => entry.path,
  validate: (entry) => {
    assertValidExtraLocation(entry);
    if (PLATFORM_STREAM_PATHS.includes(entry.path)) {
      throw new UsageError(`Proxy path "${entry.path}" is one of the platform's own stream locations; it is already unbuffered.`);
    }
  },
});

/**
 * Declares an app route the VPS host proxy must stream: no buffering and a long
 * timeout, with the same directives as the platform's own SSE locations.
 *
 * The path is validated before it is stored (a leading `/`, URL-safe
 * characters only) because it is written into a vhost shared by every
 * application on the server. Routes registered here are rendered for every
 * target; a caller building a `ProxyTarget` itself can add more with
 * `streamPaths` / `extraLocations`.
 *
 * @param entry - The path prefix, or the path with a `timeoutSeconds` (default one hour).
 * @throws UsageError on an invalid path or timeout, a path the platform already streams.
 * @throws Error on a duplicate path, or after `createCli` built the CLI.
 * @stability experimental
 * @extensionPoint registry
 * @example
 * ```ts
 * registerProxyStreamPath('/api/coach/chat/stream');
 * registerProxyStreamPath({ path: '/api/coach/report/stream', timeoutSeconds: 600 });
 * ```
 */
export function registerProxyStreamPath(entry: string | ProxyStreamPathRegistration): void {
  registry.register(streamPathToLocation(entry));
}

/**
 * The stream routes registered so far, in registration order.
 *
 * @returns A frozen copy.
 * @stability experimental
 */
export function listRegisteredProxyStreamPaths(): readonly ProxyExtraLocation[] {
  return registry.list();
}

/** Refuses later registrations; `createCli` calls it. */
export function freezeProxyStreamRegistry(by: string): void {
  registry.freeze(by);
}

/** Empties the registry. Tests only. */
export function resetProxyStreamRegistryForTests(): void {
  registry.reset();
}

/**
 * Every extra location of a target: its `streamPaths`, its `extraLocations`
 * and the registry's, deduplicated by path (first wins) and validated.
 *
 * @param target - The `streamPaths` and `extraLocations` of a proxy target.
 * @returns The locations to render after the platform's own.
 * @throws UsageError when any path or timeout is invalid.
 * @internal
 */
export function resolveExtraLocations(target: {
  streamPaths?: readonly string[] | undefined;
  extraLocations?: readonly ProxyExtraLocation[] | undefined;
}): ProxyExtraLocation[] {
  const all: ProxyExtraLocation[] = [
    ...(target.streamPaths ?? []).map((path) => streamPathToLocation(path)),
    ...(target.extraLocations ?? []),
    ...registry.list(),
  ];
  const seen = new Set<string>(PLATFORM_STREAM_PATHS);
  const out: ProxyExtraLocation[] = [];
  for (const location of all) {
    assertValidExtraLocation(location);
    if (seen.has(location.path)) continue;
    seen.add(location.path);
    out.push({ path: location.path, timeoutSeconds: location.timeoutSeconds, buffering: location.buffering });
  }
  return out;
}

/**
 * One location block, with the directives of the platform's SSE locations
 * (`buffering: false`) or the catch-all's (`buffering: true`).
 *
 * @internal
 */
export function renderExtraLocation(location: ProxyExtraLocation, bindPort: number): string {
  const { path, timeoutSeconds, buffering } = location;
  const lines = [
    `    # App route ${buffering ? '(buffered)' : '(streamed: unbuffered, long-lived)'}, declared by the application.`,
    `    location ${path} {`,
    `        proxy_pass http://127.0.0.1:${bindPort};`,
    '        proxy_http_version 1.1;',
    '',
    '        proxy_set_header Host              $host;',
    '        proxy_set_header X-Real-IP         $remote_addr;',
    '        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;',
    '        proxy_set_header X-Forwarded-Proto https;',
  ];
  if (buffering) {
    lines.push(
      '        proxy_set_header X-Forwarded-Host  $host;',
      '',
      '        proxy_connect_timeout 60s;',
      `        proxy_send_timeout    ${timeoutSeconds}s;`,
      `        proxy_read_timeout    ${timeoutSeconds}s;`,
    );
  } else {
    lines.push(
      "        proxy_set_header Connection        '';",
      '',
      '        proxy_buffering off;',
      '        proxy_cache off;',
      '        chunked_transfer_encoding off;',
      `        proxy_read_timeout ${timeoutSeconds}s;`,
      `        proxy_send_timeout ${timeoutSeconds}s;`,
    );
  }
  lines.push('    }');
  return lines.join('\n');
}
