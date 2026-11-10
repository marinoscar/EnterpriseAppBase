// =============================================================================
// The AI operation registry: registerAiOperation (PP-14.17, issue #935)
// =============================================================================
//
// An OPERATION is one kind of provider call the runtime meters: it is the
// `operation` column of a usage row (`responses`, `images`, `audio.transcribe`,
// ...), the label a usage report shows, and the model capability the call needs.
// The set used to be a closed union (`AiUsageOperation`); a diarization,
// moderation, rerank or OCR call needed a package edit. Now an app or package
// declares one AT IMPORT TIME:
//
//   registerAiOperation({
//     id: 'audio.diarize', label: 'Diarization', capability: 'speaker_diarization',
//     inputSchema: z.object({ ... }), outputSchema: z.object({ ... }),
//   });
//
// and a provider implements it with an entry in `AiProviderAdapter.operations`.
// `AiService.forUser(userId).run('audio.diarize', input)` then runs it through
// the SAME gate pipeline as a built-in port: kill switch, provider and model
// gates (the model must declare the operation's capability), key policy, rate
// limits, one usage row and one span per call. The operation's schemas are the
// trust boundary: the input is parsed before any key is read, the output before
// it is returned.
//
// The platform's own operations register below, through this same function.
// They declare no schemas: they are called through their typed methods
// (`respond`, `embed`, `transcribe`, ...), not through `run`.
//
// Framework-free, like the registry primitive and `capability-registry.ts`.
// =============================================================================

import { AI_OPERATION_ID_PATTERN } from '@marinoscar/platform-contract/ai';
import type { z } from 'zod';

import { defineRegistry, type Registry } from '../../core/index';
import { aiCapabilityRegistry } from './capability-registry';

/**
 * What an app or package tells the AI slice about an operation it adds.
 *
 * @typeParam I - the operation's input.
 * @typeParam O - the operation's output.
 *
 * @stability experimental
 */
export interface AiOperationDefinition<I = unknown, O = unknown> {
  /**
   * Stable id, `AI_OPERATION_ID_PATTERN` (`audio.diarize`). PERMANENT once a
   * usage row exists: it is the row's `operation`. It is also the key of
   * `AiProviderAdapter.operations`.
   */
  readonly id: string;
  /** The label usage reports and the admin pages show (`Diarization`). */
  readonly label: string;
  /**
   * The model capability a call needs (a registered one: register it with
   * `registerAiCapability` first). The chosen model must declare it and the
   * provider must implement this operation.
   */
  readonly capability: string;
  /** One sentence on what the operation does. */
  readonly description?: string;
  /**
   * Validates (and may transform) the input of `run(id, input)` before any
   * gate reads a key. Required for an operation an app adds. Bound the input
   * here (`.max(...)`): the runtime does not.
   */
  readonly inputSchema?: z.ZodType<I>;
  /**
   * Validates the adapter's output before `run` returns it; an output that
   * does not match is `AI_STRUCTURED_OUTPUT_INVALID`, and the call is still
   * billed and recorded. Required for an operation an app adds. Bound it
   * (`.max(...)`) and keep secrets out of it: the runtime refuses an output
   * that contains the call's key.
   */
  readonly outputSchema?: z.ZodType<O>;
  /**
   * The non-token units of one successful call, recorded on its usage row and
   * summed by the usage report (`{ audioSeconds: 31.4 }`). Finite,
   * non-negative numbers only; anything else is dropped. Absent: no units.
   */
  readonly usageUnits?: (output: O, input: I) => Record<string, number> | undefined;
}

const builtinIds = new Set<string>();

/**
 * Every registered AI operation, built-ins first, then registration order.
 * Read it; register with {@link registerAiOperation}.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const aiOperationRegistry: Registry<AiOperationDefinition> = defineRegistry<AiOperationDefinition>({
  name: 'ai-operations',
  idOf: (def) => def.id,
  idPattern: AI_OPERATION_ID_PATTERN,
  validate: (def) => {
    if (typeof def.label !== 'string' || def.label.trim() === '' || def.label.length > 48) {
      throw new Error('label must be 1 to 48 characters');
    }
    if (typeof def.capability !== 'string' || !aiCapabilityRegistry.has(def.capability)) {
      throw new Error(
        `capability "${String(def.capability)}" is not registered; register it with registerAiCapability before the operation`,
      );
    }
    if (!builtinIds.has(def.id)) {
      if (typeof def.inputSchema?.safeParse !== 'function' || typeof def.outputSchema?.safeParse !== 'function') {
        throw new Error('inputSchema and outputSchema (zod schemas) are required: they are the trust boundary of run()');
      }
    }
    if (def.usageUnits !== undefined && typeof def.usageUnits !== 'function') {
      throw new Error('usageUnits must be a function');
    }
  },
});

/**
 * Declares an AI operation. Call it at import time from the app's manifest,
 * before the application bootstraps (the registry freezes then), after the
 * `registerAiCapability` call for its capability. The provider that serves it
 * lists the id under `AiProviderAdapter.operations`.
 *
 * @param def - the operation: id, label, capability and the two schemas.
 * @throws RegistryError `DUPLICATE_ID`, `INVALID_ID`, `INVALID_ENTRY` or `FROZEN`.
 *
 * @example
 * ```ts
 * registerAiOperation({
 *   id: 'audio.diarize',
 *   label: 'Diarization',
 *   capability: 'speaker_diarization',
 *   inputSchema: z.object({ storageObjectId: z.uuid() }),
 *   outputSchema: z.object({ speakers: z.array(z.string()).max(32) }),
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerAiOperation<I, O>(def: AiOperationDefinition<I, O>): void {
  aiOperationRegistry.register(def as AiOperationDefinition);
}

/**
 * The registered operation, or `undefined`.
 *
 * @param id - the operation id.
 *
 * @stability experimental
 */
export function getAiOperation(id: string): AiOperationDefinition | undefined {
  return aiOperationRegistry.get(id);
}

/**
 * Every registered operation, built-ins first, then registration order.
 *
 * @stability experimental
 */
export function listAiOperations(): AiOperationDefinition[] {
  return aiOperationRegistry.list();
}

/**
 * Whether `id` is an operation the platform ships (one of the typed methods of
 * `AiUserClient`, not a custom operation).
 *
 * @param id - an operation id.
 *
 * @stability experimental
 */
export function isBuiltinAiOperation(id: string): boolean {
  return builtinIds.has(id);
}

/** The platform's own operations: the `operation` values usage rows carry. */
const BUILTIN_OPERATIONS: ReadonlyArray<Pick<AiOperationDefinition, 'id' | 'label' | 'capability'>> = [
  { id: 'responses', label: 'Responses', capability: 'responses' },
  { id: 'images', label: 'Images', capability: 'image_generation' },
  { id: 'audio.transcribe', label: 'Transcription', capability: 'audio_transcription' },
  { id: 'audio.speech', label: 'Speech', capability: 'audio_speech' },
  { id: 'embeddings', label: 'Embeddings', capability: 'embeddings' },
  { id: 'realtime', label: 'Realtime', capability: 'realtime' },
  // Written by the catalogue sync, not by a caller: the model listing call.
  { id: 'catalog', label: 'Catalog sync', capability: 'responses' },
];

for (const def of BUILTIN_OPERATIONS) {
  builtinIds.add(def.id);
  registerAiOperation(def);
}
