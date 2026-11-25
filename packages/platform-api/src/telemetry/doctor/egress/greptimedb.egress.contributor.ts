import { Injectable, OnModuleInit } from '@nestjs/common';

import {
  EgressContributor,
  EgressDependency,
  EgressRegistry,
  egressDependency,
} from '../../../doctor/index';

import { TelemetryConnectionService } from '../../connection/telemetry-connection.service';
import { TELEMETRY_SETTINGS_PATH } from '../telemetry-export.doctor-check';

/**
 * `telemetry.greptimedb` (#773): the GreptimeDB the telemetry explorer, the
 * dashboards and retention read. Enabled when a reader connection is
 * configured.
 *
 * Reads the in-memory snapshot (`describeSnapshot()`: host only is used, and
 * passwords there are known only as "set"). NOT `fingerprint()`, which is an
 * opaque identity of the credentials, and never `resolveCredentials()`.
 */
@Injectable()
export class GreptimeDbEgressContributor implements EgressContributor, OnModuleInit {
  readonly id = 'telemetry';

  constructor(
    private readonly egress: EgressRegistry,
    private readonly connection: TelemetryConnectionService,
  ) {}

  onModuleInit(): void {
    this.egress.register(this);
  }

  async describe(): Promise<EgressDependency[]> {
    const { host } = this.connection.describeSnapshot();

    return [
      egressDependency({
        id: 'telemetry.greptimedb',
        capability: 'Telemetry store (GreptimeDB)',
        direction: 'server',
        enabled: this.connection.isConfigured(),
        required: false,
        hosts: [host],
        degradation: 'The telemetry explorer, dashboards and retention cannot reach the store',
        settingsPath: TELEMETRY_SETTINGS_PATH,
      }),
    ];
  }
}
