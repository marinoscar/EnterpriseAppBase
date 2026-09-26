/**
 * Conversation state for the AI Playground — issue #434, epic #419.
 *
 * Owns the message list and one in-flight request at a time. A turn is sent
 * either streamed (`streamAiResponse`, built on `postSse`) or as one JSON
 * round trip (`createAiResponse`) when the model does not stream; either way
 * the assistant message is appended up front and filled in as the answer
 * arrives, so the thread never jumps.
 *
 * MULTI-TURN IS SERVER-SIDE. The provider keeps the conversation; each turn
 * sends only the new prompt plus `previousResponseId` — the id of the last
 * COMPLETED response. A stopped, failed or still-streaming turn never
 * advances it, so the next turn continues from the last answer that actually
 * finished.
 *
 * STOP IS IMMEDIATE ON THE CLIENT. `stop()` aborts the request (the API
 * observes the disconnect and aborts the provider call — #433) and marks the
 * message `stopped` right away rather than waiting for the stream promise to
 * settle; every callback checks its own controller afterwards and drops late
 * frames, so a delta already in flight cannot land on a stopped message.
 *
 * ATTACHMENTS (#445, API #441). A turn may carry already-uploaded storage
 * objects; the input then becomes one user message whose content is the text
 * followed by an `image`/`file` part per attachment (`chatTurnInput`), and
 * the user message keeps the attachments so the thread can show them.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createAiResponse,
  streamAiResponse,
  type AiOutputItem,
  type AiResponse,
  type AiResponseRequest,
  type AiUsage,
} from '../services/ai';
import { toAiErrorInfo, type AiErrorInfo } from '../services/aiErrors';
import { useIsMounted } from './useIsMounted';
import {
  chatTurnInput,
  withAttachmentContext,
  type AiChatAttachment,
} from '../components/ai/playground/chatAttachments';

export type AiChatMessageStatus = 'streaming' | 'done' | 'stopped' | 'error';

export interface AiChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  status: AiChatMessageStatus;
  /** Streamed reasoning summary (assistant only). */
  reasoning?: string;
  usage?: AiUsage;
  /** Structured output, when the request asked for one and it parsed. */
  parsed?: unknown;
  /** Provider response id — what the NEXT turn sends as `previousResponseId`. */
  responseId?: string;
  model?: string;
  error?: AiErrorInfo;
  /** Set on an assistant message that came from a background run. */
  runId?: string;
  /**
   * The completed response's output items (assistant only) — where hosted
   * tool calls and web-search citations live (#442, rendered by #445).
   */
  output?: AiOutputItem[];
  /** Files sent with a user message (#445). */
  attachments?: AiChatAttachment[];
}

/** Everything about a turn except its prompt and the conversation linkage. */
export type AiChatRequestOptions = Omit<AiResponseRequest, 'input' | 'previousResponseId'> & {
  /** `false` sends one JSON round trip instead of streaming. Default `true`. */
  stream?: boolean;
};

export interface UseAiChatReturn {
  messages: AiChatMessage[];
  isStreaming: boolean;
  /** The id the next turn will continue from, or `null` for a fresh thread. */
  previousResponseId: string | null;
  send: (prompt: string, options?: AiChatRequestOptions, attachments?: AiChatAttachment[]) => Promise<void>;
  stop: () => void;
  reset: () => void;
  /** Append a finished exchange produced elsewhere (a background run). */
  appendExchange: (
    prompt: string,
    response: AiResponse,
    extra?: { runId?: string; attachments?: AiChatAttachment[] },
  ) => void;
}

let sequence = 0;
function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence}`;
}

function fromResponse(response: AiResponse): Partial<AiChatMessage> {
  return {
    text: response.outputText,
    usage: response.usage,
    parsed: response.parsed,
    responseId: response.id,
    model: response.model,
    output: response.output,
  };
}

export function useAiChat(): UseAiChatReturn {
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [previousResponseId, setPreviousResponseId] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const activeIdRef = useRef<string | null>(null);
  // Read inside `send` without making it depend on the state value.
  const previousIdRef = useRef<string | null>(null);
  const isMounted = useIsMounted();

  const setPrevious = useCallback((id: string | null) => {
    previousIdRef.current = id;
    setPreviousResponseId(id);
  }, []);

  const patch = useCallback(
    (id: string, update: (message: AiChatMessage) => Partial<AiChatMessage>) => {
      if (!isMounted()) return;
      setMessages((current) =>
        current.map((message) => (message.id === id ? { ...message, ...update(message) } : message)),
      );
    },
    [isMounted],
  );

  // Abort an in-flight request when the page unmounts.
  useEffect(() => () => controllerRef.current?.abort(), []);

  const stop = useCallback(() => {
    const controller = controllerRef.current;
    const id = activeIdRef.current;
    if (!controller || !id) return;
    controller.abort();
    controllerRef.current = null;
    activeIdRef.current = null;
    patch(id, (message) => (message.status === 'streaming' ? { status: 'stopped' } : {}));
    if (isMounted()) setIsStreaming(false);
  }, [patch, isMounted]);

  const send = useCallback(
    async (prompt: string, options: AiChatRequestOptions = {}, attachments: AiChatAttachment[] = []) => {
      const text = prompt.trim();
      if (!text || controllerRef.current) return;

      const { stream = true, ...rest } = options;
      const request: AiResponseRequest = {
        ...rest,
        input: chatTurnInput(text, attachments),
        ...(previousIdRef.current ? { previousResponseId: previousIdRef.current } : {}),
      };

      const userId = nextId('user');
      const assistantId = nextId('assistant');
      const controller = new AbortController();
      controllerRef.current = controller;
      activeIdRef.current = assistantId;

      setMessages((current) => [
        ...current,
        {
          id: userId,
          role: 'user',
          text,
          status: 'done',
          ...(attachments.length > 0 ? { attachments } : {}),
        },
        { id: assistantId, role: 'assistant', text: '', status: 'streaming', model: rest.model },
      ]);
      setIsStreaming(true);

      // True once this turn has been stopped (or superseded) — drop anything late.
      const stale = () => controller.signal.aborted || controllerRef.current !== controller;
      let failed = false;

      try {
        let completed: AiResponse | null;
        if (stream) {
          completed = await streamAiResponse(
            request,
            {
              onTextDelta: (delta) => {
                if (!stale()) patch(assistantId, (m) => ({ text: m.text + delta }));
              },
              onReasoningDelta: (delta) => {
                if (!stale()) patch(assistantId, (m) => ({ reasoning: (m.reasoning ?? '') + delta }));
              },
              onError: (code, message) => {
                if (stale()) return;
                failed = true;
                patch(assistantId, () => ({ status: 'error', error: { code, message } }));
              },
            },
            controller.signal,
          );
        } else {
          completed = await createAiResponse(request);
        }

        if (stale() || failed) return;

        if (completed) {
          const final = completed;
          patch(assistantId, (m) => ({
            ...fromResponse(final),
            // Keep what streamed if the final frame's text is empty.
            text: final.outputText || m.text,
            status: 'done',
          }));
          if (isMounted()) setPrevious(final.id);
        } else {
          patch(assistantId, () => ({
            status: 'error',
            error: { code: null, message: 'The response ended before it completed.' },
          }));
        }
      } catch (err) {
        if (!stale()) {
          patch(assistantId, () => ({
            status: 'error',
            error: withAttachmentContext(toAiErrorInfo(err, 'The request failed'), attachments.length > 0),
          }));
        }
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
          activeIdRef.current = null;
          if (isMounted()) setIsStreaming(false);
        }
      }
    },
    [patch, isMounted, setPrevious],
  );

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    activeIdRef.current = null;
    setMessages([]);
    setIsStreaming(false);
    setPrevious(null);
  }, [setPrevious]);

  const appendExchange = useCallback(
    (prompt: string, response: AiResponse, extra: { runId?: string; attachments?: AiChatAttachment[] } = {}) => {
      setMessages((current) => [
        ...current,
        {
          id: nextId('user'),
          role: 'user',
          text: prompt,
          status: 'done',
          ...(extra.attachments?.length ? { attachments: extra.attachments } : {}),
        },
        {
          id: nextId('assistant'),
          role: 'assistant',
          status: 'done',
          ...fromResponse(response),
          text: response.outputText,
          runId: extra.runId,
        },
      ]);
      setPrevious(response.id);
    },
    [setPrevious],
  );

  return { messages, isStreaming, previousResponseId, send, stop, reset, appendExchange };
}
