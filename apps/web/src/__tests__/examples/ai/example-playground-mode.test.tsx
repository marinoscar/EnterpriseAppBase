/**
 * Issue #935 (PP-14.17): an app adds a mode to the AI Playground with
 * `registerAiPlaygroundMode` and no package edit.
 *
 * The mode (`platform-extensions/ai/diarize-playground-mode.example.tsx`) lists
 * the models that declare the app capability `speaker_diarization`, reuses the
 * packaged Transcribe panel with `providerOptions: { 'example-transcribe':
 * { diarize: true } }`, and the transcript comes back with speaker-labelled
 * segments (`output.extras.segments`). Nothing is mocked but the network (MSW):
 * the test proves the wire.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import AiPlaygroundPage from '@marinoscar/platform-web/ai/ui/playground-page';
import { render } from '../../utils/test-utils';
import { server } from '../../mocks/server';
import { RECORDING_OBJECT_ID, mockPlaygroundTranscriptionModel, mockStorageObject } from '../../mocks/fixtures/ai';
import { readMultipartFile } from '../../utils/multipart';
import { api } from '../../../services/api';
import {
  DIARIZE_MODE_ID,
  registerDiarizePlaygroundMode,
} from '../../../platform-extensions/ai/diarize-playground-mode.example';

const DIARIZING_MODEL = {
  provider: 'example-transcribe',
  modelId: 'example-asr-1',
  displayName: 'Example ASR',
  capabilities: {
    capabilities: ['audio_transcription', 'speaker_diarization'],
    inputModalities: ['audio'],
    outputModalities: ['text'],
  },
  keySource: 'user',
};

const RUN_ID = 'run_diarize_1';

function fileList(...files: File[]): FileList {
  const list = { length: files.length, item: (index: number) => files[index] ?? null } as unknown as FileList;
  files.forEach((file, index) => Object.defineProperty(list, index, { value: file, enumerable: true }));
  return list;
}

describe('an app-registered playground mode (PP-14.17)', () => {
  beforeAll(() => registerDiarizePlaygroundMode());

  beforeEach(() => {
    api.setAccessToken('access-token-1');
  });

  afterEach(() => {
    api.setAccessToken(null);
  });

  it('is offered after the built-ins only when a usable model declares its capability', async () => {
    server.use(http.get('*/api/ai/models', () => HttpResponse.json({ data: [mockPlaygroundTranscriptionModel, DIARIZING_MODEL] })));
    render(<AiPlaygroundPage />, { wrapperOptions: { route: '/ai', aiEnabled: true } });

    const modes = await screen.findByRole('group', { name: 'Playground mode' });
    const buttons = within(modes).getAllByRole('button');

    expect(buttons.at(-1)).toHaveTextContent('Diarize');
    expect(buttons.at(-1)).not.toHaveAttribute('aria-disabled');
  });

  it('is disabled, with its reason, when no model can tell speakers apart', async () => {
    server.use(http.get('*/api/ai/models', () => HttpResponse.json({ data: [mockPlaygroundTranscriptionModel] })));
    render(<AiPlaygroundPage />, { wrapperOptions: { route: '/ai', aiEnabled: true } });

    const modes = await screen.findByRole('group', { name: 'Playground mode' });

    expect(within(modes).getByRole('button', { name: 'Diarize' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('uploads, POSTs the transcription with the diarize provider option, and shows the speakers', async () => {
    const posted: unknown[] = [];

    server.use(
      http.get('*/api/ai/models', () => HttpResponse.json({ data: [DIARIZING_MODEL] })),
      http.post('*/api/storage/objects', async ({ request }) => {
        const file = await readMultipartFile(request);
        return HttpResponse.json({ data: mockStorageObject({ id: RECORDING_OBJECT_ID, mimeType: file.type }) }, { status: 201 });
      }),
      http.get('*/api/storage/objects/:id', ({ params }) =>
        HttpResponse.json({ data: mockStorageObject({ id: String(params.id), status: 'ready' }) }),
      ),
      http.post('*/api/ai/audio/transcriptions', async ({ request }) => {
        posted.push(await request.json());
        return HttpResponse.json({ data: { runId: RUN_ID, jobId: 'job_diarize_1' } }, { status: 202 });
      }),
      http.get(`*/api/ai/runs/${RUN_ID}`, () =>
        HttpResponse.json({
          data: {
            id: RUN_ID,
            status: 'succeeded',
            provider: 'example-transcribe',
            modelId: 'example-asr-1',
            output: {
              type: 'transcription',
              provider: 'example-transcribe',
              model: 'example-asr-1',
              storageObjectId: RECORDING_OBJECT_ID,
              text: 'hello there hi',
              extras: {
                segments: [
                  { start: 0, end: 1, text: 'hello there', speaker: 'A' },
                  { start: 1, end: 2, text: 'hi', speaker: 'B' },
                ],
              },
              usage: {},
            },
            errorCode: null,
            errorMessage: null,
            createdAt: '2026-10-13T10:00:00.000Z',
            completedAt: '2026-10-13T10:00:03.000Z',
          },
        }),
      ),
    );

    const user = userEvent.setup();
    render(<AiPlaygroundPage />, { wrapperOptions: { route: '/ai', aiEnabled: true } });

    const modes = await screen.findByRole('group', { name: 'Playground mode' });
    await user.click(within(modes).getByRole('button', { name: 'Diarize' }));

    const panel = await screen.findByTestId(`playground-mode-${DIARIZE_MODE_ID}`);
    await waitFor(() => expect(within(panel).getByRole('combobox', { name: 'Model' })).toHaveTextContent('Example ASR'));
    fireEvent.change(within(panel).getByLabelText('Recording'), {
      target: { files: fileList(new File(['a'], 'memo.mp3', { type: 'audio/mpeg' })) },
    });
    await user.click(within(panel).getByRole('button', { name: 'Transcribe' }));

    await waitFor(() => expect(posted).toHaveLength(1), { timeout: 3000 });
    expect(posted[0]).toEqual({
      provider: 'example-transcribe',
      model: 'example-asr-1',
      storageObjectId: RECORDING_OBJECT_ID,
      timestampGranularities: ['segment'],
      providerOptions: { 'example-transcribe': { diarize: true } },
    });

    const speakers = await within(panel).findByRole('list', { name: 'Speakers' }, { timeout: 5000 });
    const items = within(speakers).getAllByRole('listitem');

    expect(items[0]).toHaveTextContent('Ahello there');
    expect(items[1]).toHaveTextContent('Bhi');
  });
});
