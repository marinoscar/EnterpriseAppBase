# CLI (`appctl`)

First-party command-line client for the API. It authenticates with the same
device authorization flow as any other headless client, stores a personal
access token, and then lets you call any API endpoint from a shell — which
matters because this repository is a **baseline**: new endpoints get added
and old ones get renamed constantly, and a CLI that hard-codes a subcommand
per resource goes stale the day it ships. `appctl` has exactly one command
that talks to the API (`api <method> <path>`), so it stays correct against
endpoints that don't exist yet.

Run with no arguments in an interactive terminal and it opens a full-screen
menu (login, call an endpoint, view config, logout) built with
[ink](https://github.com/vadimdemedes/ink). Everything that menu can do is
also a plain subcommand, and the subcommands are what this document covers —
they're what you'd script or run in CI.

## Install and build

There's no published package; you build it from this monorepo and run the
built file directly.

```bash
# from the repo root, after the workspace's node_modules are installed
npm run build --workspace=cli
```

This runs `tsc` against `apps/cli/tsconfig.build.json`, emitting
`apps/cli/dist/`, and marks `dist/cli.js` executable. From there you can run
it straight from the workspace without installing or publishing anything:

```bash
node apps/cli/dist/cli.js --help
```

or, from inside `apps/cli`:

```bash
node dist/cli.js --help
```

If you want the bare `appctl` command on your PATH without publishing, `npm
link` from `apps/cli` (`package.json`'s `bin` field maps `appctl` to
`./dist/cli.js`) does that using the standard npm mechanism.

For iterating on the CLI's own source without rebuilding on every change,
`npm run dev --workspace=cli` runs `tsx src/cli.ts` directly — same behavior,
no build step.

## Logging in

```bash
appctl login
```

This runs the device authorization flow (RFC 8628) — the same "open this URL
and enter this code" flow you'd use for the CLI on a smart TV. It:

1. Requests a device code and user code from the server.
2. Prints a short instruction panel with the verification URL and the code,
   and tries to open your default browser to it (skip that with
   `--no-browser`, which just prints the URL instead).
3. Polls the server until you approve the request in the browser (or it
   expires — RFC 8628's `authorization_pending` / `slow_down` / `expired_token`
   / `access_denied` outcomes all apply).
4. On approval, validates the issued credential against `GET /api/auth/me`
   and saves it — validating before saving means a bad or already-invalid
   credential never overwrites a working one already on disk.

The credential minted here is a **personal access token** (a `pat_...`
string), not a short-lived session JWT — that's what makes it practical to
stay logged in for days between commands. It's stored, along with the server
URL, in `~/.appctl/config.json`. That file is created with `0600`
permissions (owner read/write only) even across restarts and partial
rewrites — see the extensive comment on `writeConfigFile` in
`apps/cli/src/config.ts` if you want the mechanics of how that's guaranteed
under a hostile umask. The token itself is never printed by any command; if
you need to see what's stored, `appctl config` prints the server URL and a
masked hint (`pat_abcd••••••••` — the first eight characters, then a
fixed-width mask) instead.

`login --server <url>` skips the interactive prompt for the server. If you
already have a personal access token (minted from the web UI's Access Tokens
page, or from a previous device-flow login), `login --server <url> --token
pat_...` validates and stores it directly, skipping the device flow entirely
— useful for a one-off headless setup, though prefer the environment
variables below for anything that runs unattended and repeatedly. Passing a
token on the command line puts it in your shell history and in `ps` output
for other users on the machine, which is why the CLI warns about it after a
successful `--token` login.

There is deliberately no `appctl logout` subcommand — logout only exists as
a screen in the interactive menu (`appctl` with no arguments, then choose
Logout). It calls `DELETE /api/pat/{id}` to revoke the token on the server
*before* deleting the local file, on purpose: the PAT this CLI holds is
long-lived, so simply deleting the local copy would leave a fully valid,
unrevoked token that nobody can see is still active. If you're scripting and
need to invalidate a token, revoke it from the web UI's Access Tokens page
(`DELETE /api/pat/{id}` — the same call the TUI makes) — there is no headless
equivalent of the interactive logout.

## Calling the API

```bash
appctl api GET /api/auth/me
```

`api` is the one command that talks to arbitrary endpoints. The response
body goes to stdout and nothing else does — status line, spinner and errors
all go to stderr — so a pipeline sees exactly the server's JSON:

```bash
appctl api GET /api/users --raw | jq '.data[].email'
```

`--raw` prints compact, uncoloured JSON with a trailing newline and nothing
else on stdout; without it, the same body is pretty-printed with colour when
stdout is a terminal. Either way it's the server's response body verbatim —
not the unwrapped `data` field — because a paginated list's `data` +
`pagination` shape and a single resource wrapped by the API's
`TransformInterceptor` as `{ data, meta }` look identical from the outside,
and unwrapping one of them silently drops the pagination info.

Other flags, from `appctl api --help`:

```
Arguments:
  method               HTTP method (GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS)
  path                 Request path, e.g. /api/auth/me

Options:
  --query <key=value>  Query parameter; repeat for more than one
  --data <json>        Request body: inline JSON, @file.json, or - for stdin
  --raw                Print unformatted JSON on stdout and nothing else
  -q, --quiet          Suppress the status line and spinner on stderr
  --no-color           Disable colour even on a terminal
  --timeout <ms>       Per-request timeout in milliseconds
```

The exit code is `0` only for a 2xx response; anything else exits non-zero
with the server's own error message, so `appctl api ... || echo failed` (or
just relying on `set -e`) works the way you'd expect in a script. The `/api`
prefix is optional — `appctl api GET /api/auth/me` and `appctl api GET
/auth/me` request the same thing, since the client's base URL already ends
in `/api`.

## CI usage

In CI there's no browser to complete the device flow in and no persistent
home directory to have logged in from earlier, so skip `login` entirely and
set:

```bash
export APPCTL_SERVER_URL=https://app.example.com
export APPCTL_TOKEN=pat_...
```

The environment always wins over `~/.appctl/config.json` when both are
present, specifically so a pipeline's service token can't be shadowed by
whatever a developer happens to have logged in as on a shared runner.

Create and revoke the token itself from the web UI's **Access Tokens** page
(under user settings) — there's no CLI command to mint a PAT out of thin air
for CI use; the device flow is how the CLI gets one for a human logging in
interactively.

`appctl` also refuses to launch its interactive menu unless stdout and stdin
are both real terminals, `TERM` is set to something other than `dumb`, and
neither `CI` nor `CONTINUOUS_INTEGRATION` is set — so `appctl api ...` in a
pipeline behaves identically whether or not those variables happen to be
set. If you need to force that refusal in an environment that looks like a
terminal but isn't one you want to interact with, set `APPCTL_NO_TUI` to
any truthy value (anything except empty, `0`, `false`, or `no`); every
explicit subcommand ignores this gate entirely and is unaffected by it.

## Renaming this for a fork

Every user-visible identity string this CLI has — the executable name shown
in `--help` and errors, the config directory (`~/.appctl/`), and the
`APPCTL_` environment-variable prefix — is derived from a single constant:

```ts
// apps/cli/src/branding.ts
export const CLI_NAME = 'appctl';
```

Change that one line (see the comment above it in `branding.ts` for the
naming constraints — lowercase ASCII letters, digits and hyphens only, since
it becomes both a filesystem path and part of an environment variable name)
and the config directory, the env var prefix, and every place the CLI refers
to itself by name follow automatically. The one place it can't reach is the
`bin` key in `apps/cli/package.json` — npm reads that before any of this
code runs, so it has to be updated by hand to match, and a test in
`apps/cli/src/branding.test.ts` asserts the two stay in sync.

Note that the env var prefix is `APPCTL_`, not `APP_` — a bare `APP_` prefix
is generic enough to collide with unrelated variables in a shared CI shell,
so the prefix is derived from the (longer, more specific) binary name
instead. If you've seen `APP_SERVER_URL` / `APP_TOKEN` mentioned elsewhere,
that's what it would have been under a shorter, collision-prone prefix;
`APPCTL_SERVER_URL` / `APPCTL_TOKEN` is what the code actually reads.

## Running tests

```bash
npm run test:run --workspace=cli
```
