// Builders for Gemini API wire objects in tests (issue #447). Not imported by
// production code.
//
// These are the REST shapes (`generativelanguage.googleapis.com/v1beta`), not
// the SDK's classes: the mock transport sends them over HTTP and the real SDK
// parses them, exactly as it would the real API's. `streamChunksFor` turns
// one response into the chunk sequence `streamGenerateContent?alt=sse` sends
// for it — text split into slices, a function call whole, and a final chunk
// carrying the finish reason and the full usage — so a streamed and a
// non-streamed call can be driven from the same fixture.

let counter = 0;

/**
 * One part of a Gemini wire `Content`, as the REST API sends it.
 *
 * @stability experimental
 */
export interface GeminiWirePart {
  /** Text. */
  text?: string;
  /** Whether the text is a thought summary. */
  thought?: boolean;
  /** The opaque thought signature attached to the part. */
  thoughtSignature?: string;
  /** A function call the model made. */
  functionCall?: {
    /** The function name. */
    name: string;
    /** The function arguments. */
    args?: Record<string, unknown>;
    /** The call id. */
    id?: string;
  };
  /** A function result sent back to the model. */
  functionResponse?: {
    /** The function name. */
    name: string;
    /** The response object to answer with. */
    response: Record<string, unknown>;
    /** The call id. */
    id?: string;
  };
  /** Inline (base64) data. */
  inlineData?: {
    /** The MIME type. */
    mimeType: string;
    /** The base64 data. */
    data: string;
  };
  /** Data referenced by URI. */
  fileData?: {
    /** The file URI. */
    fileUri: string;
    /** The MIME type. */
    mimeType?: string;
  };
  /** Code the model ran. */
  executableCode?: {
    /** The code language. */
    language: string;
    /** The code. */
    code: string;
  };
}

/**
 * Gemini wire usage metadata.
 *
 * @stability experimental
 */
export interface GeminiWireUsage {
  /** Prompt tokens. */
  promptTokenCount?: number;
  /** Candidate (output) tokens. */
  candidatesTokenCount?: number;
  /** Thinking tokens. */
  thoughtsTokenCount?: number;
  /** Prompt tokens served from the cache. */
  cachedContentTokenCount?: number;
  /** Tokens of tool-use prompts. */
  toolUsePromptTokenCount?: number;
  /** All tokens. */
  totalTokenCount?: number;
}

/**
 * A Gemini `generateContent` answer, as the REST API sends it.
 *
 * @stability experimental
 */
export interface GeminiWireResponse {
  /** The candidates; the adapter reads the first. */
  candidates?: Array<{
    /** The candidate's content. */
    content?: {
      /** Always `model`. */
      role: 'model';
      /** The parts. */
      parts: GeminiWirePart[];
    };
    /** Why the candidate finished. */
    finishReason?: string;
    /** The candidate's index. */
    index?: number;
  }>;
  /** Feedback on the prompt (set when it was blocked). */
  promptFeedback?: {
    /** Why the prompt was blocked. */
    blockReason?: string;
  };
  /** Token usage. */
  usageMetadata?: GeminiWireUsage;
  /** The model version that answered. */
  modelVersion?: string;
  /** The response id. */
  responseId?: string;
}

/**
 * A text part, optionally carrying a thought signature.
 *
 * @stability experimental
 */
export function textPart(text: string, thoughtSignature?: string): GeminiWirePart {
  return { text, ...(thoughtSignature ? { thoughtSignature } : {}) };
}

/**
 * A thought-summary part, optionally carrying a thought signature.
 *
 * @stability experimental
 */
export function thoughtPart(text: string, thoughtSignature?: string): GeminiWirePart {
  return { text, thought: true, ...(thoughtSignature ? { thoughtSignature } : {}) };
}

/**
 * A function-call part.
 *
 * @stability experimental
 */
export function functionCallPart(
  name: string,
  args: Record<string, unknown>,
  opts: { id?: string; thoughtSignature?: string } = {},
): GeminiWirePart {
  return {
    functionCall: { name, args, ...(opts.id ? { id: opts.id } : {}) },
    ...(opts.thoughtSignature ? { thoughtSignature: opts.thoughtSignature } : {}),
  };
}

/**
 * A fresh opaque signature, base64 like the real ones.
 *
 * @stability experimental
 */
export function signature(): string {
  return Buffer.from(`sig-${++counter}-${Math.random()}`).toString('base64');
}

/**
 * Usage metadata with plausible counts, overridden by `patch`.
 *
 * @stability experimental
 */
export function usageFixture(patch: GeminiWireUsage = {}): GeminiWireUsage {
  return { promptTokenCount: 12, candidatesTokenCount: 7, totalTokenCount: 19, ...patch };
}

/**
 * What {@link responseFixture} builds a Gemini answer from.
 *
 * @stability experimental
 */
export interface ResponseFixtureOptions {
  /** The model version; a default model when absent. */
  model?: string;
  /** The parts of the first candidate. */
  parts: GeminiWirePart[];
  /** The finish reason; `STOP` when absent. */
  finishReason?: string;
  /** Usage overrides. */
  usage?: GeminiWireUsage;
  /** The response id; generated when absent. */
  responseId?: string;
}

/**
 * A complete `GenerateContentResponse` body. `finishReason` defaults to `STOP`.
 *
 * @stability experimental
 */
export function responseFixture(opts: ResponseFixtureOptions): GeminiWireResponse {
  return {
    candidates: [
      {
        content: { role: 'model', parts: opts.parts },
        finishReason: opts.finishReason ?? 'STOP',
        index: 0,
      },
    ],
    usageMetadata: usageFixture(opts.usage),
    modelVersion: opts.model ?? 'gemini-2.5-flash',
    responseId: opts.responseId ?? `resp_${++counter}`,
  };
}

function slices(text: string, size: number): string[] {
  const out: string[] = [];

  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));

  return out.length > 0 ? out : [''];
}

/**
 * The `streamGenerateContent` chunks for `response`: each text/thought part
 * split into `chunkSize`-character slices (the signature on the last slice),
 * each other part whole, then a final chunk with an empty text part, the
 * finish reason and the full usage. Every chunk repeats the response id and
 * model version, as the real API's do.
 *
 * @stability experimental
 */
export function streamChunksFor(response: GeminiWireResponse, chunkSize = 5): GeminiWireResponse[] {
  const candidate = response.candidates?.[0];
  const head = { modelVersion: response.modelVersion, responseId: response.responseId };
  const chunks: GeminiWireResponse[] = [];

  if (!candidate) {
    return [{ ...head, promptFeedback: response.promptFeedback, usageMetadata: response.usageMetadata }];
  }

  for (const part of candidate.content?.parts ?? []) {
    if (typeof part.text === 'string') {
      const pieces = slices(part.text, chunkSize);

      pieces.forEach((piece, i) => {
        const last = i === pieces.length - 1;
        const slice: GeminiWirePart = {
          text: piece,
          ...(part.thought ? { thought: true } : {}),
          ...(last && part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
        };

        chunks.push({
          ...head,
          candidates: [{ content: { role: 'model', parts: [slice] }, index: 0 }],
          usageMetadata: { promptTokenCount: response.usageMetadata?.promptTokenCount },
        });
      });
    } else {
      chunks.push({
        ...head,
        candidates: [{ content: { role: 'model', parts: [part] }, index: 0 }],
        usageMetadata: { promptTokenCount: response.usageMetadata?.promptTokenCount },
      });
    }
  }

  chunks.push({
    ...head,
    candidates: [{ content: { role: 'model', parts: [{ text: '' }] }, finishReason: candidate.finishReason, index: 0 }],
    usageMetadata: response.usageMetadata,
  });

  return chunks;
}

/**
 * A deterministic unit-ish vector for `text`, `length` long — the same text always embeds the same.
 *
 * @stability experimental
 */
export function embeddingFor(text: string, length: number): number[] {
  let seed = 0;

  for (const char of text) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;

  return Array.from({ length }, () => {
    seed = (seed * 1103515245 + 12345) >>> 0;

    return Number(((seed / 0xffffffff) * 2 - 1).toFixed(6));
  });
}
