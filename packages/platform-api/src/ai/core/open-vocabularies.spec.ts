// =============================================================================
// The open AI vocabularies (PP-14.17, issue #935): registerAiCapability,
// registerAiOperation and what the provider registry derives from them.
// =============================================================================

import { z } from 'zod';

import { RegistryError, withTemporaryEntries } from '../../core/index';
import { registerAiFeature } from '../features/ai-feature.registry';
import { BUILTIN_AI_CAPABILITIES, aiModelCapabilitiesSchema } from './capabilities';
import {
  aiCapabilityRegistry,
  getAiCapability,
  isAiCapability,
  isBuiltinAiCapability,
  listAiCapabilities,
  registerAiCapability,
} from './capability-registry';
import {
  aiOperationRegistry,
  getAiOperation,
  isBuiltinAiOperation,
  listAiOperations,
  registerAiOperation,
} from './operation-registry';
import type { AiProviderAdapter } from './provider-adapter.interface';
import { adapterCapabilities, AiProviderRegistry } from './provider-registry';

function adapter(id: string, extra: Partial<AiProviderAdapter> = {}): AiProviderAdapter {
  return {
    id,
    displayName: id,
    listModels: async () => [],
    verifyKey: async () => ({ ok: true }),
    classifyModel: () => null,
    ...extra,
  };
}

const schemas = { inputSchema: z.object({}), outputSchema: z.object({}) };

describe('the capability registry', () => {
  it('registers the fourteen built-in capabilities through the same function an app uses, in order', () => {
    const builtin = listAiCapabilities().slice(0, BUILTIN_AI_CAPABILITIES.length);

    expect(builtin.map((c) => c.id)).toEqual([...BUILTIN_AI_CAPABILITIES]);
    expect(builtin.every((c) => c.label.length > 0 && c.description.length > 0)).toBe(true);
    expect(getAiCapability('audio_transcription')?.label).toBe('Transcription');
    expect(isBuiltinAiCapability('realtime')).toBe(true);
  });

  it('adds an app capability with a label and a description, after the built-ins', async () => {
    await withTemporaryEntries(aiCapabilityRegistry, [{ id: 'moderation', label: 'Moderation', description: 'Flags unsafe content.' }], () => {
      expect(isAiCapability('moderation')).toBe(true);
      expect(isBuiltinAiCapability('moderation')).toBe(false);
      expect(listAiCapabilities().at(-1)?.id).toBe('moderation');
    });

    expect(isAiCapability('moderation')).toBe(false);
  });

  it.each<[string, Parameters<typeof registerAiCapability>[0]]>([
    ['an id that is not lower snake case', { id: 'Moderation', label: 'x', description: 'x' }],
    ['an id that is too short', { id: 'a', label: 'x', description: 'x' }],
    ['an empty label', { id: 'moderation_x', label: ' ', description: 'x' }],
    ['a missing description', { id: 'moderation_y', label: 'x', description: '' }],
    ['a duplicate of a built-in', { id: 'responses', label: 'x', description: 'x' }],
  ])('refuses %s', async (_name, def) => {
    await withTemporaryEntries(aiCapabilityRegistry, [], () => {
      expect(() => registerAiCapability(def)).toThrow(RegistryError);
    });
  });

  it('a model record accepts any well-formed capability id, so a removed plugin never bricks a stored row', () => {
    const parsed = aiModelCapabilitiesSchema.safeParse({
      capabilities: ['responses', 'speaker_diarization', 'ocr_text'],
      inputModalities: ['audio'],
      outputModalities: ['text'],
    });

    expect(parsed.success).toBe(true);
    expect(aiModelCapabilitiesSchema.safeParse({ capabilities: ['Not Valid'], inputModalities: [], outputModalities: [] }).success).toBe(false);
  });

  it('a feature may need an app capability once it is registered, and not before', async () => {
    await withTemporaryEntries(aiCapabilityRegistry, [], async () => {
      expect(() => registerAiFeature({ id: 'open_vocab_early', label: 'x', needs: ['rerank_scores'] })).toThrow(/rerank_scores/);
      registerAiCapability({ id: 'rerank_scores', label: 'Rerank', description: 'Orders passages by relevance.' });
      expect(() => registerAiFeature({ id: 'open_vocab_ok', label: 'x', needs: ['rerank_scores'] })).not.toThrow();
    });
  });
});

describe('the operation registry', () => {
  it('registers the usage operations through the same function an app uses', () => {
    expect(listAiOperations().slice(0, 7).map((o) => o.id)).toEqual([
      'responses',
      'images',
      'audio.transcribe',
      'audio.speech',
      'embeddings',
      'realtime',
      'catalog',
    ]);
    expect(isBuiltinAiOperation('audio.speech')).toBe(true);
    expect(getAiOperation('audio.transcribe')?.capability).toBe('audio_transcription');
  });

  it('an app operation needs a registered capability and both schemas', async () => {
    await withTemporaryEntries(aiCapabilityRegistry, [{ id: 'rerank_scores', label: 'Rerank', description: 'x' }], async () => {
      await withTemporaryEntries(aiOperationRegistry, [], () => {
        expect(() => registerAiOperation({ id: 'rerank.score', label: 'Rerank', capability: 'not_registered', ...schemas })).toThrow(
          /registerAiCapability/,
        );
        expect(() => registerAiOperation({ id: 'rerank.score', label: 'Rerank', capability: 'rerank_scores' } as never)).toThrow(/inputSchema/);
        expect(() => registerAiOperation({ id: 'Rerank', label: 'Rerank', capability: 'rerank_scores', ...schemas })).toThrow(RegistryError);
        expect(() => registerAiOperation({ id: 'rerank.score', label: 'Rerank', capability: 'rerank_scores', ...schemas })).not.toThrow();
        expect(() => registerAiOperation({ id: 'rerank.score', label: 'Again', capability: 'rerank_scores', ...schemas })).toThrow(RegistryError);
        expect(getAiOperation('rerank.score')?.label).toBe('Rerank');
        expect(isBuiltinAiOperation('rerank.score')).toBe(false);
      });
    });
  });

  it('an app cannot register a schema-less operation by claiming a built-in id', async () => {
    await withTemporaryEntries(aiOperationRegistry, [], () => {
      expect(() => registerAiOperation({ id: 'responses', label: 'x', capability: 'responses' } as never)).toThrow(RegistryError);
    });
  });
});

describe('what the provider registry derives from operations', () => {
  const diarize = async () => ({});

  it('an adapter that implements an operation of an app capability supports that capability, and only that', async () => {
    await withTemporaryEntries(aiCapabilityRegistry, [{ id: 'spk_diarization', label: 'Diarization', description: 'x' }], async () => {
      await withTemporaryEntries(
        aiOperationRegistry,
        [{ id: 'audio.spk_diarize', label: 'Diarization', capability: 'spk_diarization', ...schemas }],
        () => {
          const registry = new AiProviderRegistry();
          const withOp = adapter('with-op', { operations: { 'audio.spk_diarize': diarize } });
          const without = adapter('without-op');

          registry.register(withOp);
          registry.register(without);

          expect(registry.supports('with-op', 'spk_diarization')).toBe(true);
          expect(registry.supports('with-op', 'audio_transcription')).toBe(false);
          expect(registry.supportsOperation('with-op', 'audio.spk_diarize')).toBe(true);
          expect(registry.supports('without-op', 'spk_diarization')).toBe(false);
          expect(registry.supportsOperation('without-op', 'audio.spk_diarize')).toBe(false);
          expect(adapterCapabilities(withOp)).toEqual(['spk_diarization']);
        },
      );
    });
  });

  it('an operation nobody registered, or a non-function entry, declares nothing', async () => {
    const registry = new AiProviderRegistry();

    registry.register(adapter('odd', { operations: { 'audio.unregistered': diarize, 'audio.not_fn': 'x' as never } }));

    expect(adapterCapabilities(registry.require('odd'))).toEqual([]);
    expect(registry.supportsOperation('odd', 'audio.not_fn')).toBe(false);
    expect(registry.supportsOperation('odd', 'constructor')).toBe(false);
    expect(registry.supports('odd', 'constructor')).toBe(false);
  });
});
