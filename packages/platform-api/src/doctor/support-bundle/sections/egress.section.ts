// The `egress` support-bundle section (issues #772 and #773): the deployment's
// outbound-dependency inventory, as `network.egress` reads it. Built in;
// registered by `DoctorModule.forRoot()` next to `meta` and `doctor`.
//
// Hosts and scopes only. Every contributor already reduces its endpoints to
// HOSTNAMES (`egressDependency()`: no scheme, userinfo, port, path or query),
// and the strict schema below has no field that could carry a URL. A
// contributor that throws becomes one `unknown` entry, as in the check.

import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { z } from 'zod';

import { EgressRegistry } from '../../egress/egress.registry';
import { DEPLOYMENT_NETWORKS, DEPLOYMENT_NETWORK_SOURCE } from '../../egress/egress.types';
import type { DeploymentNetworkSource } from '../../egress/egress.types';
import { describeEgress } from '../../egress/network-egress.doctor-check';
import type { SupportBundleSection } from '../support-bundle-section.interface';
import { SupportBundleRegistry } from '../support-bundle.registry';

const egressSectionSchema = z
  .object({
    network: z.enum(DEPLOYMENT_NETWORKS).describe('The declared network (`DEPLOYMENT_NETWORK`); `online` when the app binds none.'),
    dependencies: z.array(
      z
        .object({
          id: z.string(),
          capability: z.string(),
          direction: z.enum(['server', 'browser', 'both']),
          enabled: z.boolean(),
          hosts: z.array(z.string()),
          scope: z.enum(['public', 'private', 'unknown']),
          required: z.boolean(),
          degradation: z.string(),
          settingsPath: z.string().nullable(),
          count: z.number().int().nullable(),
        })
        .strict(),
    ),
  })
  .strict();

type EgressSectionData = z.infer<typeof egressSectionSchema>;

/** The built-in `egress` section: hosts and scopes of every outbound dependency. */
@Injectable()
export class EgressSupportBundleSection implements SupportBundleSection<EgressSectionData>, OnModuleInit {
  readonly id = 'egress';
  readonly label = 'Outbound dependencies';
  readonly schema = egressSectionSchema;
  private readonly logger = new Logger('EgressSupportBundleSection');

  constructor(
    @Inject(SupportBundleRegistry) private readonly registry: SupportBundleRegistry,
    @Inject(EgressRegistry) private readonly egress: EgressRegistry,
    @Optional() @Inject(DEPLOYMENT_NETWORK_SOURCE) private readonly source?: DeploymentNetworkSource,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async collect(): Promise<EgressSectionData> {
    const dependencies = await describeEgress(this.egress, (id) => {
      this.logger.warn(`Egress contributor "${id}" failed while building the support bundle.`);
    });
    return {
      network: this.source?.network ?? 'online',
      dependencies: dependencies.map((dependency) => ({
        id: dependency.id,
        capability: dependency.capability,
        direction: dependency.direction,
        enabled: dependency.enabled,
        hosts: [...dependency.hosts],
        scope: dependency.scope,
        required: dependency.required,
        degradation: dependency.degradation,
        settingsPath: dependency.settingsPath ?? null,
        count: dependency.count ?? null,
      })),
    };
  }
}
