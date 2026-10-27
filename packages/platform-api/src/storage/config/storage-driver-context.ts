// =============================================================================
// Building the context every storage driver operation receives (PP-14.7, #925)
// =============================================================================
//
// One place that turns "this driver, these settings, this secret resolver" into
// the `StorageDriverContext` a driver's `build`, `testConnection`, `provision`,
// `listKeys` and `purge` are called with, so the provider that serves requests,
// the admin test and the provisioning route cannot disagree about it.
// =============================================================================

import type { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { StorageDriverContext, StorageDriverSettings } from '../drivers/storage-driver';
import { DEFAULT_STORAGE_PART_SIZE_BYTES } from '../storage.options';

/**
 * The multipart part size the deployment is configured for (`storage.partSize`).
 *
 * @param config - the application configuration.
 * @stability experimental
 */
export function storagePartSize(config: Pick<ConfigService, 'get'>): number {
  return config.get<number>('storage.partSize', DEFAULT_STORAGE_PART_SIZE_BYTES);
}

/**
 * This deployment's own origin (`APP_URL`, normalised to scheme, host and port),
 * for a driver that sets a CORS rule. Normalised because that is what the CORS
 * specification compares: `https://app.example.com/` with a trailing slash
 * matches nothing, silently. A value that is not a URL is returned unchanged,
 * so the bad value is in front of the administrator in the response rather
 * than hidden behind an exception.
 *
 * @param config - the application configuration.
 * @stability experimental
 */
export function storageAppOrigin(config: Pick<ConfigService, 'get'>): string {
  const appUrl = config.get<string>('appUrl') ?? '';

  try {
    return new URL(appUrl).origin;
  } catch {
    return appUrl;
  }
}

/**
 * The context of a driver operation.
 *
 * @param input - the driver's settings, its secret resolver, a logger and the configuration.
 * @returns the context.
 * @stability experimental
 */
export function storageDriverContext(input: {
  settings: StorageDriverSettings;
  secret(name: string): Promise<string | null>;
  logger: Logger;
  config: Pick<ConfigService, 'get'>;
}): StorageDriverContext {
  return {
    settings: input.settings,
    secret: input.secret,
    logger: input.logger,
    partSize: storagePartSize(input.config),
    appOrigin: storageAppOrigin(input.config),
  };
}
