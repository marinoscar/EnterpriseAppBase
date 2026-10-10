import { Injectable, OnModuleInit } from '@nestjs/common';

import {
  EgressContributor,
  EgressDependency,
  EgressRegistry,
  egressDependency,
} from '../../../../doctor/index';

import { BUILTIN_STORAGE_PROVIDER_KINDS } from '@marinoscar/platform-contract/storage';

import { getStorageDriver } from '../../../drivers/storage-driver';
import { StorageConfigAdminService } from '../../storage-config-admin.service';
import { STORAGE_SETTINGS_PATH } from '../../storage-not-configured.error';

/**
 * `storage.s3` (#773): the object store. Direction `both`: the API reads and
 * writes it, and presigned URLs send the BROWSER to the same host for uploads
 * and downloads.
 *
 * Reads `StorageConfigAdminService.describeForAdmin()`, the admin view, whose
 * secrets are known only as "set", and asks the ACTIVE DRIVER which hosts it
 * calls (`egressHosts`): the S3 family answers with the endpoint a client is
 * pointed at (R2's derived endpoint included, or AWS's regional host
 * `s3.<region>.amazonaws.com`), a driver an app registers with its own. NOT
 * `StorageConfigService.resolveActiveConfig()`, which decrypts the secrets. A
 * driver with no hosts (a local filesystem) contributes no row.
 *
 * @stability experimental
 */
@Injectable()
export class StorageEgressContributor implements EgressContributor, OnModuleInit {
  readonly id = 'storage';

  constructor(
    private readonly egress: EgressRegistry,
    private readonly storageAdmin: StorageConfigAdminService,
  ) {}

  /** Self-registration with the Doctor's registry. */
  onModuleInit(): void {
    this.egress.register(this);
  }

  async describe(): Promise<EgressDependency[]> {
    const view = await this.storageAdmin.describeForAdmin();
    const driver = getStorageDriver(view.provider);
    const hosts = driver?.egressHosts?.(view.drivers[view.provider] ?? {}) ?? [];

    // A driver that calls nowhere (the filesystem) has nothing to list; one that
    // is no longer registered has no hosts to name either.
    if (hosts.length === 0) return [];

    return [
      egressDependency({
        // The id the S3 family has always had; another driver gets its own.
        id: (BUILTIN_STORAGE_PROVIDER_KINDS as readonly string[]).includes(view.provider) ? 'storage.s3' : `storage.${view.provider}`,
        // The driver's label without its parenthetical hint ("S3-compatible (MinIO, ...)" is "S3-compatible" here).
        capability: `Object storage (${(driver?.label ?? view.provider).replace(/\s*\(.*\)\s*$/, '')})`,
        direction: 'both',
        enabled: view.configured,
        required: false,
        hosts: [...hosts],
        degradation: 'File uploads, downloads, profile pictures and database backups fail',
        settingsPath: STORAGE_SETTINGS_PATH,
      }),
    ];
  }
}
