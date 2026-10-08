# @marinoscar/platform-contract

Zod schemas, DTOs and TypeScript types shared by `@marinoscar/platform-api` and `@marinoscar/platform-web`, so the server and the browser validate and type the same shapes. It is the only dual-format package: it ships CommonJS (for the API, which is CommonJS) and ESM (for the web app and the CLI) from one source, selected by the `exports` map.

## Purpose and scope

The request and response shapes of every platform slice, as zod schemas plus the inferred types and plain constants. It holds no runtime behaviour beyond validation: no NestJS, no React, no I/O. The API wraps the schemas as its nestjs-zod DTOs (so the OpenAPI document is generated from them); the web app imports their types and constants. Nothing is described twice by hand.

Slices (each a subpath export with its own README):

| Subpath | What | README |
|---|---|---|
| `@marinoscar/platform-contract/doctor` | The admin Doctor's report, row, status and query (#701), and the support bundle envelope (#772) | [src/doctor/README.md](src/doctor/README.md) |
| `@marinoscar/platform-contract/telemetry` | Telemetry wire shapes, `stable`: config, status, explorer, connection, stack, dashboard, assistant and the `telemetry` settings namespace (#702) | [src/telemetry/README.md](src/telemetry/README.md) |
| `@marinoscar/platform-contract/identity` | Identity wire shapes, `stable`: the sign-in error codes (`AUTH_ERROR_CODES`, the single source), `/api/auth/me`, token responses, personal access tokens, the device flow, organizations, members and invitations (#727) | [src/identity/README.md](src/identity/README.md) |
| `@marinoscar/platform-contract/settings` | Settings wire shapes, `stable` (the org-settings shapes `experimental`): the core user fields (`theme`, `profile`), the `dataTables` and `navigation` user namespaces, the system and user response bases, and `/api/org-settings` (#733) | [src/settings/README.md](src/settings/README.md) |
| `@marinoscar/platform-contract/credentials` | The presentation-safe shapes of a stored credential (deployment, user, organization), the tiers and the secret-bearing key list (#735) | [src/credentials/README.md](src/credentials/README.md) |
| `@marinoscar/platform-contract/onboarding` | Onboarding wire shapes, `experimental`: the stored `onboarding` user-settings namespace, `GET /api/onboarding` and the activation metrics (#745) | [src/onboarding/README.md](src/onboarding/README.md) |
| `@marinoscar/platform-contract/email` | The email settings, the `PUT` body with its write-only secrets, the response with masked credential status, the test-send result and the closed transport list (#737) | [src/email/README.md](src/email/README.md) |
| `@marinoscar/platform-contract/jobs` | The admin job routes' list query and row (with `orgId`), summary, insights and bulk-action shapes, and the status, reason and window lists (#734) | [src/jobs/README.md](src/jobs/README.md) |
| `@marinoscar/platform-contract/nodes` | The worker-node control plane, data plane, per-job secret and node credential request shapes, and the node bounds (#734) | [src/nodes/README.md](src/nodes/README.md) |
| `@marinoscar/platform-contract/storage` | The `storage` settings namespace (with the no-secret proof), the objects API and status shapes, and the storage-config admin bodies and results (save, connection test, bucket provisioning) (#736) | [src/storage/README.md](src/storage/README.md) |
| `@marinoscar/platform-contract/exports` | The `/api/exports` request and responses, the cell, column and request-field shapes, and the JSON export file envelope (#744) | [src/exports/README.md](src/exports/README.md) |
| `@marinoscar/platform-contract/ai` | The `ai` system and user settings namespaces (with the no-secret proof), the org layer and its tighten-only merge, the org-key and feature-list shapes (#739) | [src/ai/README.md](src/ai/README.md) |

The root entry exports only `PLATFORM_PACKAGE`; schemas are reached through their slice's subpath, so a consumer loads only the slices it uses.

### Conventions

Every slice follows these rules. The mechanical ones are enforced.

| Rule | Enforced by |
|---|---|
| One directory per slice, `src/<slice>/{schemas.ts,constants.ts,index.ts}` plus its `README.md`; subpath export `./<slice>` with an `import` and a `require` condition, each with its own `types` | `test/no-zod-in-constants.test.ts` (layout), `test/dual-format.test.ts` (exports map, both halves load with the same keys), `packages/platform-api/test/slice-graph.spec.ts` (the slice is in `packages/platform-slices.json`), the pack check |
| `schemas.ts` holds zod schemas named `<thing>Schema` (camelCase) and the inferred types `export type <Thing> = z.infer<typeof <thing>Schema>` (`z.output` where a transform applies) | review, TSDoc catalog |
| `constants.ts` holds plain readonly values and string-literal unions and never imports zod (nor `schemas.ts`), so a browser that needs only a constant or a type never bundles zod | `test/no-zod-in-constants.test.ts` |
| `src/` imports zod and its own files only: no `@nestjs/*`, `nestjs-zod`, `react`, `@mui/*`, Node built-in, or other platform package | `no-restricted-imports` block for `packages/platform-contract/src/**` in [`eslint.config.mjs`](../../eslint.config.mjs) (`npm run lint:packages`) |
| Wire shapes are explicit: a response field that is always present is `.nullable()`, never `.optional()`; dates are ISO strings (`z.iso.datetime()`) | review |
| Every schema an app may extend is tagged `@extensionPoint schema` and listed in its slice README's catalog | `npm run check:package-docs` |
| Schemas are extension surface: renaming or removing a field, or narrowing a type, is a breaking change (`major` changeset with a migration note); adding an optional field or a new schema is `minor` | [docs/PACKAGES.md](../../docs/PACKAGES.md#contract-conventions), changeset review |
| Apps extend in app code with `.extend()` / `.merge()` / `.strict()`; never edit a contract file to add an app field | this README, "Extending a contract in an app" below |
| A schema moved here from a package keeps its field order, `.describe()` texts and enum order, so the generated OpenAPI document does not change | the OpenAPI diff in the slice's pull request |

### Who depends on it

`@marinoscar/platform-api` and `@marinoscar/platform-web` depend on this package at the lockstep version (a dependency, not a peer: it is part of the platform). `packages/platform-slices.json` records slice edges inside one package only; the package edges are these two, and the contract depends on no platform package.

### Dual format

`npm run build` runs `tsc` twice (`tsconfig.cjs.json` into `dist/cjs`, `tsconfig.esm.json` into `dist/esm`) and writes a `package.json` stub into each half that sets its module format. Each half carries its own `.d.ts` files, so a CommonJS consumer on `moduleResolution: node16` never sees ESM-format declarations. `"sideEffects": false` lets a bundler drop a slice's `schemas.ts` (and zod) when only its constants and types are used.

## Install and peer dependencies

```bash
npm install @marinoscar/platform-contract zod
```

Install these in the app; the package never bundles its own copy (a second copy of zod breaks `instanceof ZodError` across the boundary).

| Package | Range |
|---|---|
| `zod` | `^4.4.3` |

An app that uses `@marinoscar/platform-api` or `@marinoscar/platform-web` gets this package with them, but still installs `zod` itself.

## Quick start

Validate with a slice's schema, or use its types:

```ts
import { doctorReportSchema } from '@marinoscar/platform-contract/doctor';
import type { DoctorReport } from '@marinoscar/platform-contract/doctor';

const report: DoctorReport = doctorReportSchema.parse(body.data);
```

In browser code, import types with `import type` and constants only, so zod stays out of the bundle.

### Extending a contract in an app

An app that needs more than the contract says extends the schema in its own code; it never edits a contract file:

```ts
import { doctorCheckReportSchema, doctorReportSchema } from '@marinoscar/platform-contract/doctor';
import { z } from 'zod';

// Stricter: refuse any field the contract does not declare.
const exactReportSchema = doctorReportSchema
  .extend({ checks: z.array(doctorCheckReportSchema.strict()) })
  .strict();

// Wider: an app-only field on its own rows.
const ownedRowSchema = doctorCheckReportSchema.extend({ owner: z.string() });
type OwnedRow = z.infer<typeof ownedRowSchema>;
```

The reference app's Doctor integration test uses the first form ([`doctor.integration.spec.ts`](../../apps/api/test/doctor/doctor.integration.spec.ts)). A field every app needs belongs in the contract: file a seam request.

## Configuration

None. Schemas take no options; the routes that use them are configured in `@marinoscar/platform-api`.

## Extension-point catalog

None. The root entry exports only `PLATFORM_PACKAGE`; every schema is an extension point of its slice and is catalogued in that slice's README (`schema` kind), for example [the Doctor's](src/doctor/README.md#extension-point-catalog).

## Data

None. The package holds schemas of HTTP payloads, not database models; models live in `@marinoscar/platform-db`.

## Permissions and settings

None. Schemas declare no permission or setting; the API slices that use them do.

## UI

None. The package renders nothing; `@marinoscar/platform-web` imports its types and constants.

## Infra

None. The package ships no deployment configuration and reads no environment variable. The API and web images copy and build it before the package that depends on it.

## Observability

None. Validation is pure; the API and web packages log and trace around it.

## Security notes

Schemas are the single source of input validation for both sides. Never loosen a schema in an app to accept a payload the API rejects; file a seam request instead. A schema documents which fields never carry secret material, but cannot enforce it; the slice that fills the payload does.

## Conformance suite

None yet. The package ships no conformance suite; `runPlatformConformance()` and the suites arrive with the platform's conformance harness. Its own tests (`test/`) cover every slice's schemas and both module formats.

## Upgrade notes

What counts as breaking, for every slice: renaming or removing a field, making an optional field required, narrowing a type (a smaller enum, a stricter pattern), changing a nullable field to optional or the reverse, or changing what a transform outputs. Each is a `major` changeset with a migration note. Adding an optional request field, a new response field an app can ignore, or a new schema or slice is `minor`.

- #701: first slice, `./doctor`. The Doctor's schemas moved here from `@marinoscar/platform-api/doctor` and its types from `@marinoscar/platform-web/doctor/headless`; both packages re-export the old names. No wire or OpenAPI change.
- #702: `./telemetry`. The telemetry wire shapes moved here from the API's telemetry DTOs and the web's hand-written mirrors; both keep their old names. No wire or OpenAPI change.
- #727: `./identity`. `AUTH_ERROR_CODES` is defined here once (the API and the web app both import it, replacing the hand-kept mirror), and the request schemas of switch-org, personal access tokens, the device flow and organization administration moved here from the API's DTO files. No wire or OpenAPI change.

## Troubleshooting

- **`Cannot find module '@marinoscar/platform-contract/<slice>'`.** The package is not built (`npm run build:packages` builds it first), or the slice is missing from the `exports` map.
- **`ERR_REQUIRE_ESM` or `exports is not defined` at load.** A `dist/<cjs|esm>/package.json` stub is missing; rebuild (`scripts/write-dist-stubs.mjs` writes them).
- **zod appears in the web bundle.** Browser code imports a schema at run time; switch to `import type` and the slice's constants.

Build and import problems common to every platform package are in [DEVELOPMENT.md § Platform packages](../../docs/DEVELOPMENT.md#platform-packages).

## Links

- [Platform packages spec](../../docs/specs/platform-packages.md): the extension contract and the package documentation standard
- [Package documentation standard and checks](../../docs/PACKAGES.md): how this README, the TSDoc and the catalog are checked, and the contract conventions summary
- [DEVELOPMENT.md § Platform packages](../../docs/DEVELOPMENT.md#platform-packages): build, test and lint commands
- [Doctor slice](src/doctor/README.md)
- [Telemetry slice](src/telemetry/README.md)
- [Identity slice](src/identity/README.md)
- [Settings slice](src/settings/README.md)
- [Onboarding slice](src/onboarding/README.md)
- [Exports slice](src/exports/README.md)
