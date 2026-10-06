# @marinoscar/platform-&lt;pkg&gt;

<!--
  Package README template (Package documentation standard, docs/PACKAGES.md).
  Copy this file to packages/platform-<pkg>/README.md. For a slice inside a
  layer package, copy docs/templates/slice-README.md to
  packages/platform-<pkg>/src/<slice>/README.md instead.

  Rules `npm run check:package-docs` enforces:
  - Keep the 15 level-2 headings below, with this text, in this order. Add
    ### subsections freely; never add, rename or reorder a ## heading. Text
    after a colon is allowed ("## Configuration: forRoot() options").
  - No section is empty. A section with nothing to say contains exactly
    "None." plus one sentence why.
  - The Extension-point catalog lists every exported symbol tagged
    @extensionPoint, and nothing else, with Kind and Stability equal to the
    tags. Every row's Example links a working use in the reference app
    (apps/api, apps/web, apps/cli, infra/ or tests/), never a file under
    packages/.
  - Relative links resolve from this README's own directory
    (apps/api/test/docs-links.spec.ts checks every one).

  Delete this comment in the copy.
-->

One paragraph: what the package is, which layer it covers (contract, API, web, data, CLI or infra), its module format, and who consumes it.

## Purpose and scope

What the package does, and what it deliberately does not do. Name the slices it exports as subpaths (`@marinoscar/platform-<pkg>/<slice>`), one line each, and link each slice's README.

## Install and peer dependencies

```bash
npm install @marinoscar/platform-<pkg>
```

The single-instance libraries the app must install itself (a second copy breaks dependency injection, hooks or theme context):

| Package | Range |
|---|---|
| `<peer>` | `<range from package.json peerDependencies>` |

## Quick start

The smallest working setup, copied from the reference app and kept compiling there:

```ts
// apps/<app>/src/<file>.ts
import { <Module> } from '@marinoscar/platform-<pkg>/<slice>';
```

## Configuration

The `forRoot()` (or provider/props) options, one row each:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `<option>` | `<type>` | `<default>` | `<what it changes>` |

## Extension-point catalog

Every registry, injection token, event, slot, theme token, overlay point, hook and component an app may extend. One row per exported symbol tagged `@extensionPoint`; `Name` is the exported name (`Class.member` for a member), `Kind` and `Stability` equal its `@extensionPoint` and `@stability` tags.

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|

Sample rows (the Example link is relative to the README, so from `packages/platform-<pkg>/` it starts with `../../`; from a slice README with `../../../../`):

```markdown
| `DoctorRegistry.register` | registry | `register(check: DoctorCheck): void` | Add a check to the report from a feature module | stable | [example](../../apps/api/src/health/doctor/db-connection.doctor-check.ts) |
| `DOCTOR_OPTIONS` | token | `InjectionToken<DoctorOptions>` | Read the resolved options in a custom check | experimental | [example](../../apps/api/src/doctor/doctor.config.ts) |
```

`Kind` is one of `option`, `registry`, `token`, `event`, `slot`, `theme-token`, `overlay`, `hook`, `component`. `Stability` is `stable` or `experimental` (`internal` symbols are never exported, so never listed). A package with no extension point yet writes `None.` and one sentence why instead of the table.

## Data

Prisma models owned, migrations (ids and what they do), seeds, and which models and columns an app may reference (public) versus must not (private).

## Permissions and settings

The permissions the package declares (`resource:action`) and the system or user settings it reads, with defaults.

## UI

Pages, settings-registry entries, slots and theme tokens the package contributes or reads.

## Infra

Compose fragments, nginx or collector configuration, and environment variables (name, default, meaning; never one for a runtime-configured feature).

## Observability

The logs (events and levels), metrics (names and labels) and spans (names and attributes) the package emits.

## Security notes

Authorization, secrets handling, input validation and anything an app must not weaken.

## Conformance suite

What `runPlatformConformance()` enforces for this package, and how an app runs it.

## Upgrade notes

A migration guide per major version, newest first: what broke, what to change in the app, and how to verify.

## Troubleshooting

Symptom, cause and fix, one row or subsection each.

## Links

- The platform spec section for this package, the TypeDoc API reference (`npm run docs:packages`, then `docs-api/index.html`), and each slice README. Relative to `packages/platform-<pkg>/`:

```markdown
- [Platform packages spec](../../docs/specs/platform-packages.md)
- [Package documentation standard](../../docs/PACKAGES.md)
```
