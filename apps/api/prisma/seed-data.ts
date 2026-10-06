// =============================================================================
// Seed Data Definitions
// =============================================================================
//
// The declarative half of `seed.ts`, in a module of its own so it can be
// asserted by a test (#256, epic #254). `seed.ts` instantiates a PrismaClient
// and calls `main()` at import time — it is a script, not a module — so nothing
// in a Jest run can import it to check that the roles it seeds actually name
// permissions it declares, or that the system-settings blob it writes still
// matches the API's `DEFAULT_SYSTEM_SETTINGS`. Splitting the data out costs one
// import and buys `test/prisma/seed-data.spec.ts`.
//
// This file stays framework-free and dependency-free on purpose: it is compiled
// by `prisma/tsconfig.json` under ts-node when `npm run prisma:seed` runs, with
// no Nest build anywhere in sight.
//
// IDEMPOTENCE IS A PROPERTY OF `seed.ts`, NOT OF THIS FILE — every write there
// is an `upsert` keyed on a natural unique (`role.name`, `permission.name`,
// `rolePermission.roleId_permissionId`, `systemSettings.key`), so a second run
// updates the same rows instead of inserting duplicates. What this file
// contributes is that the data itself contains no duplicates to insert, which
// the spec checks.
//
// WHERE THE RBAC DATA COMES FROM (#676, PP-1.4). Roles, permissions and their
// default grants are no longer written here. Each is declared once, beside the
// module that enforces it (`src/<module>/<module>.permissions.ts`,
// `src/common/permissions/platform-roles.ts`, and the app-owned
// `src/app-registrations/permissions.ts`), and registered into the role and
// permission registries (`src/common/permissions`). The seed cannot import
// those: the production image that runs `npm run prisma:seed` carries `dist/`
// and `prisma/` but no `src/`. So `npm run catalog:permissions --workspace=api`
// writes the registries out to `prisma/catalog/permissions.json`, committed,
// and this file reads that. `test/prisma/permission-catalog.spec.ts` fails when
// the JSON is stale, and pins the seeded data to a literal baseline. To change
// a permission or a grant, edit its declaration file and regenerate; never edit
// the JSON by hand. The rationale for each split and each grant lives in the
// declaration file now, next to the entry.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface PermissionCatalogFile {
  roles: Array<{ name: string; description: string }>;
  permissions: Array<{ name: string; description: string }>;
  rolePermissions: Record<string, string[]>;
}

const catalog = JSON.parse(
  readFileSync(join(__dirname, 'catalog', 'permissions.json'), 'utf8'),
) as PermissionCatalogFile;

/** Every role, in registration order (platform roles, then the app's). */
export const ROLES: ReadonlyArray<{ readonly name: string; readonly description: string }> =
  catalog.roles;

/** Every permission, in registration order (platform permissions, then the app's). */
export const PERMISSIONS: ReadonlyArray<{ readonly name: string; readonly description: string }> =
  catalog.permissions;

// Role to permissions mapping
export const ROLE_PERMISSIONS: Record<string, string[]> = catalog.rolePermissions;

// Default system settings
// Must stay in step with `DEFAULT_SYSTEM_SETTINGS` in
// `src/common/types/settings.types.ts` — the seed cannot import it (this script
// runs outside the Nest build), so the two are a deliberate duplicate. A seeded
// row missing a modelled block is not fatal (`readKnownSettings` degrades it to
// the same defaults), but it does mean the first PATCH is what materialises it.
export const DEFAULT_SYSTEM_SETTINGS = {
  // #225, epic #215. Browser notifications on, nothing suppressed: an operator
  // opts OUT of the channel, never into it.
  notifications: {
    browserEnabled: true,
    disabledEvents: [] as string[],
  },
  // #256, epic #254. Inert defaults: backups and the maintenance window ship
  // off, and the only switch that is on bounds a history table nothing writes
  // to yet. `test/prisma/seed-data.spec.ts` asserts this object still equals
  // the API's `DEFAULT_SYSTEM_SETTINGS` key for key and value for value, which
  // is the only thing standing between the deliberate duplication above and a
  // seeded row that disagrees with the code reading it.
  jobs: {
    history: {
      retentionDays: 30,
      purgeEnabled: true,
    },
    stuckThresholdMinutes: 30,
  },
  nodes: {
    staleHeartbeatSeconds: 90,
    offlineStaleMultiplier: 4,
    offlineRetentionDays: 30,
    // OFF, and the default is the point (#349, epic #345): a fresh deployment
    // does not hand its worker fleet credentials to its own database because
    // somebody registered a node. An administrator opens that trust boundary
    // deliberately.
    jobSecretBrokerEnabled: false,
  },
  databaseBackup: {
    enabled: false,
    frequency: 'daily',
    dayOfWeek: 0,
    dayOfMonth: 1,
    timeOfDay: '02:00',
    timezone: 'UTC',
    retentionCount: 7,
    // EMPTY, meaning "whatever provider `storage.provider` names" (#373, epic
    // #372) — and it must stay byte-identical to the API's
    // `DEFAULT_SYSTEM_SETTINGS`, which `test/prisma/seed-data.spec.ts` pins.
    // This field is a pin an operator sets deliberately; seeding a literal
    // provider id would pin every fresh deployment to a provider nobody chose,
    // and a deployment that then selected R2 would fail every backup with a
    // 400. Empty defers instead of choosing.
    storageProvider: '',
    runStaleMinutes: 120,
    compressionLevel: 6,
    restoreRollbackMode: 'retain_database',
    oldDatabaseRetentionHours: 48,
    // OFF (#352, epic #345). Node offload needs TWO deliberate decisions —
    // this one and `nodes.jobSecretBrokerEnabled` above — because "these
    // machines may hold a short-lived credential" and "the whole database may
    // be dumped somewhere other than the API server" are different questions.
    nodeOffloadEnabled: false,
  },
  maintenance: {
    enabled: false,
    // Names no product and no repository — this is a template repo, and the
    // API-side copy of this string (`DEFAULT_MAINTENANCE_MESSAGE`) does not
    // either. A fork that wants its name here reads `APP_NAME` from
    // `@app/shared` at render time rather than baking it into a seeded row.
    message:
      'This service is temporarily unavailable for scheduled maintenance. Please try again shortly.',
    allowAdmins: true,
    startedAt: null as string | null,
    startedById: null as string | null,
  },
  // #373, epic #372. UNCONFIGURED, but — unlike the namespaces above it — NO
  // LONGER INERT: parts 2 and 3 landed the consumers. `StorageConfigService`
  // resolves this namespace (plus the encrypted secret) on every storage call,
  // `ResolvingStorageProvider` builds its S3 client from the result, and
  // `ObjectsService`, `ProfileImageService` and `DatabaseBackupRunnerService`
  // record `provider` onto the rows that say where bytes went.
  //
  // Seeding it still changes no behaviour, and for a different reason than
  // before: every value here is the UNCONFIGURED state. An empty `bucket` is
  // what `resolveStorageConfig` reads as "not configured", so a fresh install
  // answers storage calls with a 503 naming the missing fields whether this
  // block was seeded or not. What seeding buys is that the first admin who
  // opens the storage settings page finds the keys already there instead of
  // materialising them.
  //
  // `provider: 's3'` names the shape the empty fields would be filled in for;
  // "no storage configured" is `bucket === ''`, not a separate provider value.
  //
  // NO SECRET ACCESS KEY IS SEEDED HERE, and none can be: the secret half of
  // the storage credential lives in the encrypted `credentials` table at
  // `(purpose 'storage', name 'default')`, which is written through
  // `CredentialsService` at runtime and is not part of this document at all.
  storage: {
    provider: 's3',
    bucket: '',
    // Empty, not 'us-east-1' — a region nobody chose is how a deployment ends
    // up with a settings page that looks filled in and requests that fail.
    region: '',
    endpoint: '',
    accountId: '',
    // The IDENTIFIER half of the credential only.
    accessKeyId: '',
    // `null` means "use this vendor's convention" and must stay byte-identical
    // to `DEFAULT_SYSTEM_SETTINGS` (test/prisma/seed-data.spec.ts guards it).
    forcePathStyle: null,
  },
  // #423, epic #419, umbrella #418. OFF, and INERT, matching every namespace
  // above it that ships ahead of its own consumers: `enabled: false` means a
  // fresh deployment gains no AI capability nobody asked for merely because
  // this namespace exists. `byok` is the default key policy — every call
  // uses its caller's own saved key, with no deployment-wide fallback to
  // secure. `allowBackgroundRuns: true` mirrors `jobs.history.purgeEnabled`
  // being the one "on" value above: the queue is this application's normal
  // way of doing anything that takes a while. `logPromptContent: false` is a
  // deliberate privacy default — prompt text may carry a user's own
  // sensitive input.
  //
  // Must stay byte-identical to the API's `DEFAULT_SYSTEM_SETTINGS`, which
  // `test/prisma/seed-data.spec.ts` pins. NO API KEY IS SEEDED HERE, and none
  // can be: a user's own key is `UserAiKey.secret`, in its own table; an
  // org-wide fallback key belongs in the encrypted credential store.
  ai: {
    enabled: false,
    keyPolicy: 'byok',
    providers: {
      openai: {
        enabled: false,
      },
      anthropic: {
        enabled: false,
      },
      gemini: {
        enabled: false,
      },
      'azure-openai': {
        enabled: false,
      },
      'openai-compatible': {
        enabled: false,
      },
    },
    defaults: {
      allowBackgroundRuns: true,
      allowRealtime: false,
    },
    logPromptContent: false,
    usageRetentionDays: 180,
    hostedTools: {
      web_search: false,
      file_search: false,
      code_interpreter: false,
      image_generation: false,
      mcp: false,
      mcpAllowedHosts: [],
    },
    limits: {},
  },
  // Epic #528, story #533. OFF, and INERT, matching every namespace above it
  // that ships ahead of its own consumers: a fresh deployment does not start
  // collecting or retaining observability data nobody asked for merely
  // because this namespace exists. Must stay byte-identical to the API's
  // `DEFAULT_SYSTEM_SETTINGS`, which `test/prisma/seed-data.spec.ts` pins.
  telemetry: {
    enabled: false,
    retentionDays: 30,
    // #565: null = follow `APP_SLUG` — never the slug literally, which would
    // freeze a renamed fork's telemetry identity at seed time.
    instanceId: null,
    query: {
      maxRows: 10000,
      timeoutSeconds: 30,
    },
    assistant: {
      enabled: false,
      provider: null as string | null,
      modelId: null as string | null,
      shareResults: true,
      maxResultRowsToModel: 100,
      maxSteps: 15,
    },
  },
  // #681. Retention: three policies on, audit off (a compliance record).
  // Must stay byte-identical to the API's `DEFAULT_SYSTEM_SETTINGS`, which
  // `test/prisma/seed-data.spec.ts` pins.
  retention: {
    notifications: { enabled: true, days: 180 },
    notificationDeliveries: { enabled: true, days: 90 },
    auditEvents: { enabled: false, days: 365 },
    aiRuns: { enabled: true, days: 90 },
  },
};
