/**
 * AI Playground (`/ai`) — issue #434, epic #419.
 *
 * The template's copyable reference for consuming AI from the browser, and a
 * user's way to prove their setup works end to end: pick a usable model, chat
 * with it token by token, stop it, and see what each turn cost.
 *
 * LAYOUT. A settings panel beside the chat from `sm` up; below `sm` the panel
 * stacks above the chat and collapses behind a "Settings" toggle. The compact
 * switch is `down('sm')` — the same boundary as CLAUDE.md's five coupled
 * breakpoint gates, none of which this page changes.
 *
 * CONTROLS FOLLOW THE MODEL. Each control is shown only when the selected
 * model declares the capability it needs, so a request can never carry an
 * option the model would reject with `AI_CAPABILITY_UNSUPPORTED`.
 *
 * The page re-checks `ai:use` itself after its hooks, like every settings
 * page: the route's `RequirePermission` is the real gate, and this is defence
 * in depth for a render reached some other way.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Collapse,
  Container,
  Divider,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  Add as AddIcon,
  Send as SendIcon,
  Stop as StopIcon,
  Tune as TuneIcon,
} from '@mui/icons-material';
import { Link as RouterLink, Navigate } from 'react-router-dom';
import { usePermissions } from '../hooks/usePermissions';
import { useUserSettings } from '../hooks/useUserSettings';
import type { UserSettings } from '../types';
import { useAiChat, type AiChatRequestOptions } from '../hooks/useAiChat';
import { useAiRun } from '../hooks/useAiRun';
import { useAiConfig } from '../hooks/useAiConfig';
import { ApiError } from '../services/api';
import { listUsableAiModels, type AiResponseRequest, type UsableAiModel } from '../services/ai';
import { useIsMounted } from '../hooks/useIsMounted';
import {
  AiModelSelect,
  aiModelDisabledReason,
  aiModelKey,
  hasAiCapability,
} from '../components/ai/AiModelSelect';
import { AiChatThread } from '../components/ai/AiChatThread';
import { AI_KEYS_PATH } from '../components/ai/AiErrorAlert';
import { AiRunCard } from '../components/ai/AiRunCard';
import {
  AI_SCHEMA_PRESETS,
  CUSTOM_SCHEMA_ID,
  CUSTOM_SCHEMA_NAME,
  formatSchema,
  parseJsonSchemaText,
} from '../components/ai/aiSchemaPresets';

type ReasoningEffort = NonNullable<NonNullable<AiResponseRequest['reasoning']>['effort']>;
const REASONING_EFFORTS: ReasoningEffort[] = ['minimal', 'low', 'medium', 'high'];

interface PlaygroundControls {
  instructions: string;
  /** Blank = the provider's default. */
  maxOutputTokens: string;
  /** Blank = the provider's default. */
  temperature: string;
  /** '' = let the model decide. */
  reasoningEffort: ReasoningEffort | '';
  reasoningSummary: boolean;
  structured: boolean;
  schemaPreset: string;
  schemaText: string;
  /** Send as a background run (`POST /ai/runs`) instead of streaming. */
  background: boolean;
}

const INITIAL_CONTROLS: PlaygroundControls = {
  instructions: '',
  maxOutputTokens: '',
  temperature: '',
  reasoningEffort: '',
  reasoningSummary: true,
  structured: false,
  schemaPreset: AI_SCHEMA_PRESETS[0].id,
  schemaText: formatSchema(AI_SCHEMA_PRESETS[0].jsonSchema),
  background: false,
};

function useUsableModels() {
  const [models, setModels] = useState<UsableAiModel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  useEffect(() => {
    void (async () => {
      try {
        const data = await listUsableAiModels();
        if (isMounted()) setModels(data);
      } catch (err) {
        if (isMounted()) {
          setError(err instanceof ApiError ? err.message : 'Failed to load available models');
        }
      } finally {
        if (isMounted()) setIsLoading(false);
      }
    })();
  }, [isMounted]);

  return { models, isLoading, error };
}

/** An empty composer, or one still holding a preset's example, may be replaced by another example. */
function isUntouchedPrompt(prompt: string): boolean {
  return prompt.trim() === '' || AI_SCHEMA_PRESETS.some((preset) => preset.examplePrompt === prompt);
}

/** Parse an optional positive integer field; `undefined` when blank, `null` when invalid. */
function parseTokens(value: string, max?: number): number | undefined | null {
  if (value.trim() === '') return undefined;
  if (!/^\d+$/.test(value.trim())) return null;
  const n = Number(value);
  if (n < 1 || (max !== undefined && n > max)) return null;
  return n;
}

/** Parse an optional temperature in [0, 2]; `undefined` when blank, `null` when invalid. */
function parseTemperature(value: string): number | undefined | null {
  if (value.trim() === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 2) return null;
  return n;
}

export default function AiPlaygroundPage() {
  const { hasPermission } = usePermissions();
  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down('sm'));
  const settingsPanelId = useId();

  const { models, isLoading: modelsLoading, error: modelsError } = useUsableModels();
  const { settings, isLoading: settingsLoading } = useUserSettings({ syncTheme: false });
  const chat = useAiChat();
  const { config: aiConfig } = useAiConfig();
  const backgroundAllowed = aiConfig.allowBackgroundRuns !== false;
  // The prompt of the current background run, for its card and for the thread.
  const [runPrompt, setRunPrompt] = useState('');
  const runPromptRef = useRef('');
  const { appendExchange } = chat;
  const run = useAiRun({
    onSettled: (settled) => {
      if (settled.status === 'succeeded' && settled.output) {
        appendExchange(runPromptRef.current, settled.output, { runId: settled.id });
      }
    },
  });

  const [modelKey, setModelKey] = useState('');
  const [controls, setControls] = useState<PlaygroundControls>(INITIAL_CONTROLS);
  const [prompt, setPrompt] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const pickable = useMemo(() => models.filter((model) => aiModelDisabledReason(model) === null), [models]);
  const selected = models.find((model) => aiModelKey(model) === modelKey) ?? null;

  // Default selection: the user's saved default when it is usable here, else the first pickable model.
  useEffect(() => {
    if (modelKey || modelsLoading || settingsLoading || pickable.length === 0) return;
    // `user_settings.ai.defaultModel` (docs/specs/ai-platform.md §2), typed
    // by `UserSettings['ai']` (#430).
    const preferred: NonNullable<UserSettings['ai']>['defaultModel'] = settings?.ai?.defaultModel;
    const match = preferred ? pickable.find((model) => aiModelKey(model) === aiModelKey(preferred)) : undefined;
    setModelKey(aiModelKey(match ?? pickable[0]));
  }, [modelKey, modelsLoading, settingsLoading, pickable, settings]);

  const supportsReasoning = hasAiCapability(selected, 'reasoning');
  const supportsStructured = hasAiCapability(selected, 'structured_output');
  const efforts = (selected?.capabilities.reasoningEfforts ?? REASONING_EFFORTS).filter(
    (effort): effort is ReasoningEffort => (REASONING_EFFORTS as string[]).includes(effort),
  );
  const structuredOn = supportsStructured && controls.structured;
  const schema = structuredOn ? parseJsonSchemaText(controls.schemaText) : null;
  const schemaName =
    AI_SCHEMA_PRESETS.find((preset) => preset.id === controls.schemaPreset)?.name ?? CUSTOM_SCHEMA_NAME;
  const maxTokensCap = selected?.capabilities.maxOutputTokens;
  const maxTokens = parseTokens(controls.maxOutputTokens, maxTokensCap);
  const temperature = parseTemperature(controls.temperature);

  const controlsValid =
    maxTokens !== null && (supportsReasoning || temperature !== null) && (schema === null || schema.ok);

  const update = <K extends keyof PlaygroundControls>(key: K, value: PlaygroundControls[K]) =>
    setControls((current) => ({ ...current, [key]: value }));

  // A stateless provider (#446) cannot continue by `previousResponseId`; the
  // turn resends the conversation instead. Unknown to the config: chain.
  const chainResponses =
    !selected ||
    aiConfig.providers.find((provider) => provider.id === selected.provider)?.supportsPreviousResponseId !== false;

  const buildOptions = useCallback((): AiChatRequestOptions | null => {
    if (!selected || !controlsValid) return null;
    const options: AiChatRequestOptions = {
      provider: selected.provider,
      model: selected.modelId,
      stream: hasAiCapability(selected, 'streaming'),
      chainResponses,
    };
    if (controls.instructions.trim()) options.instructions = controls.instructions.trim();
    if (typeof maxTokens === 'number') options.maxOutputTokens = maxTokens;
    // Reasoning models reject sampling temperature, so it is only sent to the others.
    if (!supportsReasoning && typeof temperature === 'number') options.temperature = temperature;
    if (supportsReasoning) {
      const effort = controls.reasoningEffort && efforts.includes(controls.reasoningEffort) ? controls.reasoningEffort : undefined;
      const summary = controls.reasoningSummary ? ('auto' as const) : undefined;
      if (effort || summary) options.reasoning = { ...(effort ? { effort } : {}), ...(summary ? { summary } : {}) };
    }
    if (schema?.ok) options.structuredOutput = { name: schemaName, jsonSchema: schema.schema, strict: true };
    return options;
  }, [selected, controlsValid, chainResponses, controls, maxTokens, supportsReasoning, temperature, efforts, schema, schemaName]);

  const choosePreset = (id: string) => {
    const preset = AI_SCHEMA_PRESETS.find((entry) => entry.id === id);
    setControls((current) => ({
      ...current,
      schemaPreset: id,
      schemaText: preset ? formatSchema(preset.jsonSchema) : current.schemaText,
    }));
    if (preset && isUntouchedPrompt(prompt)) setPrompt(preset.examplePrompt);
  };

  const busy = chat.isStreaming || run.isActive;
  const canSend = !!selected && controlsValid && prompt.trim() !== '' && !busy;
  const useBackground = backgroundAllowed && controls.background;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const options = buildOptions();
    if (!canSend || !options) return;
    const text = prompt.trim();
    setPrompt('');
    if (useBackground) {
      // A run is not streamed; it answers once, through polling.
      const { stream: _unused, chainResponses: chain, ...request } = options;
      runPromptRef.current = text;
      setRunPrompt(text);
      void run.start(
        chain === false
          ? { ...request, input: chat.historyInput(text) }
          : {
              ...request,
              input: text,
              ...(chat.previousResponseId ? { previousResponseId: chat.previousResponseId } : {}),
            },
      );
      return;
    }
    void chat.send(text, options);
  };

  const startNewConversation = () => {
    chat.reset();
    if (!run.isActive) {
      run.clear();
      setRunPrompt('');
    }
  };

  const onPromptKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  if (!hasPermission('ai:use')) {
    return <Navigate to="/" replace />;
  }

  const settingsContent = selected && (
    <Stack spacing={2}>
      <AiModelSelect
        models={models}
        value={modelKey}
        onChange={setModelKey}
        disabled={busy}
      />
      <TextField
        label="Instructions"
        placeholder="Optional system instructions"
        size="small"
        multiline
        minRows={2}
        maxRows={6}
        value={controls.instructions}
        onChange={(event) => update('instructions', event.target.value)}
      />
      <TextField
        label="Max output tokens"
        size="small"
        value={controls.maxOutputTokens}
        onChange={(event) => update('maxOutputTokens', event.target.value)}
        error={maxTokens === null}
        helperText={
          maxTokens === null
            ? `Enter a whole number${maxTokensCap ? ` from 1 to ${maxTokensCap}` : ' of at least 1'}`
            : 'Blank uses the provider default'
        }
        slotProps={{ htmlInput: { inputMode: 'numeric' } }}
      />
      {!supportsReasoning && (
        <TextField
          label="Temperature"
          size="small"
          value={controls.temperature}
          onChange={(event) => update('temperature', event.target.value)}
          error={temperature === null}
          helperText={temperature === null ? 'Enter a number from 0 to 2' : 'Blank uses the provider default'}
          slotProps={{ htmlInput: { inputMode: 'decimal' } }}
        />
      )}
      {supportsReasoning && (
        <>
          <TextField
            select
            label="Reasoning effort"
            size="small"
            value={controls.reasoningEffort}
            onChange={(event) => update('reasoningEffort', event.target.value as ReasoningEffort | '')}
          >
            <MenuItem value="">Model default</MenuItem>
            {efforts.map((effort) => (
              <MenuItem key={effort} value={effort}>
                {effort.charAt(0).toUpperCase() + effort.slice(1)}
              </MenuItem>
            ))}
          </TextField>
          <FormControlLabel
            control={
              <Switch
                checked={controls.reasoningSummary}
                onChange={(event) => update('reasoningSummary', event.target.checked)}
              />
            }
            label="Show reasoning summary"
          />
        </>
      )}
      {supportsStructured && (
        <>
          <FormControlLabel
            control={
              <Switch
                checked={controls.structured}
                onChange={(event) => {
                  update('structured', event.target.checked);
                  if (event.target.checked) choosePreset(controls.schemaPreset);
                }}
              />
            }
            label="Structured output"
          />
          {controls.structured && (
            <>
              <TextField
                select
                label="Schema"
                size="small"
                value={controls.schemaPreset}
                onChange={(event) => choosePreset(event.target.value)}
              >
                {AI_SCHEMA_PRESETS.map((preset) => (
                  <MenuItem key={preset.id} value={preset.id}>
                    {preset.label}
                  </MenuItem>
                ))}
                <MenuItem value={CUSTOM_SCHEMA_ID}>Custom JSON Schema</MenuItem>
              </TextField>
              <TextField
                label="JSON Schema"
                multiline
                minRows={6}
                maxRows={16}
                value={controls.schemaText}
                onChange={(event) =>
                  setControls((current) => ({
                    ...current,
                    schemaText: event.target.value,
                    schemaPreset: CUSTOM_SCHEMA_ID,
                  }))
                }
                error={schema !== null && !schema.ok}
                helperText={schema !== null && !schema.ok ? schema.error : 'Sent with strict: true'}
                slotProps={{
                  htmlInput: { spellCheck: false, style: { fontFamily: 'monospace', fontSize: '0.8125rem' } },
                }}
              />
            </>
          )}
        </>
      )}
      {backgroundAllowed && (
        <FormControlLabel
          control={
            <Switch
              checked={controls.background}
              onChange={(event) => update('background', event.target.checked)}
            />
          }
          label="Run in background"
        />
      )}
    </Stack>
  );

  const noPickableModels = !modelsLoading && !modelsError && pickable.length === 0;

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 2, md: 3 }, px: { xs: 2, sm: 3 } }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: { xs: 'flex-start', sm: 'center' },
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1,
          mb: 2,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h4" component="h1">
            AI Playground
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Try prompts against the models available to you.
          </Typography>
        </Box>
        <Button
          startIcon={<AddIcon />}
          onClick={startNewConversation}
          disabled={chat.messages.length === 0 || run.isActive}
        >
          New conversation
        </Button>
      </Box>

      {modelsLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress aria-label="Loading models" />
        </Box>
      )}

      {modelsError && <Alert severity="error">{modelsError}</Alert>}

      {noPickableModels && (
        <Alert
          severity="info"
          action={
            <Button component={RouterLink} to={AI_KEYS_PATH} color="inherit" size="small">
              Manage API keys
            </Button>
          }
        >
          {models.length === 0
            ? 'No models are available to you yet. Add an API key for an enabled provider to start using the playground.'
            : 'None of the models available to you can answer text prompts. Add an API key that can reach a text model.'}
        </Alert>
      )}

      {selected && (
        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            alignItems: { xs: 'stretch', sm: 'flex-start' },
            gap: 2,
            minWidth: 0,
          }}
        >
          <Paper
            component="aside"
            variant="outlined"
            aria-label="Playground settings"
            sx={{ width: { xs: '100%', sm: 260, md: 320 }, flexShrink: 0, p: 2, minWidth: 0 }}
          >
            {isCompact ? (
              <>
                <Button
                  fullWidth
                  startIcon={<TuneIcon />}
                  onClick={() => setSettingsOpen((open) => !open)}
                  aria-expanded={settingsOpen}
                  aria-controls={settingsPanelId}
                  sx={{ justifyContent: 'flex-start' }}
                >
                  Settings
                </Button>
                <Collapse in={settingsOpen} id={settingsPanelId}>
                  <Box sx={{ pt: 2 }}>{settingsContent}</Box>
                </Collapse>
              </>
            ) : (
              <Box id={settingsPanelId}>{settingsContent}</Box>
            )}
          </Paper>

          <Paper
            component="section"
            variant="outlined"
            aria-label="Chat"
            sx={{ flex: 1, minWidth: 0, p: { xs: 1.5, sm: 2 }, display: 'flex', flexDirection: 'column', gap: 2 }}
          >
            {chat.messages.length === 0 && !runPrompt ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                Send a message to start a conversation.
              </Typography>
            ) : (
              <AiChatThread messages={chat.messages} />
            )}

            {runPrompt && (run.isActive || run.run || run.error) && (
              <AiRunCard
                prompt={runPrompt}
                run={run.run}
                error={run.error}
                isStarting={run.isStarting}
                isCancelling={run.isCancelling}
                onCancel={() => void run.cancel()}
                onDismiss={() => {
                  run.clear();
                  setRunPrompt('');
                }}
              />
            )}

            <Divider />

            <Box component="form" onSubmit={submit} sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <TextField
                label="Message"
                placeholder="Ask something…"
                multiline
                minRows={2}
                maxRows={8}
                fullWidth
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={onPromptKeyDown}
              />
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, flexWrap: 'wrap' }}>
                {chat.isStreaming ? (
                  <Button variant="outlined" color="inherit" startIcon={<StopIcon />} onClick={chat.stop}>
                    Stop
                  </Button>
                ) : (
                  <Button type="submit" variant="contained" endIcon={<SendIcon />} disabled={!canSend}>
                    {useBackground ? 'Start run' : 'Send'}
                  </Button>
                )}
              </Box>
            </Box>
          </Paper>
        </Box>
      )}
    </Container>
  );
}
