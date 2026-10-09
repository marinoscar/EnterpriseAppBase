# Documenting a platform package

How to document a `@marinoscar/platform-*` package, or a slice inside one, so that `npm run check:package-docs` passes. This is the implementation of the [Package documentation standard](specs/platform-packages.md#package-documentation-standard): a fixed README outline with an extension-point catalog, TSDoc on every export with a stability level, a generated API reference, and reference-app examples linked from the catalog. Documentation drift is a failing build.

Build, test and lint commands for the packages themselves are in [DEVELOPMENT.md § Platform packages](DEVELOPMENT.md#platform-packages).

## Contents

1. [What is checked, and by what](#what-is-checked-and-by-what)
2. [The README](#the-readme)
3. [The Extension-point catalog](#the-extension-point-catalog)
4. [TSDoc](#tsdoc)
5. [TypeDoc and the API reference](#typedoc-and-the-api-reference)
6. [Adding a slice](#adding-a-slice)
7. [Running the checks locally](#running-the-checks-locally)
8. [What a failure means](#what-a-failure-means)
9. [Peer dependencies per slice](#peer-dependencies-per-slice)
10. [Contract conventions](#contract-conventions)

## What is checked, and by what

| Check | Tool | Fails when |
|---|---|---|
| TSDoc syntax | `eslint-plugin-tsdoc` (`tsdoc/syntax`) in [`eslint.config.mjs`](../eslint.config.mjs), run by `npm run lint:packages` | A doc comment in `packages/platform-*/src/**` is malformed or uses a tag that [`tsdoc.json`](../tsdoc.json) does not define |
| TSDoc coverage | TypeDoc validation (`notDocumented`, `notExported`, `invalidLink`) from [`typedoc.base.json`](../typedoc.base.json), run by `npm run docs:packages` | An exported symbol or public member has no TSDoc, an exported signature uses a type that is not exported, or a `{@link}` does not resolve |
| README outline | [`scripts/check-package-docs.mjs`](../scripts/check-package-docs.mjs) | A package or exported-slice README is missing, lacks one of the 15 headings, has them out of order, adds another level-2 heading, or leaves a section empty |
| Stability | `check-package-docs.mjs` | An exported symbol has no `@stability`, or one other than `stable` or `experimental` |
| Catalog completeness | `check-package-docs.mjs` | A symbol tagged `@extensionPoint` is missing from its README's catalog, a row names a symbol that is not exported or not tagged, or a row's Kind or Stability differs from the tags |
| Catalog links | `check-package-docs.mjs` | A row has no Example link, or the link does not resolve to a file in the reference app (`apps/`, `infra/`, `tests/`), or it points into `packages/` |
| Slice entry points | `check-package-docs.mjs` | A slice exported as a subpath is not an entry point in the package's `typedoc.json` |
| Slice peers | [`scripts/check-slice-peers.mjs`](../scripts/check-slice-peers.mjs) (`npm run check:slice-peers`) | A non-test import is not covered by its slice's declared peers, a declared peer is stale or orphaned, or a peer's `optional` flag disagrees with the universal slices ([below](#peer-dependencies-per-slice)) |
| Link check | [`apps/api/test/docs-links.spec.ts`](../apps/api/test/docs-links.spec.ts) (`npm test --workspace=api`) | A relative link in a package or slice README does not resolve |

All of it runs in the `package-docs` job of [`.github/workflows/packages.yml`](../.github/workflows/packages.yml), which also uploads each package's generated reference as the `api-reference` artifact. The TSDoc lint and the slice peer check run in that workflow's `packages` job, the link check in `ci.yml`'s API tests.

## The README

Start from a template:

| Documenting | Copy | To |
|---|---|---|
| A package | [templates/package-README.md](templates/package-README.md) | `packages/platform-<pkg>/README.md` |
| A slice (a subpath export) | [templates/slice-README.md](templates/slice-README.md) | `packages/platform-<pkg>/src/<slice>/README.md` |

Both have the same 15 level-2 headings, in this order: Purpose and scope; Install and peer dependencies; Quick start; Configuration; Extension-point catalog; Data; Permissions and settings; UI; Infra; Observability; Security notes; Conformance suite; Upgrade notes; Troubleshooting; Links.

- The checker compares the text of each `##` heading before any colon, so `## Configuration: forRoot() options` is fine. `###` subsections are free; another `##` heading is not.
- No section is empty. A section with nothing to say contains exactly `None.` plus one sentence why ("None. The package holds schemas of HTTP payloads, not database models.").
- Relative links resolve from the README's own directory, the way GitHub and npm render them. From a package README the repository root is `../../`; from a slice README it is `../../../../`. Put illustrative links inside a fenced code block: both the link check and the checker ignore fences.

The README ships in the npm tarball (`files` in `package.json`), so it is the documentation a consumer reads first.

## The Extension-point catalog

One table, these columns in this order:

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|

| Column | Content |
|---|---|
| Name | The exported name, in backticks; `Class.member` for a member (`DoctorRegistry.register`). A trailing `()` is ignored. |
| Kind | The symbol's `@extensionPoint` value: `option`, `registry`, `token`, `event`, `slot`, `theme-token`, `overlay`, `hook`, `component` or `schema` (a contract schema an app extends with `.extend()`). |
| Signature | The shape an app codes against. Escape a pipe in a union type as `\|`. |
| When to use | One sentence: the situation that calls for this seam rather than another rung of the extension ladder. |
| Stability | The symbol's `@stability` value: `stable` or `experimental`. `internal` symbols are never exported, so never listed. |
| Example | A relative link to a working use in the reference app (`apps/api`, `apps/web`, `apps/cli`, `infra/`, `tests/`), optionally with a `#L<n>` anchor. Never a file under `packages/`: the example proves an app can use the seam from outside. |

The catalog and the tags are kept one to one: every symbol tagged `@extensionPoint` has a row in the README of its entry point (`src/index.ts` → the package README, `src/<slice>/index.ts` and `src/<slice>/<part>/index.ts` → the slice README), and every row names a tagged, exported symbol. A package or slice with no extension point yet writes `None.` and why instead of the table.

## TSDoc

Every exported symbol has a TSDoc comment. The two platform tags are declared in [`tsdoc.json`](../tsdoc.json), which extends TypeDoc's tag set:

| Tag | Where | Value |
|---|---|---|
| `@stability` | Every exported symbol (members inherit their parent's unless they set their own) | `stable` (strict semver; a breaking change needs a major release and a migration guide) or `experimental` (may change in a minor release) |
| `@extensionPoint` | Every seam an app may extend | The catalog Kind |

The rest of the convention:

- A summary sentence first.
- Functions and methods document every parameter (`@param name - meaning`) and the result (`@returns`), and what they throw (`@throws`).
- Options document their default (`@defaultValue`).
- A seam carries a short `@example`.

```ts
/**
 * Adds a check to the report. Throws on a duplicate id.
 *
 * @param check - The check; its `id` must be unique across the application.
 * @stability stable
 * @extensionPoint registry
 * @example
 * ```ts
 * onModuleInit() { this.registry.register(this); }
 * ```
 */
register(check: DoctorCheck): void;
```

`@internal` symbols are left out of the reference (`excludeInternal`); a symbol that needs it should not be exported at all.

## TypeDoc and the API reference

[`typedoc.base.json`](../typedoc.base.json) holds the shared options: validation warnings are errors, every exported declaration kind and public member must be documented, and the two platform block tags are registered. Each package has a `typedoc.json` that extends it:

```json
{
  "extends": ["../../typedoc.base.json"],
  "tsconfig": "tsconfig.build.json",
  "entryPoints": ["src/index.ts"],
  "out": "docs-api",
  "json": "docs-api/api.json"
}
```

`npm run docs:packages` runs TypeDoc in every package (`npm run docs -w <package>` for one). It writes the HTML reference to `packages/platform-<pkg>/docs-api/` and the JSON model to `docs-api/api.json`, which the checker reads. `docs-api/` is generated and gitignored; CI publishes it as the `api-reference` artifact. Hosting it on a website is a later decision.

## Adding a slice

When a slice becomes a subpath export (`"./<slice>"` in the package's `exports`):

1. Copy the slice template to `src/<slice>/README.md`.
2. Append `"src/<slice>/index.ts"` to `entryPoints` in the package's `typedoc.json`.
3. Tag the slice's exports with `@stability`, and its seams with `@extensionPoint`.
4. Add a catalog row per seam, each linking a working use in the reference app.
5. Link the slice README from the package README's Purpose and scope.

A slice may be split into several subpaths (`"./<slice>/<part>"`, for example `./doctor/headless` and `./doctor/ui` in `@marinoscar/platform-web`, #696). Each part is its own `typedoc.json` entry point (`src/<slice>/<part>/index.ts`), and all of them are catalogued in the one slice README, `src/<slice>/README.md`.

## Running the checks locally

From the repository root:

```bash
npm run build:packages          # the packages import each other's built types
npm run lint:packages           # boundary rules + tsdoc/syntax
npm run check:package-docs      # docs:packages (TypeDoc), then scripts/check-package-docs.mjs
npm run check:slice-peers       # per-slice peer dependencies (no build needed)
npm test --workspace=api -- docs-links
```

`node scripts/check-package-docs.mjs --json` prints the problems as a JSON array (`file`, `line`, `message`); `--root <dir>` checks another tree. The checker's own tests are `apps/cli/src/package-docs-script.test.ts` (`npm run test:run --workspace=cli`), the TSDoc lint's are `packages/platform-api/test/tsdoc-lint.spec.ts`.

## What a failure means

Each checker line is `file:line problem`, and the fix is in the file named:

| Message | Fix |
|---|---|
| `missing heading "## X"`, `is out of order`, `unexpected level-2 heading` | Restore the 15 headings from the template, in order; turn the extra heading into a `###` subsection |
| `section "## X" is empty` | Write `None.` and one sentence why |
| `has no @stability tag` (line in `src/`) | Add `@stability stable` or `@stability experimental` to the symbol's TSDoc |
| `is missing from the Extension-point catalog` | Add the row, or remove `@extensionPoint` if it is not a seam |
| `names no exported symbol` | The symbol was renamed or removed: fix or delete the stale row |
| `names an exported symbol without an @extensionPoint tag` | Tag the symbol, or drop the row |
| `has Kind ... but ... says` / `has Stability ... but ... says` | Make the row and the tag agree; changing `stable` is a semver decision, not a typo fix |
| `Example ... does not resolve` / `points into packages/` / `is outside the reference app` | Link a real file in `apps/`, `infra/` or `tests/` that uses the seam |
| `is not in entryPoints` | Append the slice's `index.ts` to `typedoc.json` |
| `docs-api/api.json ... missing` | Run `npm run docs:packages` first (`npm run check:package-docs` does) |
| `[coverage] ... slice 'x' <file> 'y': is imported but is not a declared peer` | Add `y` to the slice's list in `platform-slice-peers.json` and to the package's `peerDependencies` (optional unless a universal slice needs it), or make it a `dependencies` entry |
| `[stale] ... declares 'y'` | The slice no longer imports `y`: delete it from the slice's list (a run-time-loaded peer goes in `$runtime` instead) |
| `[orphan] ... 'y'` | No slice declares or implies `y`: remove it from `peerDependencies`, or declare it on the slice that needs it |
| `[optionality] ... 'y'` | Mark `y` optional in `peerDependenciesMeta`, or remove the flag, as the message says |

A TypeDoc failure (`does not have any documentation`, `is referenced by ... but not included in the documentation`) names the symbol: document it, or export the type it refers to. A `tsdoc/syntax` error names the line of the malformed comment.

## Peer dependencies per slice

A package such as `@marinoscar/platform-api` is one npm package whose slices are subpath exports, so its `peerDependencies` would be the union of what every slice needs. An app that wants only `core`, `otel-core` and `telemetry` must not install Passport, `@nestjs/jwt` and the rest. The rule (#914):

1. **Each slice declares the peers it imports directly.** [`packages/platform-slice-peers.json`](../packages/platform-slice-peers.json) maps `package -> slice -> [peer, ...]`, beside the slice graph [`platform-slices.json`](../packages/platform-slices.json). It is a sibling file, not an extension of the graph, because the ESLint boundary rule reads every key of `platform-slices.json` as a slice list and the two files change for different reasons. Derive a slice's list from its sources, never from memory: `node scripts/check-slice-peers.mjs --derive` prints each slice's direct imports that are peers of the package.
2. **A slice inherits the peers of its declared slice dependencies**, transitively. Declaring `settings -> identity` in the graph means a consumer of `settings` installs what `identity` needs. `node scripts/check-slice-peers.mjs --table` prints what each slice needs installed beyond the required set; the package READMEs carry that table.
3. **Only what the universal slices need is required.** `$universal` names them (`core` for `platform-api` and `platform-web`; `"*"`, every slice, for `platform-contract`). Every other peer is `optional` in `peerDependenciesMeta`. npm does not install an optional peer, so the package READMEs tell the app which to add for which slice.
4. **`$implies`** records a peer of a peer (`@nestjs/common` needs `reflect-metadata` and `rxjs`; `nestjs-zod` needs `zod`; `@nestjs/swagger` needs `@nestjs/core`; `supertest` its `@types/supertest`). Declaring the outer peer covers the inner one, so a slice does not list what it never imports, and the inner peer is not an orphan.
5. **`$runtime`** records a peer loaded by name at run time (`createRequire(...)('pg')` in `platform-db`'s `drift`), which an import scan cannot see. It must still appear as a string literal in the slice's sources.
6. **`<slice>/testing`** (the files under `src/<slice>/testing/`, the slice's separate `./<slice>/testing` entry point) is scanned as a sub-slice that inherits its slice. A test runner or `supertest` declared there never becomes a peer of the slice or of the slices that depend on it. A sub-slice needs an entry only when it adds a peer.
7. **No package imports `@prisma/client`** (a guard test enforces it). `core` reaches Prisma only through `@prisma/client/extension`, which is why `@prisma/client` is a required peer of `platform-api`; every other slice is structural. `platform-db` takes the app's client as a structural type and loads `prisma` and `pg` by name, so it does not list `@prisma/client`, and `prisma` and `pg` are optional peers (the `drift` slice and the `platform db` CLI need them).

`npm run check:slice-peers` enforces it (CI: the `packages` job). For every non-test source file of every slice (a test file is under `__tests__`, `__fixtures__`, `test` or `tests`, or named `*.spec.*`, `*.test.*` or `*.d.ts`; type-only imports count, because the published declarations need them) each bare specifier must be a node builtin, the package itself, one of its `dependencies`, or covered by the slice's effective peers; every declared name must be a `peerDependencies` key, imported by the slice and not stale; every `peerDependencies` key must be declared or implied by some slice; and a peer is required exactly when a universal slice needs it. A failure names the slice, the file and the specifier. The script's tests are `apps/cli/src/slice-peers-script.test.ts`.

**The root export.** A slice is imported by its subpath (`@marinoscar/platform-api/telemetry`). A package's root entry (`.`) is the one place allowed to touch any slice, so an app that imports from the root needs every slice's peers; the root file is checked against the package's whole peer set. `platform-api` and `platform-web` keep only a placeholder constant there today, but a root that re-exports slices (`platform-db`'s does) pulls them all. Import from subpaths.

**Proof.** [`tests/consumer-smoke/api-slim`](../tests/consumer-smoke/api-slim/) installs only the peers of `core`, `otel-core` and `telemetry` from packed tarballs, type-checks and loads the three entry points, boots a Nest application context on `OtelMetricsModule`, and asserts the other slices' peers are not installed (CI job `pack-smoke`).

**The consuming app declares the peers it uses.** npm never installs an optional peer, so an app that imports `@marinoscar/platform-api/jobs` must itself depend on `jobs`'s optional peers (`@nestjs/config`, `@nestjs/schedule`, ...), at the range the package declares. `node scripts/check-slice-peers.mjs --app <dir>` computes them: it scans the app's sources for `@marinoscar/platform-*` subpath imports, adds the universal slices, takes the effective peers of every slice used and fails for each one the app's `package.json` does not declare (`--print` lists the slices and peers instead). `npm run check:slice-peers` runs it for `starter/apps/{api,web,cli}` and `tests/consumer-smoke/{api,web,api-slim}`, so the lists cannot drift from the imports; a fork runs the same command from the platform repository, or copies the table from the package README. The starter documents which peers go away with which slice ([starter README](../starter/README.md#optional-slices)).

**Adding a slice or an import.** A new import of an uncovered package fails the check with its slice and file: add the package to the slice's list and to `peerDependencies` (and `peerDependenciesMeta` as optional unless a universal slice needs it). A new slice needs an entry in `platform-slice-peers.json` (use `[]` for none) alongside its graph entry; the package README's peer table gains its row.

## Contract conventions

`@marinoscar/platform-contract` holds the zod schemas the API and the web app share (#701). Its [README](../packages/platform-contract/README.md#conventions) owns the full rules; in short:

- One directory per slice, `src/<slice>/{schemas.ts,constants.ts,index.ts}` and a README, exported as `./<slice>` in both CommonJS and ESM.
- `schemas.ts`: `<thing>Schema` plus `export type <Thing> = z.infer<typeof <thing>Schema>`. `constants.ts`: plain values, never zod, so the browser bundle stays zod-free (tested).
- `src/` imports zod and its own files only (lint).
- Response fields that are always present are `.nullable()`, never `.optional()`; dates are ISO strings.
- Each schema is tagged `@extensionPoint schema` and catalogued in its slice README.
- **Schemas are extension surface.** Renaming or removing a field, or narrowing a type, is a `major` changeset with a migration note; adding an optional field or a new schema is `minor`.
- Apps extend with `.extend()` / `.merge()` in app code and never edit a contract file; `platform-api` wraps the schemas with `createZodDto()`, `platform-web` imports their types.
