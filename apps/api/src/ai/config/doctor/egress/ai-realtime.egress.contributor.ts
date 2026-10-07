import { Injectable, OnModuleInit } from '@nestjs/common';

import {
  EgressContributor,
  EgressDependency,
  EgressRegistry,
  egressDependency,
} from '@marinoscar/platform-api/doctor';

import { AiProviderRegistry } from '../../../core/provider-registry';
import { AiConfigService, providerPolicy } from '../../ai-config.service';
import { AI_SETTINGS_PATH } from '../ai-enabled.doctor-check';
import { aiProviderEndpoint, aiProviderName } from './ai-provider-endpoint';

/**
 * `ai.realtime.<id>` (#773): realtime voice. `POST /api/ai/realtime/sessions`
 * mints an ephemeral secret server-side, and then the BROWSER connects to the
 * provider directly, so this dependency's direction is `browser`.
 *
 * Which providers have one is DERIVED from the adapter registry
 * (`supports(id, 'realtime')`, i.e. a `realtime` port), never hard-coded.
 */
@Injectable()
export class AiRealtimeEgressContributor implements EgressContributor, OnModuleInit {
  readonly id = 'ai.realtime';

  constructor(
    private readonly egress: EgressRegistry,
    private readonly aiConfig: AiConfigService,
    private readonly providers: AiProviderRegistry,
  ) {}

  onModuleInit(): void {
    this.egress.register(this);
  }

  async describe(): Promise<EgressDependency[]> {
    const realtime = this.providers.ids().filter((id) => this.providers.supports(id, 'realtime'));
    if (realtime.length === 0) return [];

    const policy = await this.aiConfig.resolve({ fresh: true });

    return realtime.map((providerId) => {
      const name = aiProviderName(this.providers, providerId);

      return egressDependency({
        id: `ai.realtime.${providerId}`,
        capability: `AI realtime voice: ${name}`,
        direction: 'browser',
        enabled: policy.enabled && providerPolicy(policy, providerId)?.enabled === true,
        required: false,
        hosts: [aiProviderEndpoint(policy, this.providers, providerId)],
        degradation: `Realtime voice sessions with ${name} cannot connect from the browser`,
        settingsPath: AI_SETTINGS_PATH,
      });
    });
  }
}
