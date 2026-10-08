import { Injectable, OnModuleInit } from '@nestjs/common';

import {
  EgressContributor,
  EgressDependency,
  EgressRegistry,
  egressDependency,
} from '../../../../doctor/index';

import { SystemSettingsService } from '../../../../settings/index';
import { aiProviderEndpoint, aiProviderName } from '../../../config/doctor/egress/ai-provider-endpoint';
import { AiProviderRegistry } from '../../../core/provider-registry';
import { AiCatalogRefreshTask } from '../../ai-catalog-refresh.task';

/**
 * `ai.catalog-refresh.<id>` (#773): the daily `ai.catalog.refresh` job lists
 * each enabled provider's models. Offline it fails every day, unattended.
 *
 * Exactly the providers the 04:00 cron would enqueue for: it asks the task's
 * own read-only `dueProviders()` (AI on, provider enabled), so the two cannot
 * disagree. Nothing is enqueued here.
 */
@Injectable()
export class AiCatalogRefreshEgressContributor implements EgressContributor, OnModuleInit {
  readonly id = 'ai.catalog-refresh';

  constructor(
    private readonly egress: EgressRegistry,
    private readonly task: AiCatalogRefreshTask,
    private readonly settings: SystemSettingsService,
    private readonly providers: AiProviderRegistry,
  ) {}

  onModuleInit(): void {
    this.egress.register(this);
  }

  async describe(): Promise<EgressDependency[]> {
    const due = await this.task.dueProviders();
    if (due.length === 0) return [];

    const policy = await this.settings.getAiPolicy();

    return due.map((providerId) => {
      const name = aiProviderName(this.providers, providerId);

      return egressDependency({
        id: `ai.catalog-refresh.${providerId}`,
        capability: `AI model catalog refresh: ${name}`,
        direction: 'server',
        enabled: true,
        required: false,
        hosts: [aiProviderEndpoint(policy, this.providers, providerId)],
        degradation: `Daily ai.catalog.refresh jobs for ${name} fail`,
        settingsPath: '/admin/settings/ai',
      });
    });
  }
}
