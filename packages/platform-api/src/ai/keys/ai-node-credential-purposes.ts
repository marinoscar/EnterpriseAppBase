// =============================================================================
// The AI slice's node credential purposes: `ai:<providerId>` (issue #1083)
// =============================================================================
//
// One purpose per AI provider the app configured (`AiModule.forRoot`),
// registered with `registerNodeCredentialPurpose` so a deployment that turns
// node credential delivery ON and allowlists, say, `ai:openai` can run an
// `ai.*` job that declares it on a worker node.
//
// ⚠ ORGANIZATION OR DEPLOYMENT TIER ONLY, through `AiKeyResolver.resolveForSystem`
// — the same rule as a system call: never a user's own (BYOK) key, and
// `ai.deploymentKeyServesOrgs` still applies. A keyless provider
// (`requiresKey: false`) is delivered as `{ keyless: 'true' }`: there is no key
// to deliver, and the keyless marker itself never leaves the server.
//
// Nothing is delivered by registering: delivery is OFF by default, and the
// `ai-jobs-server-only` suite still requires a node-eligible `ai.*` type to
// declare its purposes and every feature it serves to set
// `nodeCredentialDelivery: true`. Gated pending the platform rule amendment
// proposed in `docs/specs/worker-nodes.md`.
// =============================================================================

import { nodeCredentialPurposeRegistry, registerNodeCredentialPurpose, type NodeCredentialResolveContext, type ResolvedNodeCredential } from '../../jobs/index';
import { AI_KEYLESS_API_KEY } from '../core/provider-adapter.interface';
import { AiKeyResolver } from './ai-key-resolver.service';

/**
 * The node credential purpose id of an AI provider: `ai:<providerId>`.
 *
 * @param providerId - the provider id (`openai`).
 * @returns the purpose id (`ai:openai`).
 *
 * @stability experimental
 */
export function aiNodeCredentialPurposeId(providerId: string): string {
  return `ai:${providerId}`;
}

/**
 * Resolves one provider's credential for a node: org then deployment tier,
 * never the user tier. Exported for the conformance suites.
 *
 * @param providerId - the provider id.
 * @param ctx - the resolve context (organization, container access).
 * @returns the material, or `null` when neither tier has a key.
 *
 * @stability experimental
 */
export async function resolveAiNodeCredential(providerId: string, ctx: NodeCredentialResolveContext): Promise<ResolvedNodeCredential | null> {
  const resolver = ctx.get<AiKeyResolver>(AiKeyResolver);
  let resolved;
  try {
    resolved = await resolver.resolveForSystem(providerId, ctx.orgId ? { orgId: ctx.orgId } : {});
  } catch {
    // AI_KEY_REQUIRED: neither the organization nor the deployment has a key.
    return null;
  }
  if (resolved.keySource === 'none' || resolved.apiKey === AI_KEYLESS_API_KEY) return { material: { keyless: 'true' } };
  return { material: { apiKey: resolved.apiKey } };
}

/**
 * Registers `ai:<providerId>` for each provider, skipping one already
 * registered (so `AiModule.forRoot` can run more than once in a test
 * process). Called by `AiModule.forRoot`.
 *
 * @param providerIds - the configured provider ids.
 *
 * @stability experimental
 */
export function registerAiNodeCredentialPurposes(providerIds: readonly string[]): void {
  for (const providerId of providerIds) {
    const id = aiNodeCredentialPurposeId(providerId);
    if (nodeCredentialPurposeRegistry.get(id) !== undefined || nodeCredentialPurposeRegistry.frozen) continue;
    registerNodeCredentialPurpose({
      id,
      label: `AI provider key: ${providerId} (organization or deployment key)`,
      resolve: (ctx) => resolveAiNodeCredential(providerId, ctx),
    });
  }
}
