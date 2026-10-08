import { Injectable, OnModuleInit } from '@nestjs/common';

import {
  EgressContributor,
  EgressDependency,
  EgressRegistry,
  egressDependency,
} from '../../../../doctor/index';

import { StorageConfigAdminService } from '../../storage-config-admin.service';
import { STORAGE_SETTINGS_PATH } from '../../storage-not-configured.error';

const PROVIDER_LABEL: Readonly<Record<string, string>> = {
  s3: 'Amazon S3',
  r2: 'Cloudflare R2',
  s3compatible: 'S3-compatible',
};

/**
 * `storage.s3` (#773): the object store. Direction `both`: the API reads and
 * writes it, and presigned URLs send the BROWSER to the same host for uploads
 * and downloads.
 *
 * Reads `StorageConfigAdminService.describeForAdmin()`, the admin view, whose
 * `effectiveEndpoint` is the host an S3 client is pointed at (R2's derived
 * endpoint included) and whose secret is known only as "set". NOT
 * `StorageConfigService.resolveActiveConfig()`, which decrypts the secret
 * access key. With no endpoint the client uses AWS's regional host,
 * `s3.<region>.amazonaws.com`.
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
    const host = view.effectiveEndpoint || (view.region ? `s3.${view.region}.amazonaws.com` : 's3.amazonaws.com');

    return [
      egressDependency({
        id: 'storage.s3',
        capability: `Object storage (${PROVIDER_LABEL[view.provider] ?? view.provider})`,
        direction: 'both',
        enabled: view.configured,
        required: false,
        hosts: [host],
        degradation: 'File uploads, downloads, profile pictures and database backups fail',
        settingsPath: STORAGE_SETTINGS_PATH,
      }),
    ];
  }
}
