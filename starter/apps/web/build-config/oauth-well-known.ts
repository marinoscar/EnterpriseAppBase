/**
 * The OAuth server's well-known documents in the Vite dev server (PP-15.6).
 *
 * In the dev stack nginx publishes `/.well-known/oauth-*` from its platform
 * fragment (`infra/nginx/platform/oauth-server.conf`); an app that has not opted
 * into that fragment (the starter) reaches this server for those paths through
 * nginx's `location /`, so the same mappings are here: the dev server answers
 * the root documents by proxying to the API's `/api/oauth/.well-known/...`, and
 * `/.well-known/openid-configuration` with a JSON `404` (this server is not an
 * OpenID provider), never the SPA's `index.html`.
 *
 * Config-side code, like `app-version.ts`: the React tree never imports it.
 */
import type { Plugin, ProxyOptions } from 'vite';

const AUTHORIZATION_SERVER = '/.well-known/oauth-authorization-server';
const PROTECTED_RESOURCE = '/.well-known/oauth-protected-resource';
const OPENID_CONFIGURATION = '/.well-known/openid-configuration';

/** The API path a root well-known path is served from, or `null` when the path is not one of ours. */
export function wellKnownApiPath(url: string): string | null {
  const query = url.indexOf('?');
  const path = query === -1 ? url : url.slice(0, query);
  const search = query === -1 ? '' : url.slice(query);
  if (path === AUTHORIZATION_SERVER || path.startsWith(`${AUTHORIZATION_SERVER}/`)) {
    return `/api/oauth/.well-known/authorization-server${search}`;
  }
  if (path === PROTECTED_RESOURCE || path.startsWith(`${PROTECTED_RESOURCE}/`)) {
    return `/api/oauth/.well-known/protected-resource${path.slice(PROTECTED_RESOURCE.length)}${search}`;
  }
  return null;
}

/** Whether a path is `/.well-known/openid-configuration` or beneath it. */
export function isOpenIdConfigurationPath(url: string): boolean {
  const path = url.split('?')[0] ?? '';
  return path === OPENID_CONFIGURATION || path.startsWith(`${OPENID_CONFIGURATION}/`);
}

/**
 * `server.proxy` entries for the two proxied documents. `target` is the API.
 *
 * @param target - the API origin.
 */
export function wellKnownProxy(target: string): Record<string, ProxyOptions> {
  const entry: ProxyOptions = {
    target,
    changeOrigin: true,
    // The first match of the longer key wins in Vite's list; both keys rewrite through the same function.
    rewrite: (path) => wellKnownApiPath(path) ?? path,
  };
  return { [AUTHORIZATION_SERVER]: entry, [PROTECTED_RESOURCE]: entry };
}

/** A dev-server middleware: `/.well-known/openid-configuration` is a JSON 404, not the SPA. */
export function openIdConfigurationNotFound(): Plugin {
  return {
    name: 'openid-configuration-not-found',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!isOpenIdConfigurationPath(request.url ?? '')) {
          next();
          return;
        }
        response.statusCode = 404;
        response.setHeader('Content-Type', 'application/json');
        response.end('{"error":"not_found","error_description":"This server is not an OpenID provider; use /.well-known/oauth-authorization-server."}');
      });
    },
  };
}
