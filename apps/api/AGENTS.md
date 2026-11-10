# apps/api rules

Root rules ([AGENTS.md](../../AGENTS.md)) apply. This file is what to get right when editing the NestJS API. Conventions: [docs/API.md](../../docs/API.md); testing: [docs/TESTING.md](../../docs/TESTING.md).

## Layout

- `src/platform/<slice>/` binds each packaged slice (`forRoot` config and host ports). Overrides go through `forRoot` bindings, never an app-module provider ([docs/EXTENDING.md](../../docs/EXTENDING.md)).
- `src/jobs/handlers/`, `src/settings/`, `src/storage/`, `src/onboarding/`, `src/common/`: app-owned code. Most logic lives in `packages/platform-api/src/<slice>/`.
- `prisma/fragments/` is hand-edited; `prisma/schema/` is GENERATED (never edit); `prisma/migrations/` holds installed copies.
- Tests in `test/`: `*.spec.ts` (mocked), `*.db.spec.ts` (real Postgres, `npm run test:db`), `conformance.spec.ts`.

## Rules

- **Every route declares `@Auth(...)`** (`packages/platform-api/src/identity/auth/decorators/auth.decorator.ts`, e.g. `@Auth({ permissions: [PERMISSIONS.USERS_READ] })`). No global JWT guard: a route without it is public. A card's UI permission must equal the string here.
- **Validate input with Zod** (`createZodDto` from `nestjs-zod`); document with `@ApiOperation` / `@ApiResponse`. Run `npm run openapi:dump && npm run openapi:lint` after route changes.
- **Long-running work is a queue job** (root queue rules 1 to 5): a `JobHandler` registered with a permanent `type`, enqueued via `JobsService`. `@Cron` only enqueues (use `enqueueHousekeepingJob`); `@OnEvent` does no I/O. Pass `orgId` on org jobs; run under `JobScope.run(job, fn)`. Recipe: `packages/platform-api/src/jobs/handlers/README.md`. New type: update `test/jobs/job-type-snapshot.spec.ts`.
- **AI** (AI rules 1 to 5): no provider SDK outside `ai/providers/<provider>/`; call `AiService.forUser(userId, { orgId, feature })`; consumer routes behind `AiEnabledGuard` + `ai:use`; `ai.*` jobs are never node-eligible; no key material in logs, spans or rows.
- **RLS clients**: `forOrg`/`runInOrg` for org tables (`runInOrg` inside `$transaction`, never a `forOrg` client); `PrismaSystemService` only in files of the `ALLOWLIST` in `test/tenancy/system-injection-boundary.spec.ts`, with a registered `SystemAccessReason`. `set_config(..., true)` only, never a session `SET`. Org-table links are composite FKs including `org_id`.
- **`notify()` after commit**, outside any `$transaction`.
- **Never hand-edit `prisma/schema/`**; edit the fragment, `npm run db:compose`, `npm run prisma:generate`. Use `npm run prisma:*`, never bare `npx prisma`. Platform-table migrations: [packages/platform-db/AGENTS.md](../../packages/platform-db/AGENTS.md).
- **No env vars for runtime-configured features** (storage, AI, VAPID, SMTP, telemetry connection). App variables go in `infra/compose/app.env.example`, then `npm run platform:infra:sync`; never a commented `# KEY=value` line in `.env.example`.
- **Secrets**: runtime credentials are encrypted with `SECRETS_ENCRYPTION_KEY`; the API runs as an ordinary (non-superuser) database role.
- **A behaviour change carries tests**; add routes to RBAC coverage (`test/rbac/`).

Run: `npm test --workspace=api`, `npm run typecheck --workspace=api`.
