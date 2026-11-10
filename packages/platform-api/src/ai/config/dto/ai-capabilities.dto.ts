import { aiCapabilitiesResponseSchema } from '@marinoscar/platform-contract/ai';
import { createZodDto } from 'nestjs-zod';

import { isBuiltinAiCapability, listAiCapabilities } from '../../core/capability-registry';
import { isBuiltinAiOperation, listAiOperations } from '../../core/operation-registry';

// =============================================================================
// GET /api/admin/ai/capabilities — the open vocabularies (PP-14.17, #935)
// =============================================================================
//
// Every capability and operation this process knows: the platform's own and
// the ones an app registered (`registerAiCapability`, `registerAiOperation`).
// The admin pages draw capability labels and the override dialog's checkboxes
// from it, so an app capability needs no web change. Static data (the
// registries freeze at bootstrap): no database, no secret.
// =============================================================================

export class AiCapabilitiesResponseDto extends createZodDto(aiCapabilitiesResponseSchema) {}

/**
 * The capabilities and operations as `GET /api/admin/ai/capabilities` lists
 * them: built-ins first, then registration order.
 */
export function describeAiVocabulary(): AiCapabilitiesResponseDto {
  return {
    capabilities: listAiCapabilities().map((definition) => ({
      id: definition.id,
      label: definition.label,
      description: definition.description,
      builtin: isBuiltinAiCapability(definition.id),
    })),
    operations: listAiOperations().map((definition) => ({
      id: definition.id,
      label: definition.label,
      capability: definition.capability,
      builtin: isBuiltinAiOperation(definition.id),
      runnable: !isBuiltinAiOperation(definition.id) && definition.inputSchema !== undefined && definition.outputSchema !== undefined,
    })),
  };
}
