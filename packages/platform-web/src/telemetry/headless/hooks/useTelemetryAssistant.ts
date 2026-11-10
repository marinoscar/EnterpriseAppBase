/**
 * The Telemetry Explorer's AI assistant conversation — issue #537, epic #528.
 *
 * Streams `POST /admin/telemetry/assistant/stream` (#536) through
 * `streamTelemetryAssistant` (`postSse`). The browser never talks to a model:
 * the API resolves the provider, the key and every tool call server-side and
 * reports each tool step and the final answer as SSE frames.
 *
 * The last {@link ASSISTANT_HISTORY_TURNS} turns (a question and its answer
 * each) are sent back as `history`, so a follow-up ("now only for the api
 * service") has context. `stop()` aborts the stream; `clear()` aborts it and
 * forgets the conversation (the panel's "New chat", issue #574), so the next
 * question is sent with no `history`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type TelemetryAssistantAnswer,
  type TelemetryAssistantReport,
  type TelemetryAssistantStep,
  type TelemetryAssistantTurn,
} from '../services/telemetry.js';
import { toTelemetryError } from './useTelemetryExplorer.js';
import { useTelemetryClient } from '../services/client.js';
import { useIsMounted } from '../../internal/useIsMounted.js';

/**
 * How many earlier answered turns are replayed to the model as history.
 *
 * @stability experimental
 */
export const ASSISTANT_HISTORY_TURNS = 10;
/**
 * The longest question sent, in characters (the API's own limit).
 *
 * @stability experimental
 */
export const ASSISTANT_QUESTION_MAX = 4000;

/**
 * A question the viewer asked, as the assistant panel lists it.
 *
 * @stability experimental
 */
export interface AssistantUserMessage {
  /** A stable id within the conversation. */
  id: string;
  /** The viewer's turn. */
  role: 'user';
  /** The question as sent. */
  text: string;
}

/**
 * The assistant's reply to one question: its tool steps, its answer and how it ended.
 *
 * @stability experimental
 */
export interface AssistantReplyMessage {
  /** A stable id within the conversation. */
  id: string;
  /** The assistant's turn. */
  role: 'assistant';
  /** How the turn stands: still streaming, answered, failed or stopped by the viewer. */
  status: 'streaming' | 'done' | 'error' | 'stopped';
  /** The tool steps so far, in order. */
  steps: TelemetryAssistantStep[];
  /** The final answer, or `null` until it arrives. */
  answer: TelemetryAssistantAnswer | null;
  /** Why the turn failed, or `null`. */
  error: AssistantReplyError | null;
}

/**
 * Why an assistant turn failed.
 *
 * @stability experimental
 */
export interface AssistantReplyError {
  /** The reason or envelope code (`TELEMETRY_ASSISTANT_DISABLED`, `AI_DISABLED`, ...), or `null`. */
  code: string | null;
  /** What to show. */
  message: string;
}

/**
 * What {@link useTelemetryAssistant} returns.
 *
 * @stability experimental
 */
export interface UseTelemetryAssistantReturn {
  /** The conversation, oldest first. */
  messages: AssistantMessage[];
  /** A turn is streaming. */
  isStreaming: boolean;
  /** Ask a question (ignored while a turn streams or when it is blank). */
  ask: (question: string) => Promise<void>;
  /** Stop the turn in flight. */
  stop: () => void;
  /** Stop and forget the conversation. */
  clear: () => void;
}

/**
 * One entry of the assistant conversation.
 *
 * @stability experimental
 */
export type AssistantMessage = AssistantUserMessage | AssistantReplyMessage;

/**
 * Upper bound on one replayed answer, so a long report cannot crowd out the question.
 *
 * @stability experimental
 */
export const ASSISTANT_HISTORY_ANSWER_MAX = 6000;

function reportAsHistory(report: TelemetryAssistantReport): string {
  const lines: string[] = [`Status: ${report.status} (confidence ${report.confidence})`, `Summary: ${report.summary}`];
  if (report.findings.length) {
    lines.push('Findings:');
    for (const finding of report.findings) lines.push(`- [${finding.severity}] ${finding.title}`);
  }
  if (report.rootCause) lines.push(`Root cause: ${report.rootCause}`);
  if (report.recommendations.length) {
    lines.push('Recommendations:');
    report.recommendations.forEach((item, i) => lines.push(`${i + 1}. ${item}`));
  }
  const firstSql = report.queries[0]?.sql;
  if (firstSql) lines.push('', 'SQL:', firstSql);
  return lines.join('\n');
}

/**
 * How an answered turn is replayed to the model as history: a compact report
 * (status, summary, finding titles, root cause, recommendations, first query)
 * bounded to {@link ASSISTANT_HISTORY_ANSWER_MAX}; a legacy answer unchanged.
 *
 * @stability experimental
 */
export function answerAsHistory(answer: TelemetryAssistantAnswer): string {
  if (answer.report) {
    const text = reportAsHistory(answer.report);
    return text.length > ASSISTANT_HISTORY_ANSWER_MAX
      ? `${text.slice(0, ASSISTANT_HISTORY_ANSWER_MAX - 1)}…`
      : text;
  }
  return answer.sql ? `${answer.explanation}\n\nSQL:\n${answer.sql}` : answer.explanation;
}

/**
 * The `history` for the next question: completed turns only (a question whose
 * answer failed is dropped with it), the last {@link ASSISTANT_HISTORY_TURNS}.
 *
 * @stability experimental
 */
export function buildAssistantHistory(messages: AssistantMessage[]): TelemetryAssistantTurn[] {
  const turns: TelemetryAssistantTurn[][] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i]!;
    const next = messages[i + 1];
    if (message.role === 'user' && next?.role === 'assistant' && next.answer) {
      turns.push([
        { role: 'user', content: message.text },
        { role: 'assistant', content: answerAsHistory(next.answer) },
      ]);
      i += 1;
    }
  }
  return turns.slice(-ASSISTANT_HISTORY_TURNS).flat();
}

let sequence = 0;
function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}`;
}

/**
 * What {@link useTelemetryAssistant} takes.
 *
 * @stability experimental
 */
export interface UseTelemetryAssistantOptions {
  /** Called once per turn when the final answer arrives. */
  onAnswer?: (answer: TelemetryAssistantAnswer) => void;
}

/**
 * The troubleshooting assistant's conversation: `ask` streams one turn (`POST /admin/telemetry/assistant/stream`) with the earlier answered turns as history; `stop` aborts it; `clear` forgets the conversation. The browser never talks to a model.
 *
 * @param options - an optional `onAnswer` callback.
 * @returns `messages`, `isStreaming`, `ask`, `stop` and `clear`.
 * @throws Error outside a `PlatformHostProvider`.
 *
 * @stability experimental
 */
export function useTelemetryAssistant(options: UseTelemetryAssistantOptions = {}): UseTelemetryAssistantReturn {
  const client = useTelemetryClient();
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const onAnswerRef = useRef(options.onAnswer);
  onAnswerRef.current = options.onAnswer;
  const isMounted = useIsMounted();

  useEffect(() => () => controllerRef.current?.abort(), []);

  const patchReply = useCallback(
    (id: string, patch: (reply: AssistantReplyMessage) => AssistantReplyMessage) => {
      if (!isMounted()) return;
      setMessages((prev) =>
        prev.map((message) =>
          message.id === id && message.role === 'assistant' ? patch(message) : message,
        ),
      );
    },
    [isMounted],
  );

  const ask = useCallback(
    async (question: string) => {
      const text = question.trim().slice(0, ASSISTANT_QUESTION_MAX);
      if (!text || controllerRef.current) return;

      const history = buildAssistantHistory(messagesRef.current);
      const replyId = nextId('assistant');
      setMessages((prev) => [
        ...prev,
        { id: nextId('user'), role: 'user', text },
        { id: replyId, role: 'assistant', status: 'streaming', steps: [], answer: null, error: null },
      ]);

      const controller = new AbortController();
      controllerRef.current = controller;
      setIsStreaming(true);

      try {
        await client.streamTelemetryAssistant(
          { question: text, ...(history.length ? { history } : {}) },
          {
            signal: controller.signal,
            onStep: (step) =>
              patchReply(replyId, (reply) => ({ ...reply, steps: [...reply.steps, step] })),
            onAnswer: (answer) => {
              patchReply(replyId, (reply) => ({ ...reply, answer }));
              onAnswerRef.current?.(answer);
            },
            onError: (error) =>
              patchReply(replyId, (reply) => ({ ...reply, status: 'error', error })),
          },
        );
        patchReply(replyId, (reply) => ({
          ...reply,
          status: controller.signal.aborted
            ? 'stopped'
            : reply.status === 'error'
              ? 'error'
              : reply.answer
                ? 'done'
                : 'error',
          error:
            reply.error ??
            (controller.signal.aborted || reply.answer
              ? null
              : { code: null, message: 'The assistant ended without an answer.' }),
        }));
      } catch (err) {
        const info = toTelemetryError(err, 'The assistant request failed');
        patchReply(replyId, (reply) => ({
          ...reply,
          status: 'error',
          error: { code: info.reason ?? info.code, message: info.message },
        }));
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
        if (isMounted()) setIsStreaming(false);
      }
    },
    [client, isMounted, patchReply],
  );

  const stop = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const clear = useCallback(() => {
    controllerRef.current?.abort();
    setMessages([]);
  }, []);

  return { messages, isStreaming, ask, stop, clear };
}
