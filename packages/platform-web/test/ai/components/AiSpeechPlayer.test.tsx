/**
 * `AiSpeechPlayer` — issue #445 (API #439). The disclosure is always shown,
 * the player is labelled, and a failed signed-URL read is explained.
 */
import { describe, it, expect } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ApiError, downloadResponses, render } from '../harness.js';
import {
  AiSpeechPlayer,
  AI_GENERATED_AUDIO_LABEL,
  AI_SPEECH_PLAYBACK_FAILED_MESSAGE,
} from '../../../src/ai/ui/shared/AiSpeechPlayer.js';
import { SPEECH_OBJECT_ID, mockAiSpeechRunOutput, mockSignedUrl } from '../fixtures.js';
import { isAiResponseRunOutput, isAiSpeechRunOutput, isAiTranscriptionRunOutput } from '../../../src/ai/headless/types.js';
import { mockAiResponse, mockAiTranscriptionRunOutput } from '../fixtures.js';

describe('AiSpeechPlayer', () => {
  it('discloses AI-generated audio before the player loads, then plays from the signed URL', async () => {
    const { container } = render(<AiSpeechPlayer output={mockAiSpeechRunOutput} />, {
      responses: downloadResponses([SPEECH_OBJECT_ID]),
    });
    expect(screen.getByText(AI_GENERATED_AUDIO_LABEL)).toBeInTheDocument();
    expect(screen.getByText('Voice coral · MP3 · 11 characters')).toBeInTheDocument();

    await waitFor(() => expect(container.querySelector('audio')).not.toBeNull());
    const audio = container.querySelector('audio')!;
    expect(audio).toHaveAttribute('src', mockSignedUrl(SPEECH_OBJECT_ID));
    expect(audio).toHaveAccessibleName('AI-generated audio, voice coral');
    expect(screen.getByRole('link', { name: 'Download audio' })).toHaveAttribute('download', 'ai-speech.mp3');
  });

  it('explains a download URL that cannot be had, and keeps the disclosure', async () => {
    const { container } = render(<AiSpeechPlayer output={mockAiSpeechRunOutput} />, {
      responses: {
        [`GET /storage/objects/${SPEECH_OBJECT_ID}/download`]: () => {
          throw new ApiError('Object not found', 404, 'NOT_FOUND');
        },
      },
    });
    expect(await screen.findByText('Object not found')).toBeInTheDocument();
    expect(container.querySelector('audio')).toBeNull();
    expect(screen.getByText(AI_GENERATED_AUDIO_LABEL)).toBeInTheDocument();
  });

  it('explains a playback failure (issue #510) and keeps the download link working', async () => {
    const { container } = render(<AiSpeechPlayer output={mockAiSpeechRunOutput} />, {
      responses: downloadResponses([SPEECH_OBJECT_ID]),
    });
    await waitFor(() => expect(container.querySelector('audio')).not.toBeNull());
    const audio = container.querySelector('audio')!;

    fireEvent.error(audio);

    expect(await screen.findByText(AI_SPEECH_PLAYBACK_FAILED_MESSAGE)).toBeInTheDocument();
    expect(container.querySelector('audio')).toBeNull();
    expect(screen.getByText(AI_GENERATED_AUDIO_LABEL)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download audio' })).toHaveAttribute(
      'href',
      mockSignedUrl(SPEECH_OBJECT_ID),
    );
  });
});

describe('run output guards', () => {
  it('tell the four output shapes apart', () => {
    expect(isAiSpeechRunOutput(mockAiSpeechRunOutput)).toBe(true);
    expect(isAiTranscriptionRunOutput(mockAiTranscriptionRunOutput)).toBe(true);
    expect(isAiResponseRunOutput(mockAiResponse)).toBe(true);
    expect(isAiResponseRunOutput(mockAiSpeechRunOutput)).toBe(false);
    expect(isAiSpeechRunOutput(mockAiTranscriptionRunOutput)).toBe(false);
    expect(isAiSpeechRunOutput(null)).toBe(false);
  });
});
