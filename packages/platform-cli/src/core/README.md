# `@marinoscar/platform-cli/core`

Stub (PP-4.5, #706): the two registries an app's CLI extends, and the pure helpers behind env-key metadata. #715 completes this README and moves the built-in commands here.

## Purpose and scope

The CLI's rung-2 registries ([Extension Contract](../../../../docs/specs/platform-packages.md#the-extension-contract)):

- **Commands.** `registerCliCommand(fn)` queues a function that adds commands to the host's Commander `program`; the host calls `applyRegisteredCommands(program)` once, after its built-ins.
- **Env-spec fragments.** `registerEnvSpecFragment(fragment)` contributes metadata (secret, essential, generate, autoGenerate, validate, derive, fixed, group, never, allowBlank) for environment keys; `resolveEnvMetadata(key)` and `listEnvSpecFragments()` read it back.
- The `EnvVarMetadata` types and the pure value helpers (`generateValue`, `isPlaceholderValue`, `needsAutoGenerate`, `validateBase64Key32`, `validateEmail`, `validatePort`).

Not in scope: the built-in commands themselves (`init`, `login`, `api`, `config`, `node`, `deploy`) and the TUI, which are still in the reference CLI (#715). A fragment never adds a key: the question list comes from the app's `.env.example`.

## Install and peer dependencies

Part of `@marinoscar/platform-cli`; see the [package README](../../README.md). The command registry types against the peer dependency `commander` (`^14`), so the host and the package share one `Command` class.

## Quick start

```ts
import { applyRegisteredCommands, registerCliCommand } from '@marinoscar/platform-cli/core';

registerCliCommand((program) => program.command('hello').action(() => console.log('hello')));

const program = new Command().exitOverride();
program.command('deploy'); // built-ins first
applyRegisteredCommands(program); // then app commands
```

## Configuration

None. The registries take no options; behaviour is fixed and documented in the catalog below.

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `registerCliCommand` | registry | `registerCliCommand(register: (program: Command) => void): void` | Add an app command to the host CLI; listed after the built-ins, in registration order. A name or alias taken by a built-in, an earlier app command or `help` throws when applied. | experimental | [example](../../../../apps/cli/src/platform-host/examples/hello.command.ts) |
| `registerEnvSpecFragment` | registry | `registerEnvSpecFragment(fragment: EnvSpecFragment): void` | Annotate a set of environment keys the template declares. A duplicate fragment id, or a key another fragment owns, throws naming both owners; nothing is registered. | experimental | [example](../../../../apps/cli/src/platform-host/register.ts) |

Readers and test helpers: `applyRegisteredCommands(program)`, `listRegisteredCommands()`, `resolveEnvMetadata(key)`, `listEnvSpecFragments()`; `resetCommandRegistryForTests()` and `resetEnvSpecRegistryForTests()` are for tests only.

## Data

None. The registries are in-process state; nothing is persisted.

## Permissions and settings

None. A CLI process has no RBAC of its own; the API enforces permissions.

## UI

None. Commands render through the host program's own output.

## Infra

None. Env-spec fragments annotate keys of the app's `infra/compose/.env.example` but add none.

## Observability

None. The registries emit nothing.

## Security notes

- One owner per env key is what keeps a stray fragment entry from un-marking a secret or turning a generated password into a prompt.
- A `secret` key is masked in prompts and redacted from logs by the host; mark every credential.

## Conformance suite

None yet. The registry tests (`command-registry.test.ts`, `env-spec-registry.test.ts`) cover ordering, collisions and reset; #715 ships them as a suite an app runs.

## Upgrade notes

None. First release of the slice.

## Troubleshooting

- `An app command cannot be named "<name>"`: pick another name; built-ins and `help` are reserved.
- `Env key "<KEY>" is defined by env-spec fragment "<a>" and again by "<b>"`: remove the key from one of the two.

## Links

- [Platform packages spec: consumer guide, CLI](../../../../docs/specs/platform-packages.md#cli)
- [Reference CLI README: Extending the CLI from an app](../../../../apps/cli/README.md#extending-the-cli-from-an-app)
