/**
 * `useAiCapabilities` and the capability label store — PP-14.17 (#935).
 *
 * The vocabulary is open: a capability an app registered on the API reaches the
 * pages with its label and no web change, from `GET /admin/ai/capabilities`
 * (admin pages) or `registerAiCapabilityLabel` (pages a viewer without
 * `ai_config:read` sees). One that has neither renders as its id.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { PlatformHostProvider } from '../../../src/core/index.js';
import { createTestPlatformHost } from '../../../src/testing/index.js';
import { render } from '../harness.js';
import { useAiCapabilities } from '../../../src/ai/headless/use-ai-capabilities.js';
import {
  getRegisteredAiCapabilityLabel,
  registerAiCapabilityLabel,
  resetAiCapabilityLabelsForTests,
} from '../../../src/ai/headless/capability-labels.js';
import { aiCapabilityLabel, capabilitySummary } from '../../../src/ai/ui/shared/aiCapabilities.js';
import { AiCapabilityChips } from '../../../src/ai/ui/shared/AiCapabilityChips.js';
import type { AiCapabilitiesResponse } from '../../../src/ai/headless/types.js';

const VOCABULARY: AiCapabilitiesResponse = {
  capabilities: [
    { id: 'responses', label: 'Text', description: 'Answers text prompts.', builtin: true },
    { id: 'speaker_diarization', label: 'Diarization', description: 'Labels who spoke when.', builtin: false },
  ],
  operations: [
    { id: 'audio.diarize', label: 'Diarization', capability: 'speaker_diarization', builtin: false, runnable: true },
  ],
};

function wrapperFor(responses: Record<string, unknown>) {
  const host = createTestPlatformHost({ permissions: ['ai_config:read'], responses: responses as never });

  return {
    host,
    wrapper: ({ children }: { children: ReactNode }) => <PlatformHostProvider host={host}>{children}</PlatformHostProvider>,
  };
}

describe('useAiCapabilities', () => {
  afterEach(() => resetAiCapabilityLabelsForTests());

  it('loads the vocabularies from GET /admin/ai/capabilities and records the labels', async () => {
    const { host, wrapper } = wrapperFor({ 'GET /admin/ai/capabilities': VOCABULARY });
    const { result } = renderHook(() => useAiCapabilities(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.capabilities.map((c) => c.id)).toEqual(['responses', 'speaker_diarization']);
    expect(result.current.operations[0]).toMatchObject({ id: 'audio.diarize', runnable: true });
    expect(result.current.error).toBeNull();
    expect(host.requests.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /admin/ai/capabilities']);
    expect(getRegisteredAiCapabilityLabel('speaker_diarization')).toBe('Diarization');
  });

  it('a failed fetch is an error string with empty lists, never a throw (the built-ins need no API)', async () => {
    const { wrapper } = wrapperFor({});
    const { result } = renderHook(() => useAiCapabilities(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.capabilities).toEqual([]);
    expect(result.current.error).toEqual(expect.any(String));
  });
});

describe('capability labels', () => {
  afterEach(() => resetAiCapabilityLabelsForTests());

  it('a built-in keeps its label; an unregistered capability renders as its id', () => {
    expect(aiCapabilityLabel('audio_transcription')).toBe('Transcription');
    expect(aiCapabilityLabel('ocr_text')).toBe('ocr_text');
  });

  it('an app label registered at module scope is used by chips and summaries', () => {
    registerAiCapabilityLabel('ocr_text', 'OCR');

    expect(aiCapabilityLabel('ocr_text')).toBe('OCR');
    expect(capabilitySummary(['responses', 'ocr_text'])).toBe('Text, OCR');

    render(<AiCapabilityChips capabilities={['responses', 'ocr_text']} />);
    expect(screen.getByText('OCR')).toBeInTheDocument();
  });

  it('cannot shadow a built-in label', () => {
    registerAiCapabilityLabel('responses', 'Hijacked');

    expect(aiCapabilityLabel('responses')).toBe('Text');
  });
});
