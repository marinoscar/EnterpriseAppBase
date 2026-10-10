// =============================================================================
// ExampleTranscribeAdapter: an app-side AI provider that only transcribes
// (PP-14.6, issue #924)
// =============================================================================
//
// The stand-in for "add AssemblyAI to this app". It implements the neutral
// `AiProviderAdapter` contract and carries ONE capability port, `audio` with
// `transcribe` and nothing else: presence is the declaration, so the registry
// derives `audio_transcription` and no other capability, and every other
// operation is refused by the gate pipeline before this class is reached.
//
//   - The vendor sits behind `ExampleTranscribeTransport` (injected), so the
//     class has no SDK import and no network: a real provider would put its SDK
//     in this folder and list the package in its definition's `sdkPackages`.
//   - It holds no key. Every call receives one in its `AiCallContext`
//     (the user's, the organization's or the deployment's, per the key policy)
//     and hands it straight to the transport.
//   - Its one setting, `region`, arrives in `ctx.providerSettings` from the
//     `ai.providers['example-transcribe']` slot; this file reads it with its own
//     schema, as the built-in adapters do.
//   - Every failure leaves as an `AiError`; the vendor's message is never copied
//     (it may echo the request).
//
// Registered from `app-registrations/ai.ts`; its module registers it with the
// `AiProviderRegistry` at `onModuleInit`, like the built-ins' modules.
// =============================================================================

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  AiError,
  AiProviderRegistry,
  isStreamedPayload,
  type AiAudioPort,
  type AiCallContext,
  type AiDiscoveredModel,
  type AiKeyVerification,
  type AiMediaInput,
  type AiModelCapabilities,
  type AiProviderAdapter,
  type AiTranscriptionRequest,
  type AiTranscriptionResult,
} from '@marinoscar/platform-api/ai';
import { z } from 'zod';

import {
  EXAMPLE_TRANSCRIBE_TRANSPORT,
  ExampleTranscribeTransportError,
  type ExampleTranscribeRegion,
  type ExampleTranscribeTransport,
} from './example-transcribe.transport';

/** The provider id: the key of `ai.providers`, the credential name and the usage rows' `provider`. Permanent. */
export const EXAMPLE_TRANSCRIBE_PROVIDER_ID = 'example-transcribe';

/** The one setting, read from the call's `providerSettings` with the same schema the definition registers. */
export const exampleTranscribeSettingsSchema = z.object({
  region: z.enum(['us', 'eu']).default('us').describe('Processing region'),
});

/** The largest recording the vendor takes: 100 MiB. */
const MAX_BYTES = 100 * 1024 * 1024;

/** What the catalog stores for the vendor's model. */
const TRANSCRIPTION_CAPABILITIES: AiModelCapabilities = {
  capabilities: ['audio_transcription'],
  inputModalities: ['audio'],
  outputModalities: ['text'],
};

@Injectable()
export class ExampleTranscribeAdapter implements AiProviderAdapter, OnModuleInit {
  readonly id = EXAMPLE_TRANSCRIBE_PROVIDER_ID;
  readonly displayName = 'Example Transcribe';

  /** Shown by the Doctor's egress inventory; the fake transport calls nothing. */
  readonly defaultBaseUrl = 'https://api.example-transcribe.invalid';

  /** The only port: transcription. No `responses`, `images`, `embeddings` or `realtime`. */
  readonly audio: AiAudioPort = {
    transcribe: (req, ctx) => this.transcribe(req, ctx),
    transcriptionMaxBytes: MAX_BYTES,
  };

  private readonly logger = new Logger(ExampleTranscribeAdapter.name);

  constructor(
    private readonly registry: AiProviderRegistry,
    @Inject(EXAMPLE_TRANSCRIBE_TRANSPORT) private readonly transport: ExampleTranscribeTransport,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  classifyModel(modelId: string): AiModelCapabilities | null {
    return modelId.startsWith('example-asr-') ? TRANSCRIPTION_CAPABILITIES : null;
  }

  async listModels(ctx: AiCallContext): Promise<AiDiscoveredModel[]> {
    const ids = await this.guard('listModels', () => this.transport.listModels(ctx.apiKey, this.region(ctx)));

    return ids.map((id) => ({ id, ownedBy: EXAMPLE_TRANSCRIBE_PROVIDER_ID }));
  }

  async verifyKey(ctx: AiCallContext): Promise<AiKeyVerification> {
    try {
      await this.transport.listModels(ctx.apiKey, this.region(ctx));

      return { ok: true };
    } catch (error) {
      if (error instanceof ExampleTranscribeTransportError && (error.status === 401 || error.status === 403)) {
        return { ok: false, code: 'AI_KEY_INVALID' };
      }

      return { ok: false, code: 'AI_PROVIDER_UNAVAILABLE' };
    }
  }

  private async transcribe(req: AiTranscriptionRequest, ctx: AiCallContext): Promise<AiTranscriptionResult> {
    const audio = await readAudio(req.audio);
    const response = await this.guard('transcribe', () =>
      this.transport.transcribe({
        apiKey: ctx.apiKey,
        region: this.region(ctx),
        model: req.model,
        audio: audio.bytes,
        mimeType: audio.mimeType,
        ...(req.language ? { language: req.language } : {}),
      }),
    );

    return {
      provider: this.id,
      model: req.model,
      usage: {},
      text: response.text,
      ...(response.language ? { language: response.language } : {}),
      ...(response.durationSeconds === undefined ? {} : { durationSeconds: response.durationSeconds }),
      ...(response.requestId ? { providerRequestId: response.requestId } : {}),
    };
  }

  private region(ctx: AiCallContext): ExampleTranscribeRegion {
    const parsed = exampleTranscribeSettingsSchema.safeParse(ctx.providerSettings ?? {});

    return parsed.success ? parsed.data.region : 'us';
  }

  /** Runs a transport call and turns any failure into an `AiError` with a generic message. */
  private async guard<T>(operation: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof AiError) throw error;

      const status = error instanceof ExampleTranscribeTransportError ? error.status : undefined;
      this.logger.warn(`Example Transcribe ${operation} failed${status === undefined ? '' : ` (HTTP ${status})`}`);

      if (status === 401 || status === 403) {
        throw new AiError('AI_KEY_INVALID', 'The Example Transcribe service rejected the key.', { cause: error });
      }
      if (status === 429) {
        throw new AiError('AI_RATE_LIMITED', 'The Example Transcribe service is rate limiting this key.', { cause: error });
      }

      throw AiError.wrap(error);
    }
  }
}

/**
 * The recording as bytes. A streamed input larger than the declared maximum is
 * refused BEFORE it is read: the runtime already checks `size`, and this is the
 * adapter's own defence against a direct caller.
 */
async function readAudio(input: AiMediaInput): Promise<{ bytes: Uint8Array; mimeType: string }> {
  if (!isStreamedPayload(input)) return { bytes: input.data, mimeType: input.mimeType };

  if (input.size !== undefined && input.size > MAX_BYTES) {
    throw new AiError('AI_INVALID_REQUEST', `The recording is larger than the ${MAX_BYTES} bytes this provider accepts.`);
  }

  const chunks: Uint8Array[] = [];
  let total = 0;

  for await (const chunk of input.stream) {
    total += chunk.byteLength;
    if (total > MAX_BYTES) {
      throw new AiError('AI_INVALID_REQUEST', `The recording is larger than the ${MAX_BYTES} bytes this provider accepts.`);
    }
    chunks.push(chunk);
  }

  return { bytes: Buffer.concat(chunks), mimeType: input.mimeType };
}
