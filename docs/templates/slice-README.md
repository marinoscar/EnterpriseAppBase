# @marinoscar/platform-&lt;pkg&gt;/&lt;slice&gt;

<!--
  Slice README template (Package documentation standard, docs/PACKAGES.md).
  Copy this file to packages/platform-<pkg>/src/<slice>/README.md when the
  slice becomes a subpath export (`"./<slice>"` in the package's `exports`).
  Same 15 headings as docs/templates/package-README.md, same rules.

  When the slice is exported, also:
  - append "src/<slice>/index.ts" to `entryPoints` in
    packages/platform-<pkg>/typedoc.json (the checker fails otherwise), and
  - link this README from the package README's "Purpose and scope".

  Rules `npm run check:package-docs` enforces:
  - Keep the 15 level-2 headings below, with this text, in this order. Add
    ### subsections freely; never add, rename or reorder a ## heading.
  - No section is empty. A section with nothing to say contains exactly
    "None." plus one sentence why.
  - The Extension-point catalog lists every symbol exported from
    src/<slice>/index.ts and tagged @extensionPoint, and nothing else, with
    Kind and Stability equal to the tags. Every row's Example links a working
    use in the reference app (apps/, infra/ or tests/), never packages/.
    From src/<slice>/ that link starts with ../../../../ (four levels up).

  Delete this comment in the copy.
-->

One paragraph: what the slice does, in which layer, and which slices of the same package it depends on (`packages/platform-slices.json`).

## Purpose and scope

What the slice does, and what it deliberately does not do (and which slice or app owns that instead).

## Install and peer dependencies

Ships inside `@marinoscar/platform-<pkg>`; import it by its subpath:

```ts
import { <Symbol> } from '@marinoscar/platform-<pkg>/<slice>';
```

List any peer dependency only this slice needs, or write `None.` and why.

## Quick start

The smallest working setup, copied from the reference app and kept compiling there.

## Configuration

The `forRoot()` (or provider/props) options, one row each:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `<option>` | `<type>` | `<default>` | `<what it changes>` |

## Extension-point catalog

One row per symbol exported from `src/<slice>/index.ts` and tagged `@extensionPoint`; `Name` is the exported name (`Class.member` for a member), `Kind` and `Stability` equal its `@extensionPoint` and `@stability` tags.

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|

Sample rows (from `packages/platform-<pkg>/src/<slice>/` the reference app is four levels up):

```markdown
| `DoctorRegistry.register` | registry | `register(check: DoctorCheck): void` | Add a check to the report from a feature module | stable | [example](../../../../apps/api/src/health/doctor/db-connection.doctor-check.ts) |
| `DOCTOR_OPTIONS` | token | `InjectionToken<DoctorOptions>` | Read the resolved options in a custom check | experimental | [example](../../../../apps/api/src/doctor/doctor.module.ts#L12) |
```

`Kind` is one of `option`, `registry`, `token`, `event`, `slot`, `theme-token`, `overlay`, `hook`, `component`. `Stability` is `stable` or `experimental`. A slice with no extension point writes `None.` and one sentence why instead of the table.

## Data

Prisma models owned, migrations (ids and what they do), seeds, and which models and columns an app may reference (public) versus must not (private).

## Permissions and settings

The permissions the slice declares (`resource:action`) and the settings it reads, with defaults.

## UI

Pages, settings-registry entries, slots and theme tokens the slice contributes or reads.

## Infra

Compose fragments and environment variables (name, default, meaning; never one for a runtime-configured feature).

## Observability

The logs, metrics and spans the slice emits.

## Security notes

Authorization, secrets handling, input validation and anything an app must not weaken.

## Conformance suite

What the slice's conformance suite enforces, and how an app runs it through `runPlatformConformance()`.

## Upgrade notes

A migration guide per major version, newest first.

## Troubleshooting

Symptom, cause and fix, one row or subsection each.

## Links

The platform spec section for this slice, the package README and the TypeDoc API reference. Relative to `packages/platform-<pkg>/src/<slice>/`:

```markdown
- [Package README](../../README.md)
- [Platform packages spec](../../../../docs/specs/platform-packages.md)
- [Package documentation standard](../../../../docs/PACKAGES.md)
```
