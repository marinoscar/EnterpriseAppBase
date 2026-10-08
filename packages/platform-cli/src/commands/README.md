# `@marinoscar/platform-cli/commands`

The platform's built-in commands (`init`, `login`, `api`, `config`, `node`, `deploy`) as registrars, and the error model every command, built-in or an app's, shares: `CliError` and its subclasses map to the documented exit codes in `EXIT`. CLI layer; part of `@marinoscar/platform-cli`; re-exports the `engine` slice (`packages/platform-slices.json`).

## Purpose and scope

`createCli` registers the six built-ins itself, in `--help` order (`BUILTIN_COMMAND_NAMES`); this entry point exists for an app that builds a program of its own, or that wants its command to fail the way a built-in does (throw a `UsageError`, get `EXIT.USAGE`).

Not in scope: adding a command, which is `registerCliCommand` in [`/core`](../core/README.md) (or `createCli({ extraCommands })`); changing a built-in's flags or output, which this package never does in a minor version.

## Install and peer dependencies

Ships inside `@marinoscar/platform-cli`:

```ts
import { EXIT, UsageError, registerApiCommand } from '@marinoscar/platform-cli/commands';
```

None beyond the package's own: the registrars take the app's Commander `program`.

## Quick start

An app command that fails like a built-in (the reference example is [`hello.command.ts`](../../../../apps/cli/src/examples/hello.command.ts)):

```ts
import { UsageError } from '@marinoscar/platform-cli/commands';
import type { CliCommandRegistration } from '@marinoscar/platform-cli/core';

export const greet: CliCommandRegistration = (program) => {
  program.command('greet <who>').action((who: string) => {
    if (who.trim() === '') throw new UsageError('Name someone to greet.'); // exits EXIT.USAGE
    process.stdout.write(`Hello, ${who}!\n`);
  });
};
```

## Configuration

None. The registrars take the program and nothing else; their behaviour is configured by the CLI identity (`createCli`).

## Extension-point catalog

None. The built-ins are not extension points; an app adds commands through `registerCliCommand` in the [core catalog](../core/README.md#extension-point-catalog).

## Data

None. `login` writes the token to `~/.<name>/config.json`; see the [package README](../../README.md#security-notes).

## Permissions and settings

None. A CLI process has no RBAC of its own; the API enforces the permissions of the stored token.

## UI

None in the web app. Command output goes to stdout, everything else (errors, progress, prompts) to stderr, so `api --raw | jq` stays clean.

## Infra

None of its own. `init` and `deploy` read `infra/compose/.env.example` ([package README § Infra](../../README.md#infra)).

## Observability

None. Commands write no telemetry; `deploy` writes its journals ([`/deploy`](../deploy/README.md#observability)).

## Security notes

- Nothing but command output goes to stdout, and every failure exits non-zero (`EXIT`), so a broken step never passes CI.
- `formatError` prints the message only, never a stack or a `cause` (an undici cause can carry request headers, and the CLI's requests carry a bearer token).

## Conformance suite

None. The built-ins' `--help` is pinned by the reference app's `help-snapshot.test.ts`.

## Upgrade notes

0.x: moved from `apps/cli/src/commands/` (#715), flags, output and exit codes unchanged.

## Troubleshooting

- `An app command cannot be named "deploy"`: the six built-in names and `help` are reserved; pick another.

## Links

- [Package README](../../README.md)
- [Platform packages spec: worked examples, CLI](../../../../docs/specs/platform-packages.md#cli)
- [Package documentation standard](../../../../docs/PACKAGES.md)
