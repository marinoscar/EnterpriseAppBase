// =============================================================================
// The example's custom AI operation: `audio.diarize` (PP-14.17, issue #935)
// =============================================================================
//
// The platform has no built-in port for "who spoke when". An app adds the kind
// of call WITHOUT editing a package, in three steps (docs/EXTENDING.md):
//
//   1. a capability a model can declare:   registerAiCapability(...)
//   2. an operation that needs it:         registerAiOperation(...), with the zod
//                                          schemas that are its trust boundary
//   3. a provider that implements it:      `AiProviderAdapter.operations`
//                                          (`ExampleTranscribeAdapter`)
//
// then `AiService.forUser(userId, { feature }).run('audio.diarize', input)` runs
// it through the same gate pipeline as `transcribe` or `respond`: the kill
// switch, the model and key gates, the rate limits, one usage row (operation
// `audio.diarize`, the feature, `units: { audioSeconds }`) and one span.
//
// Registered from `app-registrations/ai.ts` at import time. A fork that does not
// want the example deletes its registrations there.
//
// The input is small and in-process (a base64 recording of at most 256 KiB): a
// real operation that handles large media takes a storage object id and reads it
// itself. The schemas BOUND both sides: the runtime does not.
// =============================================================================

import type { AiCapabilityDefinition, AiOperationDefinition } from '@marinoscar/platform-api/ai';
import { z } from 'zod';

/** The model capability: a model that can label who spoke when. Permanent once a catalog row declares it. */
export const EXAMPLE_DIARIZE_CAPABILITY = 'speaker_diarization';

/** The operation id: the `operation` of its usage rows. Permanent once one exists. */
export const EXAMPLE_DIARIZE_OPERATION = 'audio.diarize';

/** The largest recording `audio.diarize` takes, as base64 characters (256 KiB of audio). */
export const EXAMPLE_DIARIZE_MAX_BASE64_CHARS = Math.ceil((256 * 1024 * 4) / 3);

/** The most speakers an answer may name. */
export const EXAMPLE_DIARIZE_MAX_SPEAKERS = 16;

/** What the operation takes. */
export const exampleDiarizeInputSchema = z.object({
  /** The recording, base64 encoded. */
  audioBase64: z.string().min(4).max(EXAMPLE_DIARIZE_MAX_BASE64_CHARS),
  /** The recording's MIME type. */
  mimeType: z.string().regex(/^audio\/[a-z0-9.+-]+$/).default('audio/wav'),
  /** How many speakers to expect (a hint). */
  expectedSpeakers: z.number().int().min(1).max(EXAMPLE_DIARIZE_MAX_SPEAKERS).optional(),
});

/** What the operation answers. */
export const exampleDiarizeOutputSchema = z.object({
  /** The speakers found, in order of first appearance (`A`, `B`). */
  speakers: z.array(z.string().max(32)).max(EXAMPLE_DIARIZE_MAX_SPEAKERS),
  /** Who spoke when. */
  segments: z
    .array(z.object({ start: z.number().finite(), end: z.number().finite(), speaker: z.string().max(32) }))
    .max(2_000),
  /** The recording's length, in seconds: what the usage row meters. */
  durationSeconds: z.number().finite().min(0),
});

/** The input, parsed. */
export type ExampleDiarizeInput = z.output<typeof exampleDiarizeInputSchema>;
/** The output. */
export type ExampleDiarizeOutput = z.output<typeof exampleDiarizeOutputSchema>;

/** Step 1: the capability. */
export const exampleDiarizeCapability: AiCapabilityDefinition = {
  id: EXAMPLE_DIARIZE_CAPABILITY,
  label: 'Diarization',
  description: 'Labels who spoke when in a recording.',
};

/** Step 2: the operation. Its usage row meters the recording's seconds. */
export const exampleDiarizeOperation: AiOperationDefinition<ExampleDiarizeInput, ExampleDiarizeOutput> = {
  id: EXAMPLE_DIARIZE_OPERATION,
  label: 'Diarization',
  description: 'Who spoke when in a recording.',
  capability: EXAMPLE_DIARIZE_CAPABILITY,
  inputSchema: exampleDiarizeInputSchema,
  outputSchema: exampleDiarizeOutputSchema,
  usageUnits: (output) => ({ audioSeconds: output.durationSeconds }),
};
