import type { AiProviderRegistry } from '../../../core/provider-registry';
import { providerCallSettings, providerPolicy, type AiPolicy, type AiProviderPolicy } from '../../ai-config.service';

/**
 * The AI provider ids the policy has a settings slot for, in settings order
 * (every provider registered with `registerAiProvider`). An adapter registered
 * for an id with no provider definition can never be enabled, so it has no egress.
 */
export function aiPolicyProviderIds(policy: AiPolicy): string[] {
  return Object.keys(policy.providers as Record<string, AiProviderPolicy | undefined>);
}

/**
 * The endpoint provider `providerId` calls (#773): the slot's `baseUrl` when an
 * administrator set one (`providerCallSettings`, the same reduction a call
 * makes), else the adapter's own `defaultBaseUrl`. `undefined` when neither
 * exists (an Azure or OpenAI-compatible slot with no endpoint yet).
 *
 * Pure, and never a secret: the slot has no field able to hold one.
 */
export function aiProviderEndpoint(
  policy: AiPolicy,
  registry: Pick<AiProviderRegistry, 'get'>,
  providerId: string,
): string | undefined {
  return providerCallSettings(providerPolicy(policy, providerId)).baseUrl ?? registry.get(providerId)?.defaultBaseUrl;
}

/** The provider's display name: its adapter's, or its id when none is registered. */
export function aiProviderName(registry: Pick<AiProviderRegistry, 'get'>, providerId: string): string {
  return registry.get(providerId)?.displayName ?? providerId;
}
