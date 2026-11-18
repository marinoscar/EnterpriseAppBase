// The vocabulary `GET /api/admin/ai/capabilities` serves (PP-14.17, #935).

import { aiCapabilitiesResponseSchema } from '@marinoscar/platform-contract/ai';
import { z } from 'zod';

import { withTemporaryEntries } from '../../../core/index';
import { aiCapabilityRegistry } from '../../core/capability-registry';
import { aiOperationRegistry } from '../../core/operation-registry';
import { describeAiVocabulary } from './ai-capabilities.dto';

describe('describeAiVocabulary', () => {
  it('lists the built-ins first, flagged builtin, and validates against the contract schema', () => {
    const vocabulary = describeAiVocabulary();

    expect(aiCapabilitiesResponseSchema.safeParse(vocabulary).success).toBe(true);
    expect(vocabulary.capabilities.slice(0, 3).map((c) => [c.id, c.builtin])).toEqual([
      ['responses', true],
      ['reasoning', true],
      ['tools', true],
    ]);
    expect(vocabulary.operations.find((o) => o.id === 'audio.transcribe')).toEqual({
      id: 'audio.transcribe',
      label: 'Transcription',
      capability: 'audio_transcription',
      builtin: true,
      runnable: false,
    });
  });

  it('includes an app capability and operation, flagged as not builtin, the operation runnable', async () => {
    await withTemporaryEntries(aiCapabilityRegistry, [{ id: 'ocr_text', label: 'OCR', description: 'Reads text from images.' }], async () => {
      await withTemporaryEntries(
        aiOperationRegistry,
        [{ id: 'image.ocr', label: 'OCR', capability: 'ocr_text', inputSchema: z.object({}), outputSchema: z.object({}) }],
        () => {
          const vocabulary = describeAiVocabulary();

          expect(vocabulary.capabilities.at(-1)).toEqual({ id: 'ocr_text', label: 'OCR', description: 'Reads text from images.', builtin: false });
          expect(vocabulary.operations.at(-1)).toEqual({ id: 'image.ocr', label: 'OCR', capability: 'ocr_text', builtin: false, runnable: true });
        },
      );
    });
  });
});
