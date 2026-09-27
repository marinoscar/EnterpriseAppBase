/**
 * The Telemetry Explorer's assistant conversation — issue #537, epic #528.
 *
 * A local renderer rather than `AiChatThread`: that thread renders the
 * playground's `AiChatMessage` (text deltas, reasoning, hosted-tool output),
 * while a telemetry turn is a list of TOOL STEPS plus one structured answer
 * (`{ sql, explanation }`). The look follows `AiChatThread` — user bubbles on
 * the right, outlined assistant cards, a `role="log"` region, plain text only
 * (nothing the model says is interpreted as HTML).
 */
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import StopIcon from '@mui/icons-material/Stop';
import SendIcon from '@mui/icons-material/Send';
import type { TelemetryAssistantStep } from '../../services/telemetry';
import {
  ASSISTANT_QUESTION_MAX,
  type AssistantMessage,
  type AssistantReplyMessage,
} from '../../hooks/useTelemetryAssistant';

const TOOL_LABELS: Record<string, string> = {
  list_tables: 'Listed tables',
  describe_table: 'Described table',
  run_query: 'Ran query',
};

function StepRow({ step }: { step: TelemetryAssistantStep }) {
  const label = TOOL_LABELS[step.tool] ?? step.tool;
  const facts: string[] = [];
  if (step.rowCount !== undefined) facts.push(`${step.rowCount} row${step.rowCount === 1 ? '' : 's'}`);
  if (step.truncated) facts.push('truncated');
  facts.push(`${Math.round(step.durationMs)} ms`);

  return (
    <Box data-testid="assistant-step" sx={{ py: 0.5 }}>
      <Typography variant="caption" component="div" color={step.error ? 'error' : 'text.secondary'}>
        <strong>{label}</strong>
        {step.input?.table ? ` ${step.input.table}` : ''} · {facts.join(' · ')}
      </Typography>
      {step.input?.sql && (
        <Box
          component="pre"
          sx={{
            m: 0,
            mt: 0.25,
            p: 0.75,
            borderRadius: 1,
            bgcolor: 'action.hover',
            fontFamily: 'monospace',
            fontSize: 11,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 120,
            overflow: 'auto',
          }}
        >
          {step.input.sql}
        </Box>
      )}
      {step.error && (
        <Typography variant="caption" component="div" color="error">
          {step.error}
        </Typography>
      )}
    </Box>
  );
}

function Reply({
  message,
  onInsert,
  onInsertAndRun,
}: {
  message: AssistantReplyMessage;
  onInsert: (sql: string) => void;
  onInsertAndRun: (sql: string) => void;
}) {
  return (
    <Paper
      variant="outlined"
      data-testid="assistant-reply"
      data-status={message.status}
      aria-busy={message.status === 'streaming'}
      sx={{ px: 1.5, py: 1, minWidth: 0 }}
    >
      {message.steps.length > 0 && (
        <Box sx={{ mb: message.answer ? 1 : 0 }}>
          {message.steps.map((step) => (
            <StepRow key={`${step.index}-${step.tool}`} step={step} />
          ))}
        </Box>
      )}
      {message.status === 'streaming' && !message.answer && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <CircularProgress size={14} />
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            Thinking…
          </Typography>
        </Stack>
      )}
      {message.answer && (
        <>
          <Typography
            variant="body2"
            component="div"
            data-testid="assistant-explanation"
            sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
          >
            {message.answer.explanation}
          </Typography>
          {message.answer.sql && (
            <>
              <Box
                component="pre"
                data-testid="assistant-sql"
                sx={{
                  m: 0,
                  mt: 1,
                  p: 1,
                  borderRadius: 1,
                  bgcolor: 'action.hover',
                  fontFamily: 'monospace',
                  fontSize: 12,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {message.answer.sql}
              </Box>
              <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 1, flexWrap: 'wrap' }}>
                <Button size="small" onClick={() => onInsert(message.answer!.sql!)}>
                  Insert into editor
                </Button>
                <Button size="small" variant="outlined" onClick={() => onInsertAndRun(message.answer!.sql!)}>
                  Insert &amp; run
                </Button>
              </Stack>
            </>
          )}
        </>
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

  useEffect(() => {
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
        sx={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1.5, minHeight: 0, pb: 1 }}
      >
        {messages.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Ask a question about your traces, logs or metrics — for example “which endpoints were
            slowest in the last hour?”. The assistant writes read-only SQL, runs it to check, and
            puts the final query in the editor.
          </Typography>
        )}
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
          placeholder="Ask about your telemetry…"
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
