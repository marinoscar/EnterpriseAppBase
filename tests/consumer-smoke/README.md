# Consumer smoke

Installs the `@marinoscar/platform-*` packages the way an app outside this repository gets them, from packed tarballs, the npm registry or a GitHub release, and proves they build, boot and render there (issue #697).

A workspace link hides exactly the defects a published package can have: a file missing from `files`, a dependency declared dev-only, a wrong `exports` condition, a missing `.js` extension in ESM output, a peer that ends up installed twice. A clean install in a directory that cannot see this repository's `node_modules` does not.

This directory is **not** an npm workspace (the root `workspaces` are `apps/*` and `packages/*`), and its projects never commit a `package-lock.json` (git-ignored): every run resolves fresh, the way a new consumer does.

## What it proves

| Project | Stack | Proves |
|---|---|---|
| `api/` | NestJS 11 + Fastify, CommonJS, `tsc` with `NodeNext`, `experimentalDecorators`, `emitDecoratorMetadata`, `strict`, `skipLibCheck: false` | The package's `exports` and `.d.ts` resolve and type-check from outside the monorepo. `DoctorModule.forRoot` mounts with the consumer's own host (`src/platform-host.ts`, a test-only header guard): `GET /api/admin/doctor` answers 401 without `x-smoke: 1`, 403 without the permission, 200 with it. The consumer's checks (`src/smoke.check.ts`, registered by constructor-injected `DoctorCheckRegistry`) appear with a computed `verdict`; the zod query DTO answers 400 on a bad value; the route is in the consumer's OpenAPI document. `DoctorModule.forRoot` without a host and `definePlatformHost` with a missing access function both throw. The package is a real directory inside the consumer, not a link. The consumer augments `SystemSettingsNamespaces` with its own `notes` namespace (`src/notes.settings.ts`) before importing slices that augment it too (`src/settings-typing.check.ts`), and `tsc` proves `getNamespace('notes')`, `getNamespace(NOTES_SYSTEM_SETTINGS)` and the slices' keys are typed; at runtime `JobsModule.forRoot()` registers the `jobs` namespace with `DEFAULT_JOBS_POLICY` (#865). |
| `api-slim/` | NestJS 11 context (no HTTP adapter), CommonJS, `tsc` with `NodeNext`, `skipLibCheck: false` | A consumer that installs ONLY the peers of `core`, `otel-core` and `telemetry` (the `telemetry` row of `node scripts/check-slice-peers.mjs --table`: the required peers plus `@nestjs/config`, `@nestjs/schedule` and `fastify`) builds and runs from packed tarballs (#914). `@marinoscar/platform-api/core`, `/otel-core` and `/telemetry` type-check and load, `TelemetryModule.forRoot` returns its module metadata, a Nest application context boots on `OtelMetricsModule` and runs a `@Trace()` method, and the peers of the other slices (`@nestjs/jwt`, `@nestjs/passport`, `passport`, `@nestjs/event-emitter`, `@nestjs/terminus`, `@nestjs/platform-fastify`, `supertest`) are not in `node_modules`. It does not boot `TelemetryModule`: its six host ports are an app's to bind. |
| `web/` | Vite 8 + React 19 + MUI 9, ESM, `moduleResolution: bundler`, `skipLibCheck: false` | `tsc` and `vite build` succeed. A Vitest + jsdom test renders `DoctorPage` (`@marinoscar/platform-web/doctor/ui`) inside `PlatformHostProvider` with the consumer's fake host and finds the consumer's check row; the headless client (`/doctor/headless`) calls the consumer's transport; a packaged page refuses to render without a host. |

After each project's tests, `scripts/check-single-instance.mjs --root <temp project> --guard @marinoscar/platform-*` proves one copy of every single-instance library there (Nest, zod, React, MUI, Emotion, the platform packages).

## Run it

Needs Node 24 (npm 11): npm 10 crashes resolving Vitest's peer set.

```bash
npm ci
npm run smoke:consumer                                   # build, pack the six, smoke api, api-slim and web
npm run smoke:consumer -- --project api --keep           # one project, keep the temp directory
```

Or step by step, as CI does:

```bash
npm run build:packages
mkdir -p /tmp/pp-tarballs && for p in contract api web db cli infra; do npm pack -w @marinoscar/platform-$p --pack-destination /tmp/pp-tarballs; done
node tests/consumer-smoke/run.mjs --project api --from tarballs /tmp/pp-tarballs
node tests/consumer-smoke/run.mjs --project api-slim --from tarballs /tmp/pp-tarballs
node tests/consumer-smoke/run.mjs --project web --from tarballs /tmp/pp-tarballs
```

Other sources:

```bash
node tests/consumer-smoke/run.mjs --from registry next --audit-signatures   # a published version or dist-tag; verifies provenance
node tests/consumer-smoke/run.mjs --from release 0.1.0-next.0               # the tarballs on GitHub release platform-v0.1.0-next.0
```

`run.mjs` copies the project to `os.tmpdir()` (refusing a directory inside the repository), rewrites the platform dependency specs (a tarball path, a registry version or a release URL; for tarball and release installs, `overrides` pin any platform package another one depends on to the same source), clears the inherited `npm_*` workspace state and `NODE_PATH`, runs `npm install` (5 minutes at most; registry installs retry for 2 minutes while the registry propagates), `npm run build`, `npm test` and the single-instance check, then deletes the directory unless `--keep`. Exit 0 pass, 1 a step failed, 2 usage error.

## In CI

| Job | Workflow | Source |
|---|---|---|
| `pack-smoke` | `.github/workflows/packages.yml`, pushes to main and pull requests that touch the packages | packed tarballs |
| `github-release` | `.github/workflows/release.yml`, once per final version | packed tarballs, then the api project from the release URLs |
| `registry-smoke` | `.github/workflows/release.yml`, after a real npm publish | the published version, with `npm audit signatures` |

Release procedure: [docs/runbooks/release-platform-packages.md](../../docs/runbooks/release-platform-packages.md).

## Add a slice

When a slice ships in a package, add a minimal use of it here, the way the app it was extracted from uses it:

1. Import it in the matching project (`api/src/` for `@marinoscar/platform-api/<slice>`, `web/src/` for `@marinoscar/platform-web/<slice>`), through its public subpath only.
2. Wire its extension points with the consumer's own code (its own registry entry, its own host binding), never a copy of the reference app's.
3. Assert the observable result in `api/test/smoke.e2e.mjs` (`node:test`) or `web/src/App.test.tsx` (Vitest), including its fail-closed behaviour.
4. A new peer goes in the project's `package.json` at the version the reference app uses. A new package (beyond the six) goes in `PLATFORM_PACKAGES` in `run.mjs`.
