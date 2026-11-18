import { Injectable } from '@nestjs/common';
import type { AiFeatureView } from '@marinoscar/platform-contract/ai';

import { UsableModelsService } from '../keys/usable-models.service';
import { listAiFeatures, type AiFeatureDefinition } from './ai-feature.registry';

/** What a usable model offers, as the fit check reads it. */
interface ModelOffer {
  provider: string;
  capabilities: { capabilities: readonly string[]; inputModalities: readonly string[] };
}

/** Whether `model` fits `feature`: provider allow-list, every need, every input modality. */
export function modelFitsFeature(feature: AiFeatureDefinition, model: ModelOffer): boolean {
  if (feature.providers && !feature.providers.includes(model.provider)) return false;
  if (!feature.needs.every((need) => model.capabilities.capabilities.includes(need))) return false;
  return (feature.inputModalities ?? []).every((modality) => model.capabilities.inputModalities.includes(modality));
}

/**
 * The registered AI features, each with whether the caller has a usable model
 * for it (an enabled model on an enabled provider that the caller's own key,
 * the organization's or the deployment's reaches, and that fits the feature).
 *
 * @stability experimental
 *
 * @internal
 */
@Injectable()
export class AiFeaturesService {
  constructor(private readonly usableModels: UsableModelsService) {}

  /**
   * Every registered feature, in registration order, for `userId`.
   *
   * @param userId - the caller.
   * @param orgId - the organization the caller acts in (its switches and key apply).
   */
  async listForUser(userId: string, orgId?: string): Promise<AiFeatureView[]> {
    const features = listAiFeatures();
    if (features.length === 0) return [];

    const usable = await this.usableModels.listForUser(userId, orgId ? { orgId } : {});

    return features.map((feature) => ({
      id: feature.id,
      label: feature.label,
      group: feature.group ?? null,
      needs: [...feature.needs],
      inputModalities: [...(feature.inputModalities ?? [])],
      providers: feature.providers ? [...feature.providers] : null,
      requiresHostedTools: [...(feature.requiresHostedTools ?? [])],
      defaultEffort: feature.defaultEffort ?? null,
      usable: usable.some((model) => modelFitsFeature(feature, model)),
    }));
  }
}
