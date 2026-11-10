import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { describeStorageConfig, fingerprintStorageConfig, type ResolvedStorageConfig } from '../config/storage-config';
import { storageDriverContext } from '../config/storage-driver-context';
import { StorageConfigService } from '../config/storage-config.service';
import { StorageNotConfiguredError } from '../config/storage-not-configured.error';
import { requireStorageDriver } from '../drivers/storage-driver';
import { STORAGE_PROVIDER, type StorageProvider } from './storage-provider.interface';

// =============================================================================
// StorageProviderRouter: the provider of THIS row, not the one in force now
// =============================================================================
//
// `STORAGE_PROVIDER` answers "the configuration in force RIGHT NOW". That is
// right for a write (new bytes go to the active driver) and wrong for every
// read of an object that already exists: an administrator who switches the
// active driver from `r2` to `s3`, or runs a copy-only migration, leaves
// objects behind whose bytes are still where the row says they are. Each row
// records the pair (`storage_objects.storage_provider`, `bucket`); this router
// turns that pair back into a provider.
//
// WHY A ROUTER AND NOT A WIDER `StorageProvider` INTERFACE. The interface's
// methods take only a key, so a replacement could not know which driver a key
// belongs to without a row lookup on every call, and it could not obtain a
// NON-active driver's secrets through any public API. The router is the one
// place that does both (`StorageConfigService.resolveDriver`), and consumers
// that already hold a row ask it once per request.
//
// WHAT IT RETURNS
//
//   * a null/unknown location (a legacy row) or the ACTIVE location: the active
//     driver's built provider, through the same client cache the active
//     provider uses, so no second client is built for the common case;
//   * a recorded driver that cannot be built here (unregistered, or its settings
//     or secret are incomplete): the active provider, with one warning per driver,
//     so rows written before #373 (which recorded `s3` for every provider) keep
//     working;
//   * any other location: a client built for that driver (and, when the row
//     recorded a different bucket than the driver's settings now name, that
//     bucket), cached by configuration fingerprint (a rotated secret or an edited
//     setting yields a new client on the next call);
//   * an app-bound provider (`StorageModule.forRoot({ provider })`): that
//     provider, always. An app that replaced the whole provider owns its own
//     routing; the router does not second-guess it.
//
// The secrets of a non-active driver are decrypted only inside this build and
// handed to the driver's `build`; they are never stored on the router, logged
// or put in an error.
// =============================================================================

/**
 * Where an object's bytes are recorded to live: the `storage_provider` and
 * `bucket` columns of `storage_objects`.
 *
 * @stability experimental
 */
export interface StorageLocation {
  /** The storage driver id the object was written through (`s3`, `r2`, `local`, ...). */
  provider: string;
  /** The bucket, container or root the object was written to. Empty means "the driver's current one". */
  bucket: string;
}

/**
 * How many non-active clients are kept. A rotation window over the handful of
 * providers a deployment has ever used, not a per-tenant cache; the least
 * recently used one is released first.
 */
const ROUTER_CACHE_LIMIT = 8;

interface RoutedClient {
  fingerprint: string;
  provider: Promise<StorageProvider>;
  label: string;
}

/** The slice of `ResolvingStorageProvider` the router needs; duck-typed so two copies of the package agree. */
interface ResolvesCurrent {
  resolveCurrent(): Promise<StorageProvider>;
}

function resolvesCurrent(provider: StorageProvider): provider is StorageProvider & ResolvesCurrent {
  return typeof (provider as Partial<ResolvesCurrent>).resolveCurrent === 'function';
}

/**
 * Resolves the storage provider of an object's recorded location, so downloads, deletes, existence checks, processing reads and the calls of an in-flight multipart upload keep working after the active driver changes.
 *
 * @example
 * ```ts
 * const provider = await this.router.forObject(row);
 * const url = await provider.getSignedDownloadUrl(row.storageKey);
 * ```
 *
 * @extensionPoint token
 * @stability experimental
 */
@Injectable()
export class StorageProviderRouter {
  private readonly logger = new Logger(StorageProviderRouter.name);

  private clients: RoutedClient[] = [];

  constructor(
    @Inject(STORAGE_PROVIDER) private readonly active: StorageProvider,
    @Optional() private readonly storageConfig?: StorageConfigService,
    @Optional() private readonly configService?: ConfigService,
  ) {}

  /**
   * The provider for a recorded location.
   *
   * @param location - the `(storage_provider, bucket)` pair a row recorded, or `null`/empty for a legacy row.
   * @returns the active provider's client for a null or active location, otherwise a client for the recorded driver.
   * @throws StorageNotConfiguredError (503) when no provider is configured at all (the active one included).
   */
  async forLocation(location: StorageLocation | null): Promise<StorageProvider> {
    const active = this.active;

    // An app-bound provider routes itself.
    if (!resolvesCurrent(active) || !this.storageConfig) {
      return active;
    }

    if (!location || !location.provider) {
      return active.resolveCurrent();
    }

    const resolution = await this.storageConfig.resolveDriver(location.provider);

    if (!resolution.configured) {
      // The recorded driver cannot be built (removed, or never configured here):
      // use the one in force, exactly as before routing existed. This is what
      // keeps rows written before #373 working, which recorded `s3` whatever
      // provider took the bytes. If the bytes really are elsewhere the backend's
      // own not-found says so; a 503 here would lock those rows out for nothing.
      this.warnOnce(location.provider, resolution.missing);
      return active.resolveCurrent();
    }

    const config = this.withRecordedBucket(resolution.config, location.bucket);
    const activeId = await this.storageConfig.activeProvider();

    if (location.provider === activeId && config === resolution.config) {
      return active.resolveCurrent();
    }

    return this.clientFor(config);
  }

  /**
   * The provider for a row.
   *
   * @param object - anything carrying the row's `storageProvider` and `bucket`.
   * @returns see {@link StorageProviderRouter.forLocation}.
   */
  async forObject(object: { storageProvider: string | null; bucket: string | null }): Promise<StorageProvider> {
    return this.forLocation(
      object.storageProvider ? { provider: object.storageProvider, bucket: object.bucket ?? '' } : null,
    );
  }

  /**
   * The row's bucket wins over the driver's current one when they differ and the
   * driver's settings carry a `bucket`: the bytes are where the row says, whatever
   * an administrator has typed since. A driver without a `bucket` setting (a local
   * root) is built as configured.
   */
  private withRecordedBucket(config: ResolvedStorageConfig, recorded: string): ResolvedStorageConfig {
    if (!recorded || typeof config.settings.bucket !== 'string' || config.settings.bucket === recorded) {
      return config;
    }

    return { ...config, bucket: recorded, settings: { ...config.settings, bucket: recorded } };
  }

  private readonly warned = new Set<string>();

  private warnOnce(provider: string, missing: readonly string[]): void {
    if (this.warned.has(provider)) return;
    this.warned.add(provider);
    this.logger.warn(
      `Rows recorded on storage driver "${provider}" are served by the active provider: "${provider}" is not usable here (missing ${missing.join(', ') || 'configuration'}).`,
    );
  }

  private clientFor(config: ResolvedStorageConfig): Promise<StorageProvider> {
    const fingerprint = fingerprintStorageConfig(config);
    const index = this.clients.findIndex((entry) => entry.fingerprint === fingerprint);

    if (index >= 0) {
      const [hit] = this.clients.splice(index, 1);
      this.clients.unshift(hit);
      return hit.provider;
    }

    const label = describeStorageConfig(config);
    this.logger.log(`Building routed storage client: ${label}`);

    const driver = requireStorageDriver(config.provider);
    const provider = Promise.resolve(
      driver.build(
        storageDriverContext({
          settings: config.settings,
          secret: async (name) => config.secrets[name] ?? null,
          logger: this.logger,
          config: this.configService ?? { get: <T>(_key: string, fallback?: T) => fallback as T },
        }),
      ),
    );

    const entry: RoutedClient = { fingerprint, provider, label };
    this.clients.unshift(entry);

    // A failed build must not be cached: the next call tries again.
    provider.catch(() => {
      this.clients = this.clients.filter((candidate) => candidate !== entry);
    });

    while (this.clients.length > ROUTER_CACHE_LIMIT) {
      const evicted = this.clients.pop();
      if (!evicted) break;

      this.logger.log(`Releasing routed storage client: ${evicted.label}`);
      void evicted.provider
        .then((built) => (built as { destroy?: () => void }).destroy?.())
        .catch((error: unknown) =>
          this.logger.warn(
            `Failed to release a routed storage client: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
    }

    return provider;
  }
}
