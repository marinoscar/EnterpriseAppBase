/**
 * `AiPlaygroundModeSelector` and the mode registry — issue #445.
 *
 * Modes are derived from capabilities alone; the selector is a labelled,
 * keyboard-operable segmented control whose unavailable modes stay focusable
 * and explain themselves.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../utils/test-utils';
import { AiPlaygroundModeSelector } from '../../../components/ai/playground/AiPlaygroundModeSelector';
import {
  AI_PLAYGROUND_MODES,
  aiPlaygroundMode,
  initialPlaygroundMode,
  modelsForMode,
  unavailableModes,
  type AiPlaygroundModeId,
} from '../../../components/ai/playground/aiPlaygroundModes';
import type { UsableAiModel } from '../../../services/ai';

function model(modelId: string, capabilities: string[]): UsableAiModel {
  return {
    provider: 'acme',
    modelId,
    displayName: null,
    capabilities: { capabilities, inputModalities: ['text'], outputModalities: ['text'] },
    keySource: 'user',
  };
}

describe('aiPlaygroundModes', () => {
  // Deliberately odd model ids: nothing may depend on a model's name.
  const models = [model('zz-1', ['responses', 'streaming']), model('qq-2', ['embeddings']), model('pp-3', ['image_generation'])];

  it('maps each mode to exactly one capability', () => {
    expect(AI_PLAYGROUND_MODES.map((mode) => [mode.id, mode.capability])).toEqual([
      ['chat', 'responses'],
      ['image', 'image_generation'],
      ['transcribe', 'audio_transcription'],
      ['speech', 'audio_speech'],
      ['embeddings', 'embeddings'],
    ]);
  });

  it('filters models by the mode capability', () => {
    expect(modelsForMode(models, aiPlaygroundMode('embeddings')).map((m) => m.modelId)).toEqual(['qq-2']);
    expect(modelsForMode(models, aiPlaygroundMode('image')).map((m) => m.modelId)).toEqual(['pp-3']);
    expect(modelsForMode(models, aiPlaygroundMode('speech'))).toEqual([]);
  });

  it('reports modes no model can serve', () => {
    expect([...unavailableModes(models)].sort()).toEqual(['speech', 'transcribe']);
    expect(unavailableModes([]).size).toBe(AI_PLAYGROUND_MODES.length);
  });

  it('opens on Chat when usable, else on the first usable mode', () => {
    expect(initialPlaygroundMode(models)).toBe('chat');
    expect(initialPlaygroundMode([model('a', ['embeddings'])])).toBe('embeddings');
    expect(initialPlaygroundMode([])).toBe('chat');
  });
});

describe('AiPlaygroundModeSelector', () => {
  function renderSelector(value: AiPlaygroundModeId = 'chat', unavailable: AiPlaygroundModeId[] = ['speech']) {
    const onChange = vi.fn();
    render(<AiPlaygroundModeSelector value={value} onChange={onChange} unavailable={new Set(unavailable)} />);
    return { onChange, user: userEvent.setup() };
  }

  it('marks the selected mode pressed', () => {
    renderSelector('image');
    expect(screen.getByRole('button', { name: 'Image' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Chat' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('selects a mode on click, and ignores the selected and unavailable ones', async () => {
    const { onChange, user } = renderSelector();
    await user.click(screen.getByRole('button', { name: 'Embeddings' }));
    expect(onChange).toHaveBeenCalledWith('embeddings');

    onChange.mockClear();
    await user.click(screen.getByRole('button', { name: 'Chat' }));
    await user.click(screen.getByRole('button', { name: 'Speech' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps an unavailable mode focusable, describing why via its tooltip', async () => {
    const { user } = renderSelector();
    const speech = screen.getByRole('button', { name: 'Speech' });
    expect(speech).toHaveAttribute('aria-disabled', 'true');
    expect(speech).not.toBeDisabled();

    screen.getByRole('button', { name: 'Transcribe' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(speech).toHaveFocus();
    // The reason is the description, never the name.
    expect(await screen.findByRole('tooltip')).toHaveTextContent('None of the models available to you can generate speech');
    expect(speech).toHaveAccessibleName('Speech');
  });

  it('moves focus with Home/End and wraps with the arrow keys', async () => {
    const { user, onChange } = renderSelector();
    screen.getByRole('button', { name: 'Chat' }).focus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('button', { name: 'Embeddings' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('button', { name: 'Chat' })).toHaveFocus();
    await user.keyboard('{ArrowRight}{ArrowRight}{Enter}');
    expect(onChange).toHaveBeenCalledWith('transcribe');
  });
});
