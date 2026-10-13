// =============================================================================
// The AI capability registry: registerAiCapability (PP-14.17, issue #935)
// =============================================================================
//
// A capability is what ONE MODEL can do: the catalog stores a list of them per
// model (`AiModelCapabilities.capabilities`), the admin pages draw them as
// chips, and the gate pipeline refuses a request whose shape needs a capability
// the chosen model does not declare. The vocabulary used to be a closed tuple
// (a diarization, moderation, rerank or OCR model needed a package edit); it is
// now a registry an app or package adds to AT IMPORT TIME:
//
//   registerAiCapability({ id: 'speaker_diarization', label: 'Diarization', description: '...' });
//
// The platform's own fourteen register through this same function below (no
// private fast path), so the API serves them and an app's together
// (`GET /api/admin/ai/capabilities`) and a web page needs no hard-coded list.
//
// TWO LEVELS, as in `capabilities.ts`: this is the MODEL level. Whether a
// PROVIDER can serve a capability is derived from what its adapter carries: a
// built-in capability from a port, an app capability from a registered
// operation it implements (`provider-registry.ts`).
//
// Framework-free like the registry primitive it sits on: nothing here imports
// Nest or a database, so the openapi dump and the seed can read it.
// =============================================================================

import { AI_CAPABILITY_ID_PATTERN } from '@marinoscar/platform-contract/ai';

import { defineRegistry, type Registry } from '../../core/index';
import { BUILTIN_AI_CAPABILITIES, type AiCapability } from './capabilities';

/**
 * One capability an app or package adds to the AI vocabulary.
 *
 * @stability experimental
 */
export interface AiCapabilityDefinition {
  /**
   * Stable id, `^[a-z][a-z0-9_]{1,47}$` (`speaker_diarization`). PERMANENT once a
   * catalog row, an override or a feature names it.
   */
  readonly id: string;
  /** The short label the admin pages show (`Diarization`). Unique among the registered ones is good form, not enforced. */
  readonly label: string;
  /** One sentence on what a model that declares it can do. */
  readonly description: string;
}

/** The labels and descriptions of the built-in capabilities. Mirrors the web's chips. */
const BUILTIN_DEFINITIONS: Record<(typeof BUILTIN_AI_CAPABILITIES)[number], Omit<AiCapabilityDefinition, 'id'>> = {
  responses: { label: 'Text', description: 'Answers text prompts.' },
  reasoning: { label: 'Reasoning', description: 'Thinks before answering, at a chosen effort.' },
  tools: { label: 'Tools', description: 'Calls the functions a request offers.' },
  hosted_tools: { label: 'Hosted tools', description: "Runs the provider's own tools (web search, code interpreter)." },
  structured_output: { label: 'Structured output', description: 'Answers in a JSON shape the request names.' },
  streaming: { label: 'Streaming', description: 'Streams an answer token by token.' },
  vision_input: { label: 'Vision', description: 'Reads images in a prompt.' },
  file_input: { label: 'Files', description: 'Reads files in a prompt.' },
  image_generation: { label: 'Image generation', description: 'Generates images from a prompt.' },
  image_edit: { label: 'Image editing', description: 'Edits images it is given.' },
  audio_transcription: { label: 'Transcription', description: 'Turns a recording into text.' },
  audio_speech: { label: 'Speech', description: 'Turns text into spoken audio.' },
  embeddings: { label: 'Embeddings', description: 'Turns text into vectors.' },
  realtime: { label: 'Realtime', description: 'Holds a live voice conversation.' },
};

const builtinIds: ReadonlySet<string> = new Set(BUILTIN_AI_CAPABILITIES);

/**
 * Every registered AI capability, built-ins first, then registration order.
 * Read it; register with {@link registerAiCapability}.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const aiCapabilityRegistry: Registry<AiCapabilityDefinition> = defineRegistry<AiCapabilityDefinition>({
  name: 'ai-capabilities',
  idOf: (def) => def.id,
  idPattern: AI_CAPABILITY_ID_PATTERN,
  validate: (def) => {
    if (typeof def.label !== 'string' || def.label.trim() === '' || def.label.length > 48) {
      throw new Error('label must be 1 to 48 characters');
    }
    if (typeof def.description !== 'string' || def.description.trim() === '' || def.description.length > 240) {
      throw new Error('description must be 1 to 240 characters');
    }
  },
});

/**
 * Adds a capability to the AI vocabulary. Call it at import time from the
 * app's manifest, before the application bootstraps (the registry freezes
 * then) and BEFORE the `registerAiOperation` and `registerAiFeature` calls
 * that name it. A capability needs no code of its own: a model declares it
 * (the adapter's `classifyModel`, or an administrator's override), and a
 * registered operation (`registerAiOperation`) is how a provider serves it.
 *
 * @param def - the capability: id, label and description.
 * @throws RegistryError `DUPLICATE_ID`, `INVALID_ID`, `INVALID_ENTRY` or `FROZEN`.
 *
 * @example
 * ```ts
 * registerAiCapability({
 *   id: 'speaker_diarization',
 *   label: 'Diarization',
 *   description: 'Labels who spoke when in a recording.',
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerAiCapability(def: AiCapabilityDefinition): void {
  aiCapabilityRegistry.register(def);
}

/**
 * The registered capability, or `undefined`.
 *
 * @param id - the capability id.
 *
 * @stability experimental
 */
export function getAiCapability(id: string): AiCapabilityDefinition | undefined {
  return aiCapabilityRegistry.get(id);
}

/**
 * Every registered capability, built-ins first, then registration order.
 *
 * @stability experimental
 */
export function listAiCapabilities(): AiCapabilityDefinition[] {
  return aiCapabilityRegistry.list();
}

/**
 * Whether `value` is a registered capability (a built-in one or an app's).
 *
 * @param value - an arbitrary string read from the database or a request.
 * @returns whether `registerAiCapability` (or the platform) declared it.
 *
 * @stability experimental
 */
export function isAiCapability(value: string): value is AiCapability {
  return aiCapabilityRegistry.has(value);
}

/**
 * Whether `value` is one of the capabilities the platform ships
 * ({@link BUILTIN_AI_CAPABILITIES}).
 *
 * @param value - a capability id.
 *
 * @stability experimental
 */
export function isBuiltinAiCapability(value: string): boolean {
  return builtinIds.has(value);
}

// The platform's own capabilities, through the same function an app uses.
for (const id of BUILTIN_AI_CAPABILITIES) {
  registerAiCapability({ id, ...BUILTIN_DEFINITIONS[id] });
}
