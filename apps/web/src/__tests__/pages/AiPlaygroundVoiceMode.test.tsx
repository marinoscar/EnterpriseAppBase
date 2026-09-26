/**
 * `/ai` — the Playground's Voice mode (issue #449).
 *
 * Offered only when `GET /ai/config` says `allowRealtime: true`; models are
 * filtered by the `realtime` capability; a call shows a live You/Assistant
 * transcript, mutes, stops and cleans up; every failure has its own copy.
 * The network is MSW; WebRTC and the microphone are `utils/fakeWebRtc.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { render } from '../utils/test-utils';
import { server } from '../mocks/server';
import { aiErrorBody, mockAiPublicConfigEnabled, mockPlaygroundModels } from '../mocks/fixtures/ai';
import AiPlaygroundPage from '../../pages/AiPlaygroundPage';
import { AiConfigContext, type UseAiConfigReturn } from '../../hooks/useAiConfig';
import type { AiPublicConfig, UsableAiModel } from '../../services/ai';
import {
  FAKE_CLIENT_SECRET,
  installFakeWebRtc,
  mediaError,
  mockRealtimeNetwork,
  type FakeWebRtc,
} from '../utils/fakeWebRtc';

const REALTIME_MODEL: UsableAiModel = {
  provider: 'openai',
  modelId: 'gpt-realtime',
  displayName: 'GPT Realtime',
  capabilities: {
    capabilities: ['realtime'],
    inputModalities: ['text', 'audio'],
    outputModalities: ['text', 'audio'],
    voices: ['marin', 'cedar'],
  },
  keySource: 'user',
};

function serveModels(models: UsableAiModel[]) {
  server.use(http.get('*/api/ai/models', () => HttpResponse.json({ data: models })));
}

async function renderPlayground(config: AiPublicConfig) {
  const user = userEvent.setup();
  const aiValue: UseAiConfigReturn = {
    config,
    isLoading: false,
    error: null,
    refresh: vi.fn().mockResolvedValue(undefined),
  };
  const view = render(
    <AiConfigContext.Provider value={aiValue}>
      <AiPlaygroundPage />
    </AiConfigContext.Provider>,
    { wrapperOptions: { route: '/ai', aiEnabled: true } },
  );
  const modes = await screen.findByRole('group', { name: 'Playground mode' });
  return { user, modes, view };
}

async function openVoice() {
  const rendered = await renderPlayground({ ...mockAiPublicConfigEnabled, allowRealtime: true });
  await rendered.user.click(within(rendered.modes).getByRole('button', { name: 'Voice' }));
  const panel = screen.getByTestId('playground-mode-voice');
  await waitFor(() =>
    expect(within(panel).getByRole('combobox', { name: 'Model' })).toHaveTextContent('GPT Realtime'),
  );
  return { ...rendered, panel };
}

let rtc: FakeWebRtc;

beforeEach(() => {
  rtc = installFakeWebRtc();
  serveModels([...mockPlaygroundModels, REALTIME_MODEL]);
});

afterEach(() => {
  rtc.restore();
});

describe('AiPlaygroundPage — Voice mode', () => {
  it('is hidden when realtime sessions are not allowed, even with a realtime model', async () => {
    const { modes } = await renderPlayground({ ...mockAiPublicConfigEnabled, allowRealtime: false });
    expect(within(modes).getByRole('button', { name: 'Chat' })).toBeInTheDocument();
    expect(within(modes).queryByRole('button', { name: 'Voice' })).not.toBeInTheDocument();
  });

  it('is hidden when the API does not report allowRealtime at all', async () => {
    const { modes } = await renderPlayground(mockAiPublicConfigEnabled);
    expect(within(modes).queryByRole('button', { name: 'Voice' })).not.toBeInTheDocument();
  });

  it('is shown when allowed and a realtime model exists, listing only realtime models and their voices', async () => {
    const { user, panel } = await openVoice();

    expect(within(screen.getByRole('group', { name: 'Playground mode' })).getByRole('button', { name: 'Voice' }))
      .toHaveAttribute('aria-pressed', 'true');
    await user.click(within(panel).getByRole('combobox', { name: 'Model' }));
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([expect.stringContaining('GPT Realtime')]);
    await user.keyboard('{Escape}');

    expect(within(panel).getByRole('combobox', { name: 'Voice' })).toHaveTextContent('marin');
    expect(within(panel).getByRole('button', { name: 'Start' })).toBeEnabled();
  });

  it('is offered but disabled, with the reason, when no usable model has realtime', async () => {
    serveModels(mockPlaygroundModels);
    const { user, modes } = await renderPlayground({ ...mockAiPublicConfigEnabled, allowRealtime: true });
    const voice = within(modes).getByRole('button', { name: 'Voice' });
    expect(voice).toHaveAttribute('aria-disabled', 'true');
    await user.hover(voice);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'None of the models available to you can hold a voice conversation',
    );
  });

  it('starts a call, shows both sides of the transcript, and cleans up on Stop', async () => {
    const network = mockRealtimeNetwork();
    const { user, panel } = await openVoice();
    await user.click(within(panel).getByRole('combobox', { name: 'Voice' }));
    await user.click(screen.getByRole('option', { name: 'cedar' }));
    await user.type(within(panel).getByLabelText('Instructions'), 'Be brief.');

    await user.click(within(panel).getByRole('button', { name: 'Start' }));

    await waitFor(() => expect(within(panel).getByTestId('realtime-status')).toHaveTextContent(/^Live · 00:0\d$/));
    expect(network.mints).toEqual([
      { provider: 'openai', model: 'gpt-realtime', voice: 'cedar', instructions: 'Be brief.' },
    ]);

    const channel = rtc.peer().channel!;
    act(() => {
      channel.open();
      channel.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u1', transcript: 'What time is it?' });
      channel.emit({ type: 'response.output_audio_transcript.done', item_id: 'a1', transcript: 'It is noon.' });
    });

    const log = within(panel).getByRole('log', { name: 'Voice transcript' });
    expect(log).toHaveAttribute('aria-live', 'polite');
    expect(within(log).getByText('You')).toBeInTheDocument();
    expect(within(log).getByText('What time is it?')).toBeInTheDocument();
    expect(within(log).getByText('Assistant')).toBeInTheDocument();
    expect(within(log).getByText('It is noon.')).toBeInTheDocument();

    // The ephemeral secret is never on screen.
    expect(document.body.textContent).not.toContain(FAKE_CLIENT_SECRET);

    await user.click(within(panel).getByRole('button', { name: 'Mute' }));
    expect(rtc.mic.track.enabled).toBe(false);
    expect(within(panel).getByRole('button', { name: 'Unmute' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(panel).getByRole('button', { name: 'Stop' }));
    expect(rtc.peer().close).toHaveBeenCalled();
    expect(channel.close).toHaveBeenCalled();
    expect(rtc.mic.track.stop).toHaveBeenCalled();
    expect(within(panel).getByRole('button', { name: 'Start' })).toBeInTheDocument();
    expect(within(panel).getByTestId('realtime-status')).toHaveTextContent(/^Ended/);
    // The transcript stays readable after the call.
    expect(within(log).getByText('It is noon.')).toBeInTheDocument();
  });

  it('explains a blocked microphone', async () => {
    rtc.restore();
    rtc = installFakeWebRtc({ getUserMedia: () => Promise.reject(mediaError('NotAllowedError')) });
    const { user, panel } = await openVoice();
    await user.click(within(panel).getByRole('button', { name: 'Start' }));
    expect(await within(panel).findByText('Microphone access was blocked')).toBeInTheDocument();
  });

  it('renders the mint refusal through AiErrorAlert', async () => {
    mockRealtimeNetwork({ mintBody: aiErrorBody('AI_REALTIME_DISABLED', 'Realtime sessions are disabled'), mintStatus: 403 });
    const { user, panel } = await openVoice();
    await user.click(within(panel).getByRole('button', { name: 'Start' }));
    const alert = await within(panel).findByRole('alert');
    expect(alert).toHaveAttribute('data-ai-error-code', 'AI_REALTIME_DISABLED');
    expect(alert).toHaveTextContent('Voice sessions are turned off by your administrator.');
  });

  it('reports a dropped connection', async () => {
    mockRealtimeNetwork();
    const { user, panel } = await openVoice();
    await user.click(within(panel).getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(within(panel).getByTestId('realtime-status')).toHaveTextContent(/^Live/));
    act(() => rtc.peer().setConnectionState('disconnected'));
    expect(await within(panel).findByText('The connection was lost')).toBeInTheDocument();
    expect(rtc.mic.track.stop).toHaveBeenCalled();
  });

  it('ends the call when the page unmounts', async () => {
    mockRealtimeNetwork();
    const { user, panel, view } = await openVoice();
    await user.click(within(panel).getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(within(panel).getByTestId('realtime-status')).toHaveTextContent(/^Live/));
    view.unmount();
    expect(rtc.peer().close).toHaveBeenCalled();
    expect(rtc.mic.track.stop).toHaveBeenCalled();
  });
});
