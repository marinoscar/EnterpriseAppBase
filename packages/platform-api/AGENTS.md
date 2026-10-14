# packages/platform-api rules

Root rules ([AGENTS.md](../../AGENTS.md)) apply. This is the published NestJS platform package; apps bind it, they do not fork it. README: [README.md](README.md). Catalog: [docs/SLICES.md](../../docs/SLICES.md).

## Slice layout

- One folder per slice in `src/`: `identity`, `settings`, `jobs`, `nodes`, `ai`, `notifications`, `storage`, `credentials`, `sharing`, `email`, `exports`, `onboarding`, `user-data`, `db-backup`, `doctor`, `telemetry`, `android-app`, `host`, `manifest`, `core`, `otel-core`, `testing`.
- Each slice has its own `README.md` (purpose, `forRoot` options, extension points, quick start). Read the slice README before editing the slice.
- `core` is the bottom of the graph (registry primitive, principal and scope, errors, crypto, host ports, scoped data access). Slices depend downward only; `test/boundaries.spec.ts` and the slice peer check enforce it.
- Each slice is imported by subpath (`@marinoscar/platform-api/<slice>`, plus `/testing` where present). A new public symbol is exported from the slice index; add a subpath only with an `exports` entry in `package.json`.

## Registries and open id vocabularies

- Cross-cutting lists are registries with string ids (`defineRegistry`, `definePluggableKind` in `core`), not closed unions or enums: permissions, settings namespaces, doctor checks, conformance suites, notification channels, AI providers, storage drivers, system access reasons.
- A new closed id list fails `npm run check:closed-lists`. Open it with a registry ([docs/EXTENDING.md](../../docs/EXTENDING.md#open-an-id-vocabulary)); an allowlist entry in `packages/closed-lists.allowlist.json` needs a real reason ([docs/PACKAGES.md](../../docs/PACKAGES.md#closed-id-lists)).
- Overrides go through `forRoot` bindings, never an app-module provider. A platform gap seen from an app is a seam request, not a local patch.

## Conformance

- `runPlatformConformance()` (`src/testing/`) runs every suite against an app; a suite id is owned by a slice. Suites include `cron-enqueue-only`, `on-event-no-io`, `host`, and the `ai-*` family. An opt-out needs a written reason. Table of suites: [src/testing/README.md](src/testing/README.md).
- A new route, job type, card or permission is discovered by the suites; keep them green.

## Recipes (read the README, do not reinvent)

- Job type: [src/jobs/handlers/README.md](src/jobs/handlers/README.md) (queue rules 1 to 5 in root AGENTS.md; `type` is permanent).
- AI: [src/ai/README.md](src/ai/README.md) (SDKs only in `ai/providers/<provider>/`).
- Notification: [src/notifications/README.md](src/notifications/README.md) (`notify()` after commit).
- Doctor check: [docs/specs/doctor.md](../../docs/specs/doctor.md#4-extending-it-in-a-fork).

## Rules that bite

- Every controller route declares `@Auth(...)`; validate with Zod.
- Permissions are declared by the owning slice and listed in `src/manifest/`; a card or route uses the exact string.
- Dump/restore code carries `--enable-row-security` and `PGOPTIONS=-c app.rls_bypass=on` (`src/db-backup/`).
- Changing a package needs a `.changeset` file; documentation follows [docs/PACKAGES.md](../../docs/PACKAGES.md) (`npm run check:package-docs`).
