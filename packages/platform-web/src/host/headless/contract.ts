// =============================================================================
// The host slice's wire shapes (issues #258, #401; packaged by #891)
// =============================================================================
//
// The web mirror of `GET`/`PUT /api/admin/maintenance`
// (`platform-api/src/host/maintenance/dto/update-maintenance.dto.ts`) and of
// `GET /api/admin/about` (`platform-api/src/host/about/dto/about-response.dto.ts`).
// Mirrored rather than imported because the API's DTOs are Nest classes; a
// contract slice for them is a follow-up.
// =============================================================================

// ---- Maintenance mode (issue #258, epic #254) --------------------------------
//
// The marker string and the retry delay are NOT restated here: they are the
// wire CONTRACT rather than a shape, and they live beside the code that
// recognises them, in `maintenance-block.ts`.

/**
 * Which of the three layers decided `enabled`. Reported, never inferred.
 *
 * @stability experimental
 */
export type MaintenanceSource = 'env' | 'memory' | 'persisted';

/**
 * An override held in the API process only (the database restore's swap
 * window). `message` and `allowAdmins` are optional on it because the caller
 * that installs one usually has nothing to say about them.
 *
 * @stability experimental
 */
export interface MaintenanceOverride {
  /** Whether the override opens a window. */
  enabled: boolean;
  /** The message shown to blocked users, when the override supplies one. */
  message?: string;
  /** Whether administrators pass the window, when the override says. */
  allowAdmins?: boolean;
}

/**
 * The stored `maintenance` namespace of the system settings document.
 *
 * @stability experimental
 */
export interface MaintenancePolicy {
  /** Whether the window is open. */
  enabled: boolean;
  /** The message shown to blocked users. */
  message: string;
  /** Whether administrators may keep using the application during the window. */
  allowAdmins: boolean;
  /** ISO-8601 time the window opened, stamped by the API; `null` when closed. */
  startedAt: string | null;
  /** The user who opened the window, stamped by the API; `null` when closed. */
  startedById: string | null;
}

/**
 * The effective state, plus every contributing layer, separately.
 *
 * `layers` is the reason the admin page exists as more than a switch: an
 * operator asking "I turned it off and it is still on" needs to be shown that
 * `MAINTENANCE_MODE=true` is in the environment and outranks the row they just
 * wrote. Rendering only `enabled` would make that invisible from the UI in
 * exactly the way it would have been invisible from the API without this block.
 *
 * @stability experimental
 */
export interface MaintenanceStatus extends MaintenancePolicy {
  /** The layer that decided `enabled`. */
  source: MaintenanceSource;
  /** Each contributing layer, separately, highest priority first. */
  layers: {
    /** The `MAINTENANCE_MODE` environment variable. */
    env: {
      /** Whether the variable is set at all. */
      present: boolean;
      /** `null` means the variable is unset, or set to something that is neither `'true'` nor `'false'`. */
      enabled: boolean | null;
    };
    /** The in-memory override (the database restore's swap window). */
    memory: {
      /** Whether an override is installed in this API process. */
      present: boolean;
      /** The override itself, or `null` when none is installed. */
      override: MaintenanceOverride | null;
    };
    /** The stored `maintenance` namespace of the system settings document. */
    persisted: {
      /** `false` means the row could not be read and `value` is the last known state. */
      readable: boolean;
      /** The stored policy. */
      value: MaintenancePolicy;
    };
  };
}

/**
 * The `PUT` body. `enabled` is the only required field, exactly as in
 * `updateMaintenanceSchema`.
 *
 * `startedAt` / `startedById` are ABSENT on purpose and must stay absent: the
 * API stamps them itself and refuses to take them from a caller, because an
 * audit trail the audited party can dictate is not one.
 *
 * @stability experimental
 */
export interface UpdateMaintenanceInput {
  /** Open (`true`) or close (`false`) the window. */
  enabled: boolean;
  /** The message shown to blocked users (1 to 1000 characters). */
  message?: string;
  /** Whether administrators may keep using the application during the window. */
  allowAdmins?: boolean;
}

// =============================================================================
// About — what is actually deployed here (issue #401, epic #397)
// =============================================================================
//
// Mirrors `platform-api/src/host/about/dto/about-response.dto.ts` field for field. Read
// that file's header before changing anything here: the shape is deliberately
// built to carry PARTIAL TRUTH, and the nullability below is the contract
// rather than defensive typing.
//
// ⚠ `GET /api/admin/about` ALWAYS ANSWERS 200. A missing deploy document, a
// malformed one and an unreachable database are all fields, never statuses. So
// nothing in this block should ever be reached through an error path — a `null`
// here is a FACT the page renders, not a failure it hides.

/**
 * The API process's own version. Always known; never read from disk.
 *
 * @stability experimental
 */
export interface AboutApi {
  /** The API process's own version. */
  version: string;
  /**
   * `DEPLOYMENT_MODE` as the API parsed it at startup (#685). `saas` means
   * in-app database restore is disabled. Optional: an older API omits it.
   */
  deploymentMode?: 'self-hosted' | 'saas';
}

/** @stability experimental */
export interface AboutApp {
  /** The application's name, as the deploy recorded it. */
  name: string | null;
  /** The application's version, as the deploy recorded it. */
  version: string | null;
  /** The commit actually deployed — the single most useful field on the page. */
  commitSha: string | null;
  /** The branch or tag the deploy was taken from. */
  ref: string | null;
}

/** @stability experimental */
export interface AboutDeployedBy {
  /** Which client wrote the document, e.g. `appctl`. */
  cli: string | null;
  /** The deploy client's version. */
  version: string | null;
}

/**
 * How far behind the remote this deployment was AT `checkedAt`.
 *
 * ⚠ COPIED FROM THE DOCUMENT, NEVER REFRESHED — the API performs no network
 * I/O for this endpoint at all. The number is as old as `checkedAt` says it is,
 * which is why the page must never render one without the other.
 *
 * @stability experimental
 */
export interface AboutRemote {
  /** How many commits behind the remote the deployment was at `checkedAt`. */
  commitsBehind: number | null;
  /** ISO-8601 time the remote was last compared. */
  checkedAt: string | null;
}

/**
 * The deploy run that wrote the document.
 *
 * `outcome: 'failure'` beside a COMPLETE document is the third render state —
 * see `ui/about-page.tsx`. `failedStep` names where it stopped, and
 * `completed` still lists every step that really ran.
 *
 * @stability experimental
 */
export interface AboutRun {
  /** The steps that really ran, in order. */
  completed: string[];
  /** The step the run stopped at; `null` for a run that did not fail. */
  failedStep: string | null;
  /** `failure` beside a complete document is the third render state. */
  outcome: 'success' | 'failure' | null;
}

/**
 * A liveness fact from the same indicator `GET /api/health/ready` uses.
 *
 * @stability experimental
 */
export interface AboutDatabase {
  /** `up` when the probe answered. */
  status: string;
  /** How long the probe took, e.g. `4ms`. */
  responseTime: string;
}

/**
 * Which `appctl deploy` subcommand wrote a record (issue #392).
 *
 * @stability experimental
 */
export type DeployCommand = 'install' | 'update';

/**
 * The reverse proxy in front of this deployment, as the deploy recorded it
 * (issue #392). Every field may be `null` — an older record, or a value the
 * CLI could not determine.
 *
 * @stability experimental
 */
export interface AboutProxy {
  /** Whether the proxy is a bundled container or the host's. */
  mode: 'container' | 'host' | null;
  /** The proxy container's name, when it is one. */
  container: string | null;
  /** ISO-8601. When the TLS certificate the proxy serves expires. */
  certificateExpiresAt: string | null;
}

/**
 * The host the deploy ran on, captured AT DEPLOY TIME (issue #392) — not live.
 * `capturedAt` says how old it is.
 *
 * @stability experimental
 */
export interface AboutHost {
  /** The host's name. */
  hostname: string | null;
  /** The operating system. */
  os: string | null;
  /** The kernel version. */
  kernel: string | null;
  /** The CPU architecture. */
  arch: string | null;
  /** The number of CPUs. */
  cpus: number | null;
  /** Installed memory, in bytes. */
  memoryBytes: number | null;
  /** The Docker version. */
  dockerVersion: string | null;
  /** The Docker Compose version. */
  composeVersion: string | null;
  /** ISO-8601 time the facts were captured (they are not live). */
  capturedAt: string | null;
}

/**
 * One successful deploy, newest first, capped at 20 by the writer (issue #392).
 *
 * @stability experimental
 */
export interface AboutHistoryEntry {
  /** ISO-8601 finish time. */
  at: string;
  /** Which `appctl deploy` subcommand ran. */
  command: DeployCommand;
  /** The commit deployed. */
  commitSha: string | null;
  /** The commit it replaced; `null` for a first install. */
  previousCommitSha: string | null;
  /** The branch or tag the deploy was taken from. */
  ref: string | null;
  /** How long the run took; `null` when unmeasured. */
  durationMs: number | null;
  /** The deploy client's version. */
  cliVersion: string | null;
  /** History holds successful runs only. */
  outcome: 'success';
}

/**
 * Live facts about the API process itself — never read from disk (issue #392).
 *
 * @stability experimental
 */
export interface AboutRuntime {
  /** ISO-8601 time this API process started. */
  processStartedAt: string | null;
  /** The Node.js version of this API process. */
  nodeVersion: string | null;
  /** `NODE_ENV` of this API process. */
  environment: string | null;
}

/**
 * `ok` — a document was read. `absent` — nothing there. `invalid` — unusable.
 *
 * @stability experimental
 */
export type DeployInfoStatus = 'ok' | 'absent' | 'invalid';

/** @stability experimental */
export interface AboutResponse {
  /** The API process's own version and deployment mode. */
  api: AboutApi;
  /** Whether a deploy document was read, absent, or unusable. */
  deployInfoStatus: DeployInfoStatus;
  /**
   * The exact path the API read.
   *
   * Always present, INCLUDING on `ok`. On `absent` it is the only actionable
   * fact the response carries, and the reason the copy around it can stay
   * truthful — see the page.
   */
  deployInfoPath: string;
  /** Why the document is `invalid`. `null` for `ok` and for `absent`. */
  deployInfoError: string | null;

  /** The application as the deploy recorded it; `null` when no document was read. */
  app: AboutApp | null;
  /** ISO-8601 time of the first install. */
  installedAt: string | null;
  /** ISO-8601 time of the last update. */
  updatedAt: string | null;
  /** The client that wrote the document. */
  deployedBy: AboutDeployedBy | null;
  /** The domain the deployment serves. */
  domain: string | null;
  /** How far behind the remote the deployment was, as last checked. */
  remote: AboutRemote | null;
  /** The deploy run that wrote the document. */
  run: AboutRun | null;

  // Issue #392 — additive fields. OPTIONAL as well as nullable: an API or a
  // deploy record older than #392 simply does not carry them, and the page
  // must render exactly as it did before when they are missing.
  /** Which subcommand wrote the document last. */
  lastCommand?: DeployCommand | null;
  /** The port the deployment binds. */
  bindPort?: number | null;
  /** The reverse proxy in front of the deployment. */
  proxy?: AboutProxy | null;
  /** The host the deploy ran on, captured at deploy time. */
  host?: AboutHost | null;
  /** Successful runs, newest first, at most 20. */
  history?: AboutHistoryEntry[] | null;
  /** Live facts about the API process; never read from disk. */
  runtime?: AboutRuntime | null;

  /** `null` PLUS `databaseError`, never a 503. A fact to display, not a page error. */
  database: AboutDatabase | null;
  /** Why the database probe failed; `null` when it answered. */
  databaseError: string | null;
}
