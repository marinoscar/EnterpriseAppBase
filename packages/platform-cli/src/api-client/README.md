# `@marinoscar/platform-cli/api-client`

The CLI's HTTP client for the platform API: base-URL resolution, bearer auth, the response envelope, a timeout on every call, and typed errors instead of raw `fetch` exceptions. CLI layer; part of `@marinoscar/platform-cli`; re-exports the `engine` slice.

## Purpose and scope

`ApiClient` is what `api`, `login` and the worker use; an app command that calls the API uses it too, so its failures read and exit like theirs (`ApiError` with the server's message, `AuthRequiredError`, `NetworkError` by failure kind). `resolveApiBaseUrl` turns what a human typed (`localhost:3535`) into the API root (`http://localhost:3535/api`).

Not in scope: storing the token (`login`, `~/.<name>/config.json`) and per-endpoint wrappers (the CLI deliberately has none).

## Install and peer dependencies

Ships inside `@marinoscar/platform-cli`:

```ts
import { ApiClient, resolveApiBaseUrl } from '@marinoscar/platform-cli/api-client';
```

None: it uses Node's global `fetch`.

## Quick start

```ts
const client = new ApiClient({ baseUrl: resolveApiBaseUrl('https://app.example.com'), token });
const { data } = await client.get<{ email: string }>('/auth/me');
```

The reference app reaches it through the built-in `api` command ([`cli.ts`](../../../../apps/cli/src/cli.ts)).

## Configuration

`ApiClientOptions`:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `baseUrl` | `string` | required | The API root including `/api` |
| `token` | `string` | none | Bearer token; absent for public routes |
| `timeoutMs` | `number` | `DEFAULT_TIMEOUT_MS` (30 s) | Per-request ceiling |
| `fetch` | `typeof fetch` | global `fetch` | Override for tests |

## Extension-point catalog

None. The client is a library, not an extension point; an app uses it as is.

## Data

None. The slice holds no data model and persists nothing.

## Permissions and settings

None. Requests carry the token's permissions; the API enforces them.

## UI

None.

## Infra

None. The server URL comes from the config file or `<NAME>_SERVER_URL`.

## Observability

None. The client sends a `User-Agent` naming the CLI and its version and emits no telemetry.

## Security notes

- The token goes in `Authorization: Bearer` only, and is never part of a URL, an error message or `formatError` output.
- An error body is kept (`rawBody`) but never printed: in development it can carry a stack trace.

## Conformance suite

None. `api-client.test.ts` in the package pins the URL building, the envelope and the error mapping.

## Upgrade notes

0.x: moved from `apps/cli/src/api-client.ts` (#715), unchanged.

## Troubleshooting

- `404` for a route that exists: the base URL lacks `/api`; use `resolveApiBaseUrl`.
- `NetworkError` (`refused`, `dns`, `tls`, `timeout`): the server is unreachable as named; the kind says which.

## Links

- [Package README](../../README.md)
- [Platform packages spec: worked examples, CLI](../../../../docs/specs/platform-packages.md#cli)
- [Package documentation standard](../../../../docs/PACKAGES.md)
