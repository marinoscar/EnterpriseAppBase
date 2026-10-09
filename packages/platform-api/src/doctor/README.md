# @marinoscar/platform-api/doctor

`@marinoscar/platform-api/doctor`: the admin Doctor, `GET /api/admin/doctor`. It runs small, read-only checks that the app's feature modules contribute and returns one report: is every capability of this deployment configured, reachable and healthy? The first slice extracted from the reference app (issue #696, Wave 1 of the platform program). Depends on the `core` slice only (`packages/platform-slices.json`): the registry primitive and the host ports.

## Purpose and scope

Does: the check contract (`DoctorCheck`, the five rules), the check registry, the service that runs the checks (parallel, dependency-aware, time-boxed, normalised, cached), the query and report DTOs (nestjs-zod wrappers of the schemas in `@marinoscar/platform-contract/doctor`, #701), and the controller, created per app by `DoctorModule.forRoot({ host })` with the app's own access decorators. Since #773 also the egress inventory: `EgressRegistry`, where each module describes its outbound (internet) dependencies, a pure host classifier, and `NetworkEgressDoctorCheck` (`network.egress`), which grades that inventory when the deployment declares itself air-gapped.

Also the **support bundle** (issue #772): `GET <path>/support-bundle`, one redacted JSON file for a support ticket. Its section registry (`SupportBundleRegistry`, the `SupportBundleSection` contract), the service that builds it (parallel sections under timeouts, strict schemas, the central redaction pass `redact.ts`, size caps, one audit row) and its controller. Three sections are built in and registered by `forRoot`: `meta` (installed platform package versions, section ids), `doctor` (the cached report) and `egress` (the egress inventory: hosts and scopes, never URLs). The app contributes the rest (`versions`, `telemetry` in the reference app). The envelope schema is `supportBundleSchema` in `@marinoscar/platform-contract/doctor`.

Does not: register any check by itself. Checks are registry entries the app contributes from its own feature modules, under `<module>/doctor/`, and they move with their slices later; the one check class this slice ships, `NetworkEgressDoctorCheck`, is generic over the app's contributors and is registered by the host slice (`PlatformHostCoreModule`, #879), as are the database, secrets-key and deployment-mode checks. It does not own the permission system (the app's host does), the web page (`@marinoscar/platform-web/doctor/ui`) or a queue job (a Doctor run is a bounded request, never a job; see [docs/specs/doctor.md §2.5](../../../../docs/specs/doctor.md)).

## Install and peer dependencies

Ships inside `@marinoscar/platform-api`; import it by its subpath:

```ts
import { DoctorCheck, DoctorCheckRegistry, DoctorModule } from '@marinoscar/platform-api/doctor';
```

No peer beyond the package's own ([README](../../README.md#install-and-peer-dependencies)); it uses `@nestjs/common`, `@nestjs/swagger`, `nestjs-zod` and `zod`, and takes its schemas from `@marinoscar/platform-contract/doctor`, a dependency of this package installed with it ([contract slice README](../../../platform-contract/src/doctor/README.md)).

## Quick start

1. Define the app's platform host once (`apps/api/src/platform/platform-host.ts`, see the [core README](../core/README.md#host-ports)).
2. Configure the module (the reference app's [`doctor.config.ts`](../../../../apps/api/src/doctor/doctor.config.ts)) and import `doctorModule` in the root module:

```ts
import { DoctorModule } from '@marinoscar/platform-api/doctor';
import { platformHost } from '../platform/platform-host';

export const doctorModule = DoctorModule.forRoot({ host: platformHost });
```

3. Contribute a check from the feature module that owns the capability (the reference app's worked example [`example-capability.doctor-check.ts`](../../../../apps/api/src/examples/doctor/example-capability.doctor-check.ts); the host slice's `db-connection.doctor-check.ts` is a packaged one):

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

Contribute a support-bundle section the same way (the reference app's [`about-support-bundle.section.ts`](../../../../apps/api/src/about/about-support-bundle.section.ts)). Copy the fields you mean to send into a new object and give the section a STRICT schema; a field outside it fails the section closed:

```ts
@Injectable()
export class AboutSupportBundleSection implements SupportBundleSection<VersionsSectionData>, OnModuleInit {
  readonly id = 'versions';
  readonly label = 'Versions';
  readonly schema = versionsSectionSchema; // z.object({ ... }).strict()

  constructor(private readonly registry: SupportBundleRegistry, private readonly about: AboutService) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async collect(): Promise<VersionsSectionData> {
    const report = await this.about.describe();
    return { api: { version: report.api.version, deploymentMode: report.api.deploymentMode } /* , ... allowlisted fields */ };
  }
}
```

A section that needs a permission beyond the route's declares `permission` (the reference app's telemetry section declares `telemetry:query`) and is `omitted` for a caller without it; `collect()` returns `omitSupportBundleSection(reason)` when its capability is off.

4. Optionally, describe outbound dependencies (the reference app's [`docs-egress.contributor.ts`](../../../../apps/api/src/openapi/docs-egress.contributor.ts)). The `network.egress` check itself is registered by the host slice's `PlatformHostCoreModule` (#879), which also binds `DEPLOYMENT_NETWORK_SOURCE` to its `DeploymentNetworkService`:

```ts
// Once, globally: where `network.egress` reads DEPLOYMENT_NETWORK, and the check itself.
providers: [
  DeploymentNetworkService, // { readonly network: 'online' | 'air-gapped' }
  { provide: DEPLOYMENT_NETWORK_SOURCE, useExisting: DeploymentNetworkService },
  NetworkEgressDoctorCheck,
],

// In each feature module: a read-only contributor.
@Injectable()
export class DocsEgressContributor implements EgressContributor, OnModuleInit {
  readonly id = 'docs';
  constructor(private readonly egress: EgressRegistry) {}
  onModuleInit(): void { this.egress.register(this); }
  async describe(): Promise<EgressDependency[]> {
    return [egressDependency({ id: 'docs.scalar-cdn', capability: 'API reference', direction: 'browser',
      enabled: true, required: false, hosts: ['https://cdn.jsdelivr.net/npm/@scalar/api-reference'],
      degradation: '/api/docs renders an empty page' })];
  }
}
```

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
| `supportBundle` | `SupportBundleOptions \| false` | enabled, defaults below | The support bundle route. `false`: no route and no built-in sections (`SupportBundleRegistry` is still provided). |
| `supportBundle.appSlug` | `string` | `'app'` | The slug in the file name `support-bundle-<appSlug>-<yyyyMMdd'T'HHmmss'Z'>.json`; lowercase letters, digits, dashes. The reference app passes `APP_SLUG`. |
| `supportBundle.principal` | `(request) => { userId; permissions } \| null` | `request.requestUser`, then `request.user`, when either has a string `id` and a string-array `permissions` | Who is downloading (audited; section permissions are checked against it). `null` answers 403. |
| `supportBundle.sectionTimeoutMs` | `number` | `10_000` | Per-section ceiling when a section declares no `timeoutMs`. |

Support bundle bounds are fixed, not options: 512 KiB of pretty-printed JSON per section (`SUPPORT_BUNDLE_SECTION_MAX_BYTES`; a larger section becomes `{ status: 'ok', data: null, truncated: true }`) and 2 MiB per bundle (`SUPPORT_BUNDLE_MAX_BYTES`; the largest sections are truncated first). Sections run in parallel, so a build takes at most the longest section timeout. Why this is a bounded request and not a queue job: [docs/specs/doctor.md §2.10](../../../../docs/specs/doctor.md#210-support-bundle).

The resolved options (defaults applied, frozen) are provided under `DOCTOR_MODULE_OPTIONS`.

### Categories

`PLATFORM_DOCTOR_CATEGORIES` is `core, auth, maintenance, storage, email, push, ai, jobs, nodes, backup, telemetry, network` (`DOCTOR_CATEGORIES` is a deprecated alias with the same values). An app adds a category simply by using a new string in its check's `category`, and reorders or extends the list with `categoryOrder`; the web page takes its labels from `DoctorPage`'s `categories` prop. No package file is edited.

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `DoctorModule.forRoot` | option | `forRoot(options: DoctorModuleOptions): DynamicModule` | Mount the Doctor once in the app's root module | stable | [example](../../../../apps/api/src/doctor/doctor.config.ts) |
| `DoctorModuleOptions` | option | `{ host; permission?; path?; categoryOrder?; defaultTimeoutMs?; cacheTtlMs? }` | Change the permission, path, category order, timeout or cache TTL | experimental | [example](../../../../apps/api/src/doctor/doctor.config.ts) |
| `DOCTOR_MODULE_OPTIONS` | token | `unique symbol` -> `ResolvedDoctorModuleOptions` | Read the resolved options (permission, path, order, timeout, TTL) in an app provider | experimental | [example](../../../../apps/api/src/doctor/doctor.config.ts) |
| `DoctorCheck` | registry | `{ id; category; label; settingsPath?; timeoutMs?; dependsOn?; run(): Promise<DoctorCheckOutcome> }` | Write a check for a capability the app owns | stable | [example](../../../../apps/api/src/examples/doctor/example-capability.doctor-check.ts) |
| `DoctorCheckRegistry.register` | registry | `register(check: DoctorCheck): void` | Add the check to the report from its own `onModuleInit` | stable | [example](../../../../apps/api/src/examples/doctor/example-capability.doctor-check.ts) |
| `EgressContributor` | registry | `{ id; describe(): Promise<EgressDependency[]> }` | Describe the outbound hosts a capability of the app reaches (read-only, hostnames only) | experimental | [example](../../../../apps/api/src/openapi/docs-egress.contributor.ts) |
| `EgressRegistry.register` | registry | `register(contributor: EgressContributor): void` | Add the contributor to the inventory from its own `onModuleInit` | experimental | [example](../../../../apps/api/src/openapi/docs-egress.contributor.ts) |
| `EgressDependency` | registry | `{ id; capability; direction; enabled; hosts; scope; required; degradation; settingsPath?; count? }` | The shape of one outbound dependency a contributor returns | experimental | [example](../../../../apps/api/src/openapi/docs-egress.contributor.ts) |
| `egressDependency` | registry | `egressDependency(input: EgressDependencyInput): EgressDependency` | Build an entry from raw URLs or `host:port`: reduces to hostnames, de-duplicates, caps at 20, computes `scope` | experimental | [example](../../../../apps/api/src/openapi/docs-egress.contributor.ts) |
| `classifyHost` | registry | `classifyHost(host: string): 'public' \| 'private' \| 'unknown'` | Judge a host by its shape alone (no DNS), for a contributor that needs the scope itself | experimental | [example](../../../../apps/api/test/doctor/network-egress.integration.spec.ts) |
| `SupportBundleOptions` | option | `{ appSlug?; principal?; sectionTimeoutMs? }` (or `false`) as `DoctorModuleOptions.supportBundle` | Name the bundle file after the app, resolve the caller differently, or turn the bundle off | experimental | [example](../../../../apps/api/src/doctor/doctor.config.ts) |
| `SupportBundleSection` | registry | `{ id; label; permission?; schema; timeoutMs?; collect(ctx): Promise<T \| SupportBundleOmission> }` | Contribute a capability's facts to the support bundle | experimental | [example](../../../../apps/api/src/about/about-support-bundle.section.ts) |
| `SupportBundleRegistry.register` | registry | `register(section: SupportBundleSection): void` | Add the section to the bundle from its own `onModuleInit` | experimental | [example](../../../../apps/api/src/about/about-support-bundle.section.ts) |
| `DEPLOYMENT_NETWORK_SOURCE` | token | `unique symbol` -> `{ readonly network: 'online' \| 'air-gapped' }` | Bind the app's parsed `DEPLOYMENT_NETWORK` so `network.egress` grades the inventory | experimental | [example](../../../../apps/api/test/doctor/network-egress.integration.spec.ts) |

Supporting exports: `DoctorService` (`run({ category?, refresh? })`, `invalidate()`), `DoctorCheckRegistry.get` / `list`, `DoctorStatus`, `DOCTOR_STATUSES`, `DOCTOR_STATUS_RANK`, `worstStatus`, `DoctorCheckOutcome`, `DoctorDataValue`, `DoctorCategory`, `CoreDoctorCategory`, the defaults `DEFAULT_DOCTOR_PERMISSION`, `DEFAULT_DOCTOR_PATH`, `DOCTOR_DEFAULT_TIMEOUT_MS`, `DOCTOR_CACHE_TTL_MS`, `DOCTOR_FALLBACK_REMEDY`, the DTOs `DoctorQueryDto` and `DoctorReportDto` with their types `DoctorQuery`, `DoctorReport`, `DoctorCheckReport`, and `createDoctorController` (called by `forRoot`; an app never needs it). Egress (#773): `NetworkEgressDoctorCheck` (the `network.egress` check; the host slice registers it), `gradeEgress` (its pure verdict table), `describeEgress` (runs every contributor, a throw becomes one `unknown` entry; what a support bundle reads), `hostnameOf`, `scopeOfHosts`, `DEPLOYMENT_NETWORKS`, `DeploymentNetwork`, `DeploymentNetworkSource`, `EgressDependencyInput`, `EgressDirection`, `EgressScope`, `EGRESS_MAX_HOSTS`, `AIR_GAPPED_RUNBOOK`, `NETWORK_EGRESS_CHECK_ID`. Support bundle (#772, experimental): `SupportBundleService` (`build(actor)`, `download(actor)`), `SupportBundleRegistry.get` / `list`, `SupportBundleSectionContext`, `SupportBundlePrincipal`, `SupportBundleOmission`, `omitSupportBundleSection`, `isSupportBundleOmission`, `SupportBundleBuild`, `ResolvedSupportBundleOptions`, `defaultSupportBundlePrincipal`, the redaction pass `redactValue` / `redactString` with `RedactValueOptions`, `RedactionResult`, `SENSITIVE_KEY_PATTERN`, `COMMIT_SHA_ALLOWED_PATHS`, `REDACTED`, `SUPPORT_BUNDLE_REDACTION_VERSION`, the constants `SUPPORT_BUNDLE_SECTION_TIMEOUT_MS`, `SUPPORT_BUNDLE_SECTION_MAX_BYTES`, `SUPPORT_BUNDLE_MAX_BYTES`, `SUPPORT_BUNDLE_SUBPATH`, `SUPPORT_BUNDLE_AUDIT_ACTION`, the DTO `SupportBundleDto` and `createSupportBundleController` (called by `forRoot`).

## Data

None. No models, migrations or seeds; the report is computed per request and held in memory for `cacheTtlMs`.

## Permissions and settings

Requires `system_settings:read` by default (`DEFAULT_DOCTOR_PERMISSION`), enforced through the app's host access port, so the route gets exactly the app's own `@Auth()` (guards, RBAC metadata, `x-rbac`). It declares no permission of its own: the report describes the deployment's configuration, which is what `system_settings:read` already covers, and every check is read-only. No `doctor:read` exists. The web card must declare the same literal (CLAUDE.md, Settings UI Pattern rule 3).

Reads no settings itself; checks read whatever their capability's settings are.

`GET <path>/support-bundle` requires the same permission as the report (no new permission). A section may require one more (`SupportBundleSection.permission`); a caller without it gets that section `omitted`.

## UI

None in this slice. The page, its card descriptor (`doctorSettingsPage`) and its components are in `@marinoscar/platform-web/doctor/ui`.

## Infra

No compose fragment. The slice reads no environment variable itself; `network.egress` grades by the app's `DEPLOYMENT_NETWORK` (`online` default, `air-gapped`), which the app parses at startup (an invalid value fails it) and binds under `DEPLOYMENT_NETWORK_SOURCE`. Unbound, the check assumes `online`. The reference app declares the variable in `infra/compose/.env.example`; see [docs/runbooks/air-gapped.md](../../../../docs/runbooks/air-gapped.md).

## Observability

`DoctorService` logs one `warn` line when a check throws: `Doctor check "<id>" threw: <message>` (the throw itself becomes a `fail` row). `NetworkEgressDoctorCheck` logs one `warn` line per contributor that throws: `Egress contributor "<id>" threw: <message>` (it becomes one `unknown` entry). `SupportBundleService` logs one `log` line per download (bytes, replacements, duration, `id=status` per section), a `warn` per failed, timed-out, schema-breaking or truncated section (redacted; for a schema failure the offending paths only, never values), a `warn` when the audit write fails and a boot-time `warn` when no `AUDIT_SINK` is bound. Each download is audited as `support_bundle:download` (`targetType: 'deployment'`, `targetId: 'support_bundle'`, `meta: { sections: 'id=status,...', bytes, replacements }`, never an email) through the host's `AUDIT_SINK`. Nothing else is logged; no metric or span is emitted.

## Security notes

The five rules every check follows (header of `doctor-check.interface.ts`):

1. A check never throws; a crashed probe is a `fail` with the error's message (the service guards every call too: a throw becomes `fail`, a hang becomes `fail` after the timeout).
2. `remedy` is expected on `warn` and `fail` and names a settings page, a command or a variable; the service fills a generic one otherwise.
3. Checks are READ-ONLY: never a "test" service, never a write of an object, a row or an audit event, never a job or a model call. Anyone holding the permission may run it against production, as often as they like.
4. Results never contain secret material, in `detail`, `error` or `data`.
5. `skip` means "not evaluated": a dependency did not pass, or the capability is intentionally off.

Egress contributors are held to rules 3 and 4 as well: `describe()` reads settings through masked views only, performs no network I/O (no DNS lookup, no connect: `classifyHost` judges by shape), and returns hostnames only; `egressDependency()` strips scheme, userinfo, port, path and query, so a push endpoint's capability path or a URL's embedded credential never leaves it. The check's `data` is scalars only.

The support bundle is an egress surface: a file that leaves the deployment. Every section passes a strict schema (an unknown field drops its data), then the central redaction pass rules v1 replaces sensitive keys and secret-looking values (PEM blocks, bearer tokens, JWTs, URL userinfo and query strings, `pat_`/`nod_` tokens, AWS key ids, emails, IPv4/IPv6 addresses, long hex and base64 runs including UUIDs; a 40-hex commit SHA survives only at `COMMIT_SHA_ALLOWED_PATHS`), counted in `redaction.replacements`. The caller's id and email are never in the file; raw telemetry rows never are.

The route always answers 200 for an authorised caller (a failing check is a row), validates its query with zod (`category` is a lowercase identifier, `refresh` is `true` or `false`), is not `@AllowDuringMaintenance()`, and `forRoot` refuses to build a controller without a host, so the route is never public.

## Conformance suite

None yet. A planned "doctor checks are read-only" suite (statically refusing the side-effecting test services in a check) will run through `runPlatformConformance()`. Until then the package's own tests (`test/doctor/`) and the reference app's `apps/api/test/doctor/doctor.integration.spec.ts` (RBAC, every module's checks wired, no secret on the wire) pin the behaviour.

## Upgrade notes

Support bundle (#772), experimental and additive: a new route `GET <path>/support-bundle` on the same permission; `SupportBundleRegistry` and `SupportBundleService` in the module's providers and exports; built-in `meta`, `doctor` and `egress` sections. Bind `AUDIT_SINK` so downloads are audited, pass `supportBundle: { appSlug }` to name the file, or `supportBundle: false` to keep the route off.

Egress inventory (#773), additive: `network` is appended to `PLATFORM_DOCTOR_CATEGORIES`; `forRoot` also provides and exports `EgressRegistry`. Nothing registers `network.egress` until `PlatformHostCoreModule.forRoot()` is imported (it provides `NetworkEgressDoctorCheck`).

First packaged release (#696). Moving from the app's own `apps/api/src/doctor/`:

- Import `DoctorCheck`, `DoctorCheckOutcome` and `DoctorCheckRegistry` from `@marinoscar/platform-api/doctor` instead of `../doctor/doctor-check.interface` / `doctor-check.registry`.
- Replace the app's `DoctorModule` with `DoctorModule.forRoot({ host })` and delete the app's controller, service, registry and DTOs. The route, the permission, the OpenAPI operation (`doctor_getReport`) and the response are unchanged.
- `DOCTOR_CATEGORIES` is now `PLATFORM_DOCTOR_CATEGORIES`; the old name remains as a deprecated alias.

Since #701 the schemas live in `@marinoscar/platform-contract/doctor`. `DoctorReportDto` and `DoctorQueryDto` are unchanged, and `DoctorStatus`, `DOCTOR_STATUSES`, `DOCTOR_STATUS_RANK`, `DoctorReport`, `DoctorCheckReport` and `DoctorQuery` are still exported here (re-exported from the contract), so no import has to change; `DOCTOR_STATUSES` is now a readonly tuple rather than `readonly DoctorStatus[]`. To validate or extend a payload, import the schema from the contract. The OpenAPI document is byte-identical.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `DoctorModule.forRoot: ... is required ... never public` at boot | `forRoot` was called without the app's host. Pass `definePlatformHost(...)` from `apps/api/src/platform/platform-host.ts`. |
| `Duplicate doctor check id "<id>": A and B both register it` at boot | Two checks share an id. Ids are unique across the app; rename one. |
| `Registry "doctor-checks" is frozen` | A check registered after bootstrap. Register from `onModuleInit`, never later. |
| A check is missing from the report | Its provider is not in any module, or its `onModuleInit` does not call `register(this)`. |
| `Duplicate egress contributor id "<id>"` at boot | Two egress contributors share an id; rename one. |
| No `network.egress` row | The app does not import `PlatformHostCoreModule.forRoot()`, which registers `NetworkEgressDoctorCheck`. |
| `network.egress` passes although the deployment is offline | `DEPLOYMENT_NETWORK` is unset or `online`, or no `DEPLOYMENT_NETWORK_SOURCE` is bound: online it is an inventory and always passes. |
| `Nest can't resolve dependencies of <Check> (DoctorCheckRegistry, ...)` | `DoctorModule.forRoot()` is not imported in the root module (or in the test module). |
| A bundle section is `error`, "section output did not match its schema" | `collect()` returned a field its strict schema does not list; the API log names the path. Add it to the schema on purpose, or stop returning it. |
| The bundle route answers 403 "The caller could not be identified" | The default `principal` found no `requestUser`/`user` with `id` and `permissions`; pass `supportBundle.principal`. |
| `No AUDIT_SINK is bound: support-bundle downloads will not be audited` at boot | Bind the audit port with `PlatformHostModule.forRoot({ audit })`. |
| Every row is `fail` "Timed out after 5000ms" | The probe hangs; raise the check's `timeoutMs` or `defaultTimeoutMs` only if the service is legitimately slow. |

## Links

- Spec: [docs/specs/doctor.md](../../../../docs/specs/doctor.md); runbooks: [docs/runbooks/doctor.md](../../../../docs/runbooks/doctor.md), [docs/runbooks/air-gapped.md](../../../../docs/runbooks/air-gapped.md) (`network.egress`).
- Platform spec: [platform-packages.md](../../../../docs/specs/platform-packages.md), Roadmap, Wave 1.
- The web side: `@marinoscar/platform-web/doctor` ([README](../../../platform-web/src/doctor/README.md)).
- Host ports and the controller-factory recipe: [core README](../core/README.md#host-ports).
- Package README: [platform-api](../../README.md).
