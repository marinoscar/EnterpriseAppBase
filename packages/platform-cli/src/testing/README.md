# `@marinoscar/platform-cli/testing`

Helpers for an app's CLI tests and the CLI's conformance suite: reset the identity and the registries between tests, check an executor never leaves a job-scoped credential behind, and run the `cli` suite over the app. CLI layer; part of `@marinoscar/platform-cli`; re-exports the `engine` slice. For tests only: never import it from an app's runtime code.

## Purpose and scope

- `resetCliForTests()`: forget the identity and every registry, so the next `createCli` starts fresh; `useTestCliIdentity(identity)` replaces the identity (set-once otherwise) and returns a restore function; `TEST_CLI_IDENTITY`.
- `checkExecutorCredentialHygiene(executor, options)`: runs an executor once against a fake job whose broker issues a marked credential and reports where it ended up (the node log, the state directory, HOME, the result, the error).
- `runPlatformConformance({ suites: { cli } })`: the CLI's conformance runner. It mirrors `@marinoscar/platform-api/testing`'s, which is CommonJS under Jest and cannot load this ESM package.
- `commentedAssignments`, `composeEnvSpecs`, `PLATFORM_DOCUMENTED_OPTIONAL_KEYS`: the env template checks behind the suite.

## Install and peer dependencies

Ships inside `@marinoscar/platform-cli`:

```ts
import { resetCliForTests, runPlatformConformance } from '@marinoscar/platform-cli/testing';
```

Runs under Vitest or Jest; pass `testApi` (`{ describe, it, expect }`) unless the runner has globals.

## Quick start

The reference app's suite, [`conformance.test.ts`](../../../../apps/cli/src/conformance.test.ts):

```ts
resetCliForTests();
createCli(APP_CLI_OPTIONS); // registers the app's executors
runPlatformConformance({
  suites: {
    cli: {
      envFragments: [
        { name: 'base.env.example', text: read('packages/platform-infra/env/base.env.example'), allowCommented: PLATFORM_DOCUMENTED_OPTIONAL_KEYS },
        { name: 'app.env.example', text: read('infra/compose/app.env.example') },
      ],
    },
  },
  testApi: { describe, it, expect },
});
```

## Configuration

`CliConformanceOptions`:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `envFragments` | `EnvTemplateFragment[]` | required | `{ name, text, allowCommented? }` per fragment |
| `executors` | `JobExecutor[]` | every executor the worker would run | The executors to check |
| `executorOptions` | `Record<type, CredentialHygieneOptions>` | `{}` | Per type: `params`, the credential's `material` and `kind`, `fetchImpl`, `timeoutMs` |

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `runPlatformConformance` | option | `runPlatformConformance(options: CliPlatformConformanceOptions): void` | Prove the app's env fragments and node executors keep the CLI's invariants | experimental | [example](../../../../apps/cli/src/conformance.test.ts) |

Helpers (not extension points): `resetCliForTests`, `useTestCliIdentity`, `TEST_CLI_IDENTITY`, `checkExecutorCredentialHygiene` (example: [`echo.executor.test.ts`](../../../../apps/cli/src/examples/echo.executor.test.ts)), `commentedAssignments`, `composeEnvSpecs`, `PLATFORM_DOCUMENTED_OPTIONAL_KEYS`.

## Data

None. The slice holds no data model and persists nothing.

## Permissions and settings

None.

## UI

None.

## Infra

None. The env fragment case reads the fragments the app passes.

## Observability

None. The credential check writes a node log into a scratch directory it deletes.

## Security notes

The credential check uses a random marker, never a real secret, and answers `fetch` locally (an upload is drained, never sent). It swaps `process.env.HOME`, the state-directory variable and `globalThis.fetch` while the executor runs, so do not run it concurrently with other tests in one process.

## Conformance suite

The `cli` suite, one case each:

- `env fragment <name> declares no commented KEY=value line`: `parseEnvExample` reads such a line as a declared variable, and the deploy wizard would ask for it.
- `executor <type> never persists or logs a job-scoped credential`: CLAUDE.md queue rule 3, through `checkExecutorCredentialHygiene` on a fake job holding a credential.

An unknown suite key throws, so a typo cannot disable a check; `cli: false` opts out visibly.

## Upgrade notes

0.x: first release (#715).

## Troubleshooting

- `No CLI identity is set` from the credential check: build the CLI with `createCli` first (the state-directory variable is identity-prefixed).
- `no global describe/it/expect`: pass `testApi: { describe, it, expect }` from your runner.

## Links

- [Package README](../../README.md)
- [Platform packages spec: worked examples, CLI](../../../../docs/specs/platform-packages.md#cli)
- [Package documentation standard](../../../../docs/PACKAGES.md)
