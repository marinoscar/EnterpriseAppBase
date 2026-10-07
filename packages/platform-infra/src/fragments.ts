// =============================================================================
// The platform's own infra fragments: compose, nginx and env
// =============================================================================
//
// Each is materialised into the app's infra/ by `platform-infra sync`, the
// same mechanism as the telemetry slice (#705): generated files carry a
// header and a checksum in infra/platform-infra.lock.json; app-owned files
// are created once from a package template and never overwritten. The app
// changes the platform through OVERLAYS, never by editing a generated file:
//
//   compose  infra/compose/app.*.compose.yml, appended after the platform
//            files (see compose-order.ts)
//   nginx    infra/nginx/app.d/{http,server,locations}/*.conf and
//            infra/nginx/app.d/permissions-policy.conf
//   env      infra/compose/app.env.example, appended to .env.example
// =============================================================================

import { deepFreeze, type InfraFile, type InfraFragmentFiles } from './fragment.js';

/**
 * A fragment of the platform's own infra: the compose files, the nginx
 * configuration or the env template.
 *
 * @stability experimental
 */
export interface PlatformInfraFragment extends InfraFragmentFiles {
  /** Which part of the platform's infra this is. */
  readonly id: 'compose' | 'nginx' | 'env';
}

const compose = (name: string): InfraFile => ({ from: `compose/${name}`, to: `infra/compose/${name}` });
const nginx = (name: string): InfraFile => ({ from: `nginx/${name}`, to: `infra/nginx/${name}` });

/**
 * The platform's compose files: `base` (nginx, api, web), `dev`, `devdb`,
 * `prod`, `vps` (with the stack agent), `worker`, `worker.build` and `test`.
 * An app changes them with `infra/compose/app.*.compose.yml` overlays, which
 * {@link composeFilesForMode} appends after them.
 *
 * Rendered from the app identity: `OTEL_SERVICE_NAME`'s default in `base`,
 * the CLI name in `vps`'s messages, the worker variables' prefix and default
 * image in `worker`, and the test database's names in `test`.
 *
 * @stability experimental
 */
export const composeInfraFragment: PlatformInfraFragment = deepFreeze({
  id: 'compose',
  extendThrough: 'an infra/compose/app.*.compose.yml overlay',
  files: [
    compose('base.compose.yml'),
    compose('dev.compose.yml'),
    compose('devdb.compose.yml'),
    compose('prod.compose.yml'),
    compose('vps.compose.yml'),
    compose('worker.compose.yml'),
    compose('worker.build.compose.yml'),
    compose('test.compose.yml'),
  ],
  appOwnedFiles: [compose('app.example.compose.yml')],
});

/**
 * The platform's nginx configuration: `nginx.conf` with its include points,
 * the two CSP maps and the `platform/` snippets (`security-headers.conf`,
 * `sse-proxy.conf`). The app owns `app.d/`: `http/`, `server/` and
 * `locations/` (included at those levels; empty is valid) and
 * `permissions-policy.conf` (created from the platform default).
 *
 * @stability experimental
 */
export const nginxInfraFragment: PlatformInfraFragment = deepFreeze({
  id: 'nginx',
  extendThrough: 'infra/nginx/app.d/ (an include point) or a compose overlay',
  files: [
    nginx('nginx.conf'),
    nginx('csp.conf'),
    nginx('csp.dev.conf'),
    nginx('platform/security-headers.conf'),
    nginx('platform/sse-proxy.conf'),
  ],
  appOwnedFiles: [
    nginx('app.d/permissions-policy.conf'),
    { ...nginx('app.d/http/.gitkeep'), keep: true },
    { ...nginx('app.d/server/.gitkeep'), keep: true },
    { ...nginx('app.d/locations/.gitkeep'), keep: true },
  ],
});

/**
 * The env templates: the platform's variables (`env/base.env.example`),
 * followed by the app's own `infra/compose/app.env.example`, become
 * `infra/compose/.env.example`, the one file the deploy wizard, `init` and
 * Compose's `env_file` read. `env/worker.env.example` becomes
 * `infra/compose/.env.worker.example`, rendered with the CLI's env prefix.
 *
 * @stability experimental
 */
export const envInfraFragment: PlatformInfraFragment = deepFreeze({
  id: 'env',
  extendThrough: 'infra/compose/app.env.example (app variables) or a new platform variable in @marinoscar/platform-infra/env/',
  files: [
    { from: 'env/base.env.example', to: 'infra/compose/.env.example', append: 'infra/compose/app.env.example' },
    { from: 'env/worker.env.example', to: 'infra/compose/.env.worker.example' },
  ],
  appOwnedFiles: [{ from: 'env/app.env.example', to: 'infra/compose/app.env.example' }],
});
