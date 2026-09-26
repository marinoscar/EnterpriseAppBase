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
import { useCallback, useEffect, useId, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Collapse,
  Container,
  Divider,
  Paper,
  Stack,
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
import { useAiChat, type AiChatRequestOptions } from '../hooks/useAiChat';
import { ApiError } from '../services/api';
import { listUsableAiModels, type UsableAiModel } from '../services/ai';
import { useIsMounted } from '../hooks/useIsMounted';
import {
  AiModelSelect,
  aiModelDisabledReason,
  aiModelKey,
  hasAiCapability,
} from '../components/ai/AiModelSelect';
import { AiChatThread } from '../components/ai/AiChatThread';
import { AI_KEYS_PATH } from '../components/ai/AiErrorAlert';

/**
 * `user_settings.ai.defaultModel` (docs/specs/ai-platform.md §2), read
 * structurally: the typed field is added to `UserSettings` by #430.
 */
interface WithAiDefault {
  ai?: { defaultModel?: { provider: string; modelId: string } | null };
}

interface PlaygroundControls {
  instructions: string;
  /** Blank = the provider's default. */
  maxOutputTokens: string;
  /** Blank = the provider's default. */
  temperature: string;
}

const INITIAL_CONTROLS: PlaygroundControls = {
  instructions: '',
  maxOutputTokens: '',
  temperature: '',
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

  const [modelKey, setModelKey] = useState('');
  const [controls, setControls] = useState<PlaygroundControls>(INITIAL_CONTROLS);
  const [prompt, setPrompt] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const pickable = useMemo(() => models.filter((model) => aiModelDisabledReason(model) === null), [models]);
  const selected = models.find((model) => aiModelKey(model) === modelKey) ?? null;

  // Default selection: the user's saved default when it is usable here, else the first pickable model.
  useEffect(() => {
    if (modelKey || modelsLoading || settingsLoading || pickable.length === 0) return;
    const preferred = (settings as WithAiDefault | null)?.ai?.defaultModel;
    const match = preferred ? pickable.find((model) => aiModelKey(model) === aiModelKey(preferred)) : undefined;
    setModelKey(aiModelKey(match ?? pickable[0]));
  }, [modelKey, modelsLoading, settingsLoading, pickable, settings]);

  const supportsReasoning = hasAiCapability(selected, 'reasoning');
  const maxTokensCap = selected?.capabilities.maxOutputTokens;
  const maxTokens = parseTokens(controls.maxOutputTokens, maxTokensCap);
  const temperature = parseTemperature(controls.temperature);

  const controlsValid = maxTokens !== null && (supportsReasoning || temperature !== null);

  const update = <K extends keyof PlaygroundControls>(key: K, value: PlaygroundControls[K]) =>
    setControls((current) => ({ ...current, [key]: value }));

  const buildOptions = useCallback((): AiChatRequestOptions | null => {
    if (!selected || !controlsValid) return null;
    const options: AiChatRequestOptions = {
      provider: selected.provider,
      model: selected.modelId,
      stream: hasAiCapability(selected, 'streaming'),
    };
    if (controls.instructions.trim()) options.instructions = controls.instructions.trim();
    if (typeof maxTokens === 'number') options.maxOutputTokens = maxTokens;
    // Reasoning models reject sampling temperature, so it is only sent to the others.
    if (!supportsReasoning && typeof temperature === 'number') options.temperature = temperature;
    return options;
  }, [selected, controlsValid, controls, maxTokens, supportsReasoning, temperature]);

  const canSend = !!selected && controlsValid && prompt.trim() !== '' && !chat.isStreaming;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const options = buildOptions();
    if (!canSend || !options) return;
    const text = prompt;
    setPrompt('');
    void chat.send(text, options);
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
        disabled={chat.isStreaming}
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
          onClick={chat.reset}
          disabled={chat.messages.length === 0}
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
            {chat.messages.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                Send a message to start a conversation.
              </Typography>
            ) : (
              <AiChatThread messages={chat.messages} />
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
                    Send
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
