# @marinoscar/platform-api/doctor

`@marinoscar/platform-api/doctor`: the admin Doctor, `GET /api/admin/doctor`. It runs small, read-only checks that the app's feature modules contribute and returns one report: is every capability of this deployment configured, reachable and healthy? The first slice extracted from the reference app (issue #696, Wave 1 of the platform program). Depends on the `core` slice only (`packages/platform-slices.json`): the registry primitive and the host ports.

## Purpose and scope

Does: the check contract (`DoctorCheck`, the five rules), the check registry, the service that runs the checks (parallel, dependency-aware, time-boxed, normalised, cached), the query and report DTOs, and the controller, created per app by `DoctorModule.forRoot({ host })` with the app's own access decorators.

Does not: ship any check. Checks are registry entries the app contributes from its own feature modules, under `<module>/doctor/`, and they move with their slices later. It does not own the permission system (the app's host does), the web page (`@marinoscar/platform-web/doctor/ui`) or a queue job (a Doctor run is a bounded request, never a job; see [docs/specs/doctor.md §2.5](../../../../docs/specs/doctor.md)).

## Install and peer dependencies

Ships inside `@marinoscar/platform-api`; import it by its subpath:

```ts
import { DoctorCheck, DoctorCheckRegistry, DoctorModule } from '@marinoscar/platform-api/doctor';
```

No peer beyond the package's own ([README](../../README.md#install-and-peer-dependencies)); it uses `@nestjs/common`, `@nestjs/swagger`, `nestjs-zod` and `zod`.

## Quick start

1. Define the app's platform host once (`apps/api/src/platform/platform-host.ts`, see the [core README](../core/README.md#host-ports)).
2. Configure the module (the reference app's [`doctor.config.ts`](../../../../apps/api/src/doctor/doctor.config.ts)) and import `doctorModule` in the root module:

```ts
import { DoctorModule } from '@marinoscar/platform-api/doctor';
import { platformHost } from '../platform/platform-host';

export const doctorModule = DoctorModule.forRoot({ host: platformHost });
```

3. Contribute a check from the feature module that owns the capability (the reference app's [`db-connection.doctor-check.ts`](../../../../apps/api/src/health/doctor/db-connection.doctor-check.ts)):

```ts
@Injectable()
export class DbConnectionDoctorCheck implements DoctorCheck, OnModuleInit {
  readonly id = 'core.database';
  readonly category = 'core';
  readonly label = 'Database connection';

  constructor(private readonly registry: DoctorCheckRegistry, private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(): Promise<DoctorCheckOutcome> {
    // a SELECT, a HEAD, a settings read: never a write
  }
}
```

The module is global: the feature module provides the check and imports nothing of the Doctor.

## Configuration

`DoctorModule.forRoot(options: DoctorModuleOptions)`:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `host` | `PlatformHost` | required | From `definePlatformHost()`. Without it `forRoot` throws: the route is never public. |
| `permission` | `string` | `DEFAULT_DOCTOR_PERMISSION` (`'system_settings:read'`) | Permission required to read the report. Must be one the app's RBAC grants; the web card must declare the same string. |
| `path` | `string` | `DEFAULT_DOCTOR_PATH` (`'admin/doctor'`) | Route path under the app's global prefix. |
| `categoryOrder` | `readonly string[]` | `PLATFORM_DOCTOR_CATEGORIES` | Category display and sort order. Unknown categories sort after, in registration order. Also listed in the OpenAPI `category` parameter. |
| `defaultTimeoutMs` | `number` | `5_000` | Per-check ceiling when a check declares no `timeoutMs`. |
| `cacheTtlMs` | `number` | `15_000` | How long a report is served from memory, per `category`; `refresh=true` bypasses it. |

The resolved options (defaults applied, frozen) are provided under `DOCTOR_MODULE_OPTIONS`.

### Categories

`PLATFORM_DOCTOR_CATEGORIES` is `core, auth, maintenance, storage, email, push, ai, jobs, nodes, backup, telemetry` (`DOCTOR_CATEGORIES` is a deprecated alias with the same values). An app adds a category simply by using a new string in its check's `category`, and reorders or extends the list with `categoryOrder`; the web page takes its labels from `DoctorPage`'s `categories` prop. No package file is edited.

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `DoctorModule.forRoot` | option | `forRoot(options: DoctorModuleOptions): DynamicModule` | Mount the Doctor once in the app's root module | stable | [example](../../../../apps/api/src/doctor/doctor.config.ts) |
| `DoctorModuleOptions` | option | `{ host; permission?; path?; categoryOrder?; defaultTimeoutMs?; cacheTtlMs? }` | Change the permission, path, category order, timeout or cache TTL | experimental | [example](../../../../apps/api/src/doctor/doctor.config.ts) |
| `DOCTOR_MODULE_OPTIONS` | token | `unique symbol` -> `ResolvedDoctorModuleOptions` | Read the resolved options (permission, path, order, timeout, TTL) in an app provider | experimental | [example](../../../../apps/api/src/doctor/doctor.config.ts) |
| `DoctorCheck` | registry | `{ id; category; label; settingsPath?; timeoutMs?; dependsOn?; run(): Promise<DoctorCheckOutcome> }` | Write a check for a capability the app owns | stable | [example](../../../../apps/api/src/health/doctor/db-connection.doctor-check.ts) |
| `DoctorCheckRegistry.register` | registry | `register(check: DoctorCheck): void` | Add the check to the report from its own `onModuleInit` | stable | [example](../../../../apps/api/src/health/doctor/db-connection.doctor-check.ts) |

Supporting exports: `DoctorService` (`run({ category?, refresh? })`, `invalidate()`), `DoctorCheckRegistry.get` / `list`, `DoctorStatus`, `DOCTOR_STATUSES`, `DOCTOR_STATUS_RANK`, `worstStatus`, `DoctorCheckOutcome`, `DoctorDataValue`, `DoctorCategory`, `CoreDoctorCategory`, the defaults `DEFAULT_DOCTOR_PERMISSION`, `DEFAULT_DOCTOR_PATH`, `DOCTOR_DEFAULT_TIMEOUT_MS`, `DOCTOR_CACHE_TTL_MS`, `DOCTOR_FALLBACK_REMEDY`, the DTOs `DoctorQueryDto` and `DoctorReportDto` with their types `DoctorQuery`, `DoctorReport`, `DoctorCheckReport`, and `createDoctorController` (called by `forRoot`; an app never needs it).

## Data

None. No models, migrations or seeds; the report is computed per request and held in memory for `cacheTtlMs`.

## Permissions and settings

Requires `system_settings:read` by default (`DEFAULT_DOCTOR_PERMISSION`), enforced through the app's host access port, so the route gets exactly the app's own `@Auth()` (guards, RBAC metadata, `x-rbac`). It declares no permission of its own: the report describes the deployment's configuration, which is what `system_settings:read` already covers, and every check is read-only. No `doctor:read` exists. The web card must declare the same literal (CLAUDE.md, Settings UI Pattern rule 3).

Reads no settings itself; checks read whatever their capability's settings are.

## UI

None in this slice. The page, its card descriptor (`doctorSettingsPage`) and its components are in `@marinoscar/platform-web/doctor/ui`.

## Infra

None. No compose fragment and no environment variable.

## Observability

`DoctorService` logs one `warn` line when a check throws: `Doctor check "<id>" threw: <message>` (the throw itself becomes a `fail` row). Nothing else is logged; no metric or span is emitted.

## Security notes

The five rules every check follows (header of `doctor-check.interface.ts`):

1. A check never throws; a crashed probe is a `fail` with the error's message (the service guards every call too: a throw becomes `fail`, a hang becomes `fail` after the timeout).
2. `remedy` is expected on `warn` and `fail` and names a settings page, a command or a variable; the service fills a generic one otherwise.
3. Checks are READ-ONLY: never a "test" service, never a write of an object, a row or an audit event, never a job or a model call. Anyone holding the permission may run it against production, as often as they like.
4. Results never contain secret material, in `detail`, `error` or `data`.
5. `skip` means "not evaluated": a dependency did not pass, or the capability is intentionally off.

The route always answers 200 for an authorised caller (a failing check is a row), validates its query with zod (`category` is a lowercase identifier, `refresh` is `true` or `false`), is not `@AllowDuringMaintenance()`, and `forRoot` refuses to build a controller without a host, so the route is never public.

## Conformance suite

None yet. A planned "doctor checks are read-only" suite (statically refusing the side-effecting test services in a check) will run through `runPlatformConformance()`. Until then the package's own tests (`test/doctor/`) and the reference app's `apps/api/test/doctor/doctor.integration.spec.ts` (RBAC, every module's checks wired, no secret on the wire) pin the behaviour.

## Upgrade notes

First packaged release (#696). Moving from the app's own `apps/api/src/doctor/`:

- Import `DoctorCheck`, `DoctorCheckOutcome` and `DoctorCheckRegistry` from `@marinoscar/platform-api/doctor` instead of `../doctor/doctor-check.interface` / `doctor-check.registry`.
- Replace the app's `DoctorModule` with `DoctorModule.forRoot({ host })` and delete the app's controller, service, registry and DTOs. The route, the permission, the OpenAPI operation (`doctor_getReport`) and the response are unchanged.
- `DOCTOR_CATEGORIES` is now `PLATFORM_DOCTOR_CATEGORIES`; the old name remains as a deprecated alias.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `DoctorModule.forRoot: ... is required ... never public` at boot | `forRoot` was called without the app's host. Pass `definePlatformHost(...)` from `apps/api/src/platform/platform-host.ts`. |
| `Duplicate doctor check id "<id>": A and B both register it` at boot | Two checks share an id. Ids are unique across the app; rename one. |
| `Registry "doctor-checks" is frozen` | A check registered after bootstrap. Register from `onModuleInit`, never later. |
| A check is missing from the report | Its provider is not in any module, or its `onModuleInit` does not call `register(this)`. |
| `Nest can't resolve dependencies of <Check> (DoctorCheckRegistry, ...)` | `DoctorModule.forRoot()` is not imported in the root module (or in the test module). |
| Every row is `fail` "Timed out after 5000ms" | The probe hangs; raise the check's `timeoutMs` or `defaultTimeoutMs` only if the service is legitimately slow. |

## Links

- Spec: [docs/specs/doctor.md](../../../../docs/specs/doctor.md); runbook: [docs/runbooks/doctor.md](../../../../docs/runbooks/doctor.md).
- Platform spec: [platform-packages.md](../../../../docs/specs/platform-packages.md), Roadmap, Wave 1.
- The web side: `@marinoscar/platform-web/doctor` ([README](../../../platform-web/src/doctor/README.md)).
- Host ports and the controller-factory recipe: [core README](../core/README.md#host-ports).
- Package README: [platform-api](../../README.md).
