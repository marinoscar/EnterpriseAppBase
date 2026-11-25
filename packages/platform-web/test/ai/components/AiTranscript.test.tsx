/**
 * `AiTranscript` and the recording check — issue #445 (API #438).
 */
import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { render } from '../harness.js';
import { AiTranscript, formatTimestamp } from '../../../src/ai/ui/shared/AiTranscript.js';
import { audioFileProblem } from '../../../src/ai/ui/playground/AiTranscribeMode.js';
import { mockAiTranscriptionRunOutput } from '../fixtures.js';

describe('formatTimestamp', () => {
  it('formats m:ss and h:mm:ss', () => {
    expect(formatTimestamp(0)).toBe('0:00');
    expect(formatTimestamp(64.9)).toBe('1:04');
    expect(formatTimestamp(3725)).toBe('1:02:05');
    expect(formatTimestamp(-3)).toBe('0:00');
  });
});

describe('audioFileProblem', () => {
  const file = (type: string) => new File(['x'], 'f', { type });
  it('accepts audio/* and MP4/WebM video only', () => {
    for (const type of ['audio/mpeg', 'audio/x-m4a', 'AUDIO/WAV; codecs=1', 'video/mp4', 'video/webm']) {
      expect(audioFileProblem(file(type))).toBeNull();
    }
    for (const type of ['video/quicktime', 'audio/', 'image/png', 'application/ogg', '']) {
      expect(audioFileProblem(file(type))).toBe('Choose an audio file (or an MP4/WebM video)');
    }
  });
});

describe('AiTranscript', () => {
  it('shows the text, metadata and timestamped segments', () => {
    render(<AiTranscript output={mockAiTranscriptionRunOutput} />);
    const region = screen.getByRole('region', { name: 'Transcript' });
    expect(within(region).getByTestId('transcript-text')).toHaveTextContent(mockAiTranscriptionRunOutput.text);
    const list = within(region).getByRole('list', { name: 'Segments' });
    const first = within(list).getAllByRole('listitem')[0];
    expect(first).toHaveTextContent('0:00–0:04Hello and welcome.');
    expect(first.querySelector('time')).toHaveAttribute('datetime', 'PT0S');
  });

  it('omits segments and metadata the provider did not report', () => {
    render(
      <AiTranscript
        output={{ ...mockAiTranscriptionRunOutput, segments: undefined, language: undefined, durationSeconds: undefined }}
      />,
    );
    expect(screen.queryByRole('list', { name: 'Segments' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Language:/)).not.toBeInTheDocument();
  });

  it('says so when nothing was recognised, and cannot copy empty text', () => {
    render(<AiTranscript output={{ ...mockAiTranscriptionRunOutput, text: '', segments: [] }} />);
    expect(screen.getByText('No speech was recognised.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy transcript' })).toBeDisabled();
  });
});

describe('AiTranscript extras (PP-14.17)', () => {
  it('shows speaker-labelled segments when the provider reported them', () => {
    render(
      <AiTranscript
        output={{
          ...mockAiTranscriptionRunOutput,
          extras: {
            segments: [
              { start: 0, end: 1.2, text: 'hello there', speaker: 'A' },
              { start: 65, end: 66, text: 'hi', speaker: 'B' },
            ],
          },
        }}
      />,
    );

    const list = screen.getByRole('list', { name: 'Speakers' });
    const items = within(list).getAllByRole('listitem');

    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('0:00–0:01Ahello there');
    expect(items[1]).toHaveTextContent('1:05–1:06Bhi');
  });

  it('draws nothing extra without extras (the DOM is unchanged)', () => {
    render(<AiTranscript output={mockAiTranscriptionRunOutput} />);

    expect(screen.queryByRole('list', { name: 'Speakers' })).not.toBeInTheDocument();
  });

  it('extras without segments (only language, or other JSON) draw no list', () => {
    render(<AiTranscript output={{ ...mockAiTranscriptionRunOutput, extras: { language: 'en', confidence: 0.9 } }} />);

    expect(screen.queryByRole('list', { name: 'Speakers' })).not.toBeInTheDocument();
  });
});
