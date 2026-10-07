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
import { aiPolicyProviderIds, aiProviderEndpoint, aiProviderName } from './ai-provider-endpoint';

/**
 * `ai.provider.<id>` (#773): the endpoint each AI provider's server-side calls
 * reach. One entry per provider slot in the `ai` policy; enabled when AI is on,
 * the slot is enabled and an adapter is registered (the three things a call
 * needs). The host is the slot's `baseUrl` or the adapter's default.
 *
 * Reads the policy (no key: `AiPolicy` has no field able to hold one) and the
 * in-memory adapter registry. No model call, no key resolution.
 */
@Injectable()
export class AiProvidersEgressContributor implements EgressContributor, OnModuleInit {
  readonly id = 'ai.providers';

  constructor(
    private readonly egress: EgressRegistry,
    private readonly aiConfig: AiConfigService,
    private readonly providers: AiProviderRegistry,
  ) {}

  onModuleInit(): void {
    this.egress.register(this);
  }

  async describe(): Promise<EgressDependency[]> {
    const policy = await this.aiConfig.resolve({ fresh: true });

    return aiPolicyProviderIds(policy).map((providerId) => {
      const name = aiProviderName(this.providers, providerId);

      return egressDependency({
        id: `ai.provider.${providerId}`,
        capability: `AI provider: ${name}`,
        direction: 'server',
        enabled:
          policy.enabled &&
          providerPolicy(policy, providerId)?.enabled === true &&
          this.providers.get(providerId) !== undefined,
        required: false,
        hosts: [aiProviderEndpoint(policy, this.providers, providerId)],
        degradation: `AI features served by ${name} fail`,
        settingsPath: AI_SETTINGS_PATH,
      });
    });
  }
}
