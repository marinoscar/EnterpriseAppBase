/**
 * One materialised file: where it lives in this package and where it lands in
 * the app.
 *
 * @stability experimental
 */
export interface InfraFile {
  /** Path inside `@marinoscar/platform-infra`, using `/`, for example `telemetry/compose/telemetry.compose.yml`. */
  readonly from: string;
  /** Path relative to the app's repository root, using `/`, for example `infra/compose/telemetry.compose.yml`. */
  readonly to: string;
}

/**
 * Where a fragment's compose file sits in the deploy's load-bearing order
 * (`base, prod, [after-prod], vps, [after-vps]`).
 *
 * - `after-prod`: adds services, so it comes before the VPS files and inherits
 *   their hardening.
 * - `after-vps`: hardens those services; it must come last, because a
 *   `ports: !override` only replaces what the files before it published.
 *
 * @stability experimental
 */
export type ComposeSlot = 'after-prod' | 'after-vps';

/**
 * A compose file of a fragment and its slot in the deploy order.
 *
 * @stability experimental
 */
export interface InfraComposeFile {
  /** File name inside the app's `infra/compose/` directory. */
  readonly file: string;
  /** Where the file sits in the load-bearing order. */
  readonly slot: ComposeSlot;
}

/**
 * The typed manifest of an infra fragment: which files `platform-infra sync`
 * materialises into the app, where its compose files sit in the deploy order,
 * and which collector config the app owns.
 *
 * The app's deploy runs `docker compose` from the cloned repository, where no
 * `node_modules` exists, so fragments are copied into the app (and committed)
 * rather than resolved from the package at deploy time.
 *
 * @stability experimental
 */
export interface InfraFragment {
  /** Stable id of the fragment; also its key in `infra/platform-infra.lock.json`. */
  readonly id: 'telemetry';
  /** The env group whose presence adds these compose files (the app CLI's `EnvGroup`). */
  readonly envGroup: 'observability';
  /** Compose files and where each sits in the load-bearing order. */
  readonly composeFiles: readonly InfraComposeFile[];
  /** Platform-owned files copied into the app on every sync (package path to app path). They are generated: never edit them in the app. */
  readonly files: readonly InfraFile[];
  /** App-owned files created from a package template only when absent, and never overwritten afterwards. */
  readonly appOwnedFiles: readonly InfraFile[];
  /** Collector configs (app paths) in `--config` order: the platform base first, then the app-owned overlay. */
  readonly collectorConfigs: {
    /** App path of the generated platform config, the first `--config`. */
    readonly platform: string;
    /** App path of the app-owned overlay, the second `--config`; sync never overwrites it. */
    readonly app: string;
  };
  /** Images an app overlay may use instead of building from source. */
  readonly images: {
    /**
     * The stack-agent sidecar image, without a tag. Published by the platform
     * release (#692) and tagged with the platform version; until that image
     * exists, the reference app builds `apps/stack-agent` from source.
     */
    readonly stackAgent: string;
  };
}

/**
 * The telemetry fragment: the OpenTelemetry collector and GreptimeDB compose
 * services, their VPS hardening, the platform collector config and the
 * app-owned collector overlay (`infra/otel/app-collector.yaml`).
 *
 * The collector starts with two `--config` files, platform first:
 * `collectorConfigs.platform`, then `collectorConfigs.app`. Maps merge; lists
 * are replaced, so an overlay that changes an existing pipeline restates its
 * whole `receivers` list. The safer pattern is a new named pipeline such as
 * `metrics/app`.
 *
 * @stability experimental
 * @extensionPoint overlay
 * @example
 * ```ts
 * import { telemetryInfraFragment } from '@marinoscar/platform-infra/telemetry';
 *
 * const late = telemetryInfraFragment.composeFiles.filter((f) => f.slot === 'after-vps');
 * ```
 */
export const telemetryInfraFragment: InfraFragment = deepFreeze({
  id: 'telemetry',
  envGroup: 'observability',
  composeFiles: [
    { file: 'telemetry.compose.yml', slot: 'after-prod' },
    { file: 'vps.telemetry.compose.yml', slot: 'after-vps' },
  ],
  files: [
    { from: 'telemetry/compose/telemetry.compose.yml', to: 'infra/compose/telemetry.compose.yml' },
    { from: 'telemetry/compose/vps.telemetry.compose.yml', to: 'infra/compose/vps.telemetry.compose.yml' },
    { from: 'telemetry/otel/otel-collector-config.yaml', to: 'infra/otel/otel-collector-config.yaml' },
  ],
  appOwnedFiles: [{ from: 'telemetry/otel/app-collector.example.yaml', to: 'infra/otel/app-collector.yaml' }],
  collectorConfigs: {
    platform: 'infra/otel/otel-collector-config.yaml',
    app: 'infra/otel/app-collector.yaml',
  },
  images: {
    stackAgent: 'ghcr.io/marinoscar/enterpriseappbase-stack-agent',
  },
});

/** Freezes a manifest and everything inside it, so a consumer cannot reorder the deploy by mutating it. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
