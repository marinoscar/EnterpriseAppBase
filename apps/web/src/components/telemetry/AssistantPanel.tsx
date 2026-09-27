/**
 * The Telemetry Explorer's assistant conversation — issue #537, epic #528;
 * the troubleshooting agent — issue #571.
 *
 * A local renderer rather than `AiChatThread`: that thread renders the
 * playground's `AiChatMessage` (text deltas, reasoning, hosted-tool output),
 * while a telemetry turn is an investigation (TOOL STEPS, with the model's
 * interim thoughts) plus one structured answer: an analysed report, or on an
 * older API `{ sql, explanation }`. The look follows `AiChatThread` — user
 * bubbles on the right, outlined assistant cards, a `role="log"` region, plain
 * text only (nothing the model says is interpreted as HTML).
 */
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { Alert, Box, Button, Chip, Paper, Stack, TextField, Typography } from '@mui/material';
import StopIcon from '@mui/icons-material/Stop';
import SendIcon from '@mui/icons-material/Send';
import {
  ASSISTANT_QUESTION_MAX,
  type AssistantMessage,
  type AssistantReplyMessage,
} from '../../hooks/useTelemetryAssistant';
import { AssistantTimeline } from './AssistantTimeline';
import { LegacyAnswer, ReportCard } from './AssistantReport';

export const ASSISTANT_EXAMPLE_PROMPTS = [
  'Are there any errors in the last hour?',
  'Why is the API slow?',
  'Is telemetry being ingested correctly?',
] as const;

function Reply({
  message,
  onInsert,
  onInsertAndRun,
}: {
  message: AssistantReplyMessage;
  onInsert: (sql: string) => void;
  onInsertAndRun: (sql: string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const hasAnswer = message.answer !== null;

  // When the report lands, bring its top into view (not the bottom of a long
  // report) — on a phone the summary is what matters first.
  useEffect(() => {
    if (hasAnswer) ref.current?.scrollIntoView?.({ block: 'start' });
  }, [hasAnswer]);

  const answer = message.answer;
  return (
    <Paper
      ref={ref}
      variant="outlined"
      data-testid="assistant-reply"
      data-status={message.status}
      aria-busy={message.status === 'streaming'}
      sx={{ px: 1.5, py: 1, minWidth: 0, overflowWrap: 'anywhere' }}
    >
      <AssistantTimeline
        steps={message.steps}
        isInvestigating={message.status === 'streaming' && !answer}
        collapsible={hasAnswer}
      />
      {answer && (
        <Box sx={{ mt: message.steps.length > 0 ? 0.5 : 0 }}>
          {answer.report ? (
            <ReportCard report={answer.report} onInsert={onInsert} onInsertAndRun={onInsertAndRun} />
          ) : (
            <LegacyAnswer answer={answer} onInsert={onInsert} onInsertAndRun={onInsertAndRun} />
          )}
        </Box>
      )}
      {message.error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {message.error.message}
          {message.error.code && (
            <Typography variant="caption" component="div">
              {message.error.code}
            </Typography>
          )}
        </Alert>
      )}
      {message.status === 'stopped' && <Chip size="small" label="Stopped" sx={{ mt: 1 }} />}
    </Paper>
  );
}

function EmptyState({ disabled, onAsk }: { disabled: boolean; onAsk: (question: string) => void }) {
  return (
    <Box>
      <Typography variant="body2" color="text.secondary">
        Describe a problem or ask a question. The assistant investigates on its own — it checks the
        app&apos;s configuration, overall health, errors and traces by running read-only queries —
        and reports what it found, the likely cause and what to do next.
      </Typography>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', mt: 1.5 }}>
        {ASSISTANT_EXAMPLE_PROMPTS.map((prompt) => (
          <Chip
            key={prompt}
            label={prompt}
            variant="outlined"
            clickable
            disabled={disabled}
            onClick={() => onAsk(prompt)}
            sx={{ maxWidth: '100%', height: 'auto', '& .MuiChip-label': { whiteSpace: 'normal', py: 0.5 } }}
          />
        ))}
      </Stack>
    </Box>
  );
}

export interface AssistantPanelProps {
  messages: AssistantMessage[];
  isStreaming: boolean;
  onAsk: (question: string) => void;
  onStop: () => void;
  onInsert: (sql: string) => void;
  onInsertAndRun: (sql: string) => void;
  /** e.g. `openai · gpt-5-mini`, when the viewer may read the settings. */
  modelCaption?: string | null;
}

export function AssistantPanel({
  messages,
  isStreaming,
  onAsk,
  onStop,
  onInsert,
  onInsertAndRun,
  modelCaption,
}: AssistantPanelProps) {
  const [question, setQuestion] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);
  const last = messages[messages.length - 1];

  // Follow the investigation as it streams; once a reply has its answer, that
  // reply scrolls its own top into view instead.
  useEffect(() => {
    if (last?.role === 'assistant' && last.answer) return;
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length, last]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!question.trim() || isStreaming) return;
    onAsk(question);
    setQuestion('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {modelCaption && (
        <Typography variant="caption" color="text.secondary" sx={{ mb: 1 }} data-testid="assistant-model">
          {modelCaption}
        </Typography>
      )}
      <Box
        role="log"
        aria-label="Assistant conversation"
        aria-live="polite"
        sx={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
          minHeight: 0,
          minWidth: 0,
          pb: 1,
        }}
      >
        {messages.length === 0 && <EmptyState disabled={isStreaming} onAsk={onAsk} />}
        {messages.map((message) =>
          message.role === 'user' ? (
            <Paper
              key={message.id}
              elevation={0}
              data-testid="assistant-question"
              sx={{
                alignSelf: 'flex-end',
                maxWidth: '90%',
                px: 1.5,
                py: 1,
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {message.text}
            </Paper>
          ) : (
            <Reply
              key={message.id}
              message={message}
              onInsert={onInsert}
              onInsertAndRun={onInsertAndRun}
            />
          ),
        )}
        <div ref={endRef} />
      </Box>
      <Box component="form" onSubmit={submit} sx={{ pt: 1, display: 'flex', gap: 1, alignItems: 'flex-end' }}>
        <TextField
          fullWidth
          multiline
          maxRows={6}
          size="small"
          placeholder="Describe a problem or ask a question…"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={onKeyDown}
          slotProps={{ htmlInput: { 'aria-label': 'Ask the assistant', maxLength: ASSISTANT_QUESTION_MAX } }}
        />
        {isStreaming ? (
          <Button variant="outlined" color="inherit" onClick={onStop} startIcon={<StopIcon />}>
            Stop
          </Button>
        ) : (
          <Button type="submit" variant="contained" disabled={!question.trim()} startIcon={<SendIcon />}>
            Ask
          </Button>
        )}
      </Box>
    </Box>
  );
}
