// =============================================================================
// The example provider's transport: the one seam to the vendor's service
// (PP-14.6, issue #924)
// =============================================================================
//
// A real provider (AssemblyAI, Deepgram, ...) would put its SDK or an HTTP
// client behind this interface, in its own folder, and list the SDK in the
// definition's `sdkPackages`. The example ships a FAKE one so the worked
// example, its tests and CI never touch the network: it is injected through
// `EXAMPLE_TRANSCRIBE_TRANSPORT`, which a test (or a fork) overrides.
//
// The transport sees the resolved key and the provider's non-secret settings
// (`region`), per call, and keeps neither: the adapter holds no credential.
// =============================================================================

/** Injection token of the {@link ExampleTranscribeTransport}. */
export const EXAMPLE_TRANSCRIBE_TRANSPORT: unique symbol = Symbol('EXAMPLE_TRANSCRIBE_TRANSPORT');

/** The processing regions the vendor offers (`ai.providers['example-transcribe'].region`). */
export type ExampleTranscribeRegion = 'us' | 'eu';

/** What the vendor's service needs to transcribe one recording. */
export interface ExampleTranscribeRequest {
  /** The key the call is made under. Secret: never log it. */
  apiKey: string;
  /** The processing region, from the provider's settings. */
  region: ExampleTranscribeRegion;
  /** The vendor's model. */
  model: string;
  /** The recording. */
  audio: Uint8Array;
  /** The recording's MIME type. */
  mimeType: string;
  /** ISO-639-1 hint. */
  language?: string;
}

/** What the vendor's service answers. */
export interface ExampleTranscribeResponse {
  /** The transcript. */
  text: string;
  /** The recording's length in seconds, when the vendor reports it. */
  durationSeconds?: number;
  /** The language detected (or hinted). */
  language?: string;
  /** The vendor's request id. */
  requestId?: string;
}

/** A failed vendor call: the HTTP status the service answered with. */
export class ExampleTranscribeTransportError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ExampleTranscribeTransportError';
  }
}

/** The vendor's service, as the adapter needs it. */
export interface ExampleTranscribeTransport {
  /** The vendor's model ids, under `apiKey`. @throws ExampleTranscribeTransportError (401 for a rejected key). */
  listModels(apiKey: string, region: ExampleTranscribeRegion): Promise<string[]>;
  /** Transcribes one recording. @throws ExampleTranscribeTransportError. */
  transcribe(request: ExampleTranscribeRequest): Promise<ExampleTranscribeResponse>;
}

/** One call the fake transport recorded. The key is kept so a test can prove which key paid. */
export interface RecordedTransportCall {
  /** `listModels` or `transcribe`. */
  operation: 'listModels' | 'transcribe';
  /** The key the call carried. */
  apiKey: string;
  /** The region the call carried. */
  region: ExampleTranscribeRegion;
  /** The model, for a `transcribe`. */
  model?: string;
  /** The recording's size in bytes, for a `transcribe`. */
  bytes?: number;
}

/** The one model the fake vendor serves. */
export const EXAMPLE_TRANSCRIBE_MODEL = 'example-asr-1';
/** A model id the fake vendor fails on (a 500), for the conformance kit. */
export const EXAMPLE_TRANSCRIBE_BROKEN_MODEL = 'example-asr-broken';
/** The key the fake vendor rejects (a 401). Every other key is accepted. */
export const EXAMPLE_TRANSCRIBE_REJECTED_KEY = 'example-rejected-key';

/**
 * An in-memory vendor: deterministic, no network. It records every call (with
 * the key and region it carried) and transcribes a recording to
 * `example transcript (<region>, <n> bytes)`, one second per 1000 bytes.
 */
export class FakeExampleTranscribeTransport implements ExampleTranscribeTransport {
  /** Every call, in order. */
  readonly calls: RecordedTransportCall[] = [];

  async listModels(apiKey: string, region: ExampleTranscribeRegion): Promise<string[]> {
    this.calls.push({ operation: 'listModels', apiKey, region });
    this.assertKey(apiKey);

    return [EXAMPLE_TRANSCRIBE_MODEL];
  }

  async transcribe(request: ExampleTranscribeRequest): Promise<ExampleTranscribeResponse> {
    this.calls.push({
      operation: 'transcribe',
      apiKey: request.apiKey,
      region: request.region,
      model: request.model,
      bytes: request.audio.byteLength,
    });
    this.assertKey(request.apiKey);

    if (request.model === EXAMPLE_TRANSCRIBE_BROKEN_MODEL) {
      throw new ExampleTranscribeTransportError(500, 'the vendor failed');
    }

    return {
      text: `example transcript (${request.region}, ${request.audio.byteLength} bytes)`,
      durationSeconds: request.audio.byteLength / 1000,
      ...(request.language ? { language: request.language } : {}),
      requestId: `example-req-${this.calls.length}`,
    };
  }

  /** The calls of one operation. */
  callsTo(operation: RecordedTransportCall['operation']): RecordedTransportCall[] {
    return this.calls.filter((call) => call.operation === operation);
  }

  private assertKey(apiKey: string): void {
    if (apiKey === EXAMPLE_TRANSCRIBE_REJECTED_KEY) {
      throw new ExampleTranscribeTransportError(401, 'the vendor rejected the key');
    }
  }
}
