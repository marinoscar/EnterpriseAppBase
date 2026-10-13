/**
 * The AI Playground's mode registry — PP-14.17 (#935).
 *
 * `registerAiPlaygroundMode` adds a mode with no change to the playground: it
 * appears in the switch after the built-ins, its models are filtered by its
 * capability, and its `Panel` is drawn. The six built-ins register through the
 * same function. Registered at module scope, as an app does.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { render } from '../harness.js';
import '../../../src/ai/ui/playground/builtinAiPlaygroundModes.js';
import {
  getAiPlaygroundMode,
  hiddenPlaygroundModes,
  initialPlaygroundMode,
  listAiPlaygroundModes,
  modelsForMode,
  registerAiPlaygroundMode,
  resetAiPlaygroundModesForTests,
  unavailableModes,
  type AiPlaygroundPanelProps,
} from '../../../src/ai/ui/playground/aiPlaygroundModes.js';
import { AiPlaygroundModeSelector } from '../../../src/ai/ui/playground/AiPlaygroundModeSelector.js';
import type { UsableAiModel } from '../../../src/ai/headless/types.js';

function model(modelId: string, capabilities: string[]): UsableAiModel {
  return {
    provider: 'acme',
    modelId,
    displayName: null,
    capabilities: { capabilities, inputModalities: ['text'], outputModalities: ['text'] },
    keySource: 'user',
  };
}

function DiarizePanel({ models }: AiPlaygroundPanelProps) {
  return <p data-testid="diarize-panel">{models.map((entry) => entry.modelId).join(',')}</p>;
}

const BUILTIN_IDS = ['chat', 'image', 'transcribe', 'speech', 'embeddings', 'voice'];

describe('the playground mode registry', () => {
  afterEach(() => resetAiPlaygroundModesForTests());

  it('registers the six built-in modes through the same registry, with the operation each exercises', () => {
    expect(listAiPlaygroundModes().map((mode) => [mode.id, mode.operation])).toEqual([
      ['chat', 'responses'],
      ['image', 'images'],
      ['transcribe', 'audio.transcribe'],
      ['speech', 'audio.speech'],
      ['embeddings', 'embeddings'],
      ['voice', 'realtime'],
    ]);
    expect(listAiPlaygroundModes().every((mode) => typeof mode.Panel === 'function')).toBe(true);
  });

  it('lists an app mode after the built-ins, with defaults applied', () => {
    registerAiPlaygroundMode({ id: 'diarize', label: 'Diarize', operation: 'audio.diarize', capability: 'speaker_diarization', Panel: DiarizePanel });

    const modes = listAiPlaygroundModes();

    expect(modes.map((mode) => mode.id)).toEqual([...BUILTIN_IDS, 'diarize']);
    expect(getAiPlaygroundMode('diarize')).toMatchObject({
      label: 'Diarize',
      operation: 'audio.diarize',
      capability: 'speaker_diarization',
      unavailableReason: 'None of the models available to you can do diarize',
    });
  });

  it('the capability defaults to the operation id', () => {
    registerAiPlaygroundMode({ id: 'rerank', label: 'Rerank', operation: 'rerank', Panel: DiarizePanel });

    expect(getAiPlaygroundMode('rerank')?.capability).toBe('rerank');
  });

  it('an app mode is offered only when a usable model declares its capability, and lists those models', () => {
    registerAiPlaygroundMode({ id: 'diarize', label: 'Diarize', operation: 'audio.diarize', capability: 'speaker_diarization', Panel: DiarizePanel });
    const models = [model('zz', ['responses']), model('qq', ['audio_transcription', 'speaker_diarization'])];
    const mode = getAiPlaygroundMode('diarize')!;

    expect(modelsForMode(models, mode).map((entry) => entry.modelId)).toEqual(['qq']);
    expect(unavailableModes(models).has('diarize')).toBe(false);
    expect(unavailableModes([model('zz', ['responses'])]).has('diarize')).toBe(true);
    expect(initialPlaygroundMode([model('qq', ['speaker_diarization'])])).toBe('diarize');
    expect(initialPlaygroundMode([model('qq', ['speaker_diarization'])], hiddenPlaygroundModes({}))).toBe('diarize');
  });

  it('a registration with a built-in id replaces that mode where it stands (an app swaps a panel)', () => {
    registerAiPlaygroundMode({ id: 'speech', label: 'Speak', operation: 'audio.speech', capability: 'audio_speech', Panel: DiarizePanel });

    expect(listAiPlaygroundModes().map((mode) => mode.id)).toEqual(BUILTIN_IDS);
    expect(getAiPlaygroundMode('speech')?.label).toBe('Speak');
    expect(getAiPlaygroundMode('speech')?.Panel).toBe(DiarizePanel);
  });

  it('a later registration with an app id replaces the earlier one (hot reload)', () => {
    registerAiPlaygroundMode({ id: 'diarize', label: 'Diarize', operation: 'audio.diarize', Panel: DiarizePanel });
    registerAiPlaygroundMode({ id: 'diarize', label: 'Who spoke', operation: 'audio.diarize', Panel: DiarizePanel });

    expect(listAiPlaygroundModes().filter((mode) => mode.id === 'diarize').map((mode) => mode.label)).toEqual(['Who spoke']);
  });

  it.each([
    ['an id that is not lower-case kebab', { id: 'Diarize Now', label: 'x', operation: 'audio.diarize' }],
    ['no label', { id: 'diarize', label: ' ', operation: 'audio.diarize' }],
    ['an operation that is not an operation id', { id: 'diarize', label: 'x', operation: 'Audio Diarize' }],
    ['no panel', { id: 'diarize', label: 'x', operation: 'audio.diarize' }],
  ])('refuses %s', (_name, def) => {
    expect(() => registerAiPlaygroundMode(def as never)).toThrow();
    expect(listAiPlaygroundModes().map((mode) => mode.id)).toEqual(BUILTIN_IDS);
  });

  it('the mode switch offers the app mode, and a viewer can select it', async () => {
    registerAiPlaygroundMode({ id: 'diarize', label: 'Diarize', operation: 'audio.diarize', capability: 'speaker_diarization', Panel: DiarizePanel });
    const picked: string[] = [];
    const user = userEvent.setup();

    render(<AiPlaygroundModeSelector value="chat" onChange={(next) => picked.push(next)} unavailable={new Set()} />);

    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Chat',
      'Image',
      'Transcribe',
      'Speech',
      'Embeddings',
      'Voice',
      'Diarize',
    ]);

    await user.click(screen.getByRole('button', { name: 'Diarize' }));
    expect(picked).toEqual(['diarize']);
  });

  it('an unavailable app mode stays focusable and explains itself', () => {
    registerAiPlaygroundMode({
      id: 'diarize',
      label: 'Diarize',
      operation: 'audio.diarize',
      capability: 'speaker_diarization',
      unavailableReason: 'No model can tell speakers apart',
      Panel: DiarizePanel,
    });

    render(<AiPlaygroundModeSelector value="chat" onChange={() => undefined} unavailable={new Set(['diarize'])} />);

    expect(screen.getByRole('button', { name: 'Diarize' })).toHaveAttribute('aria-disabled', 'true');
  });
});
