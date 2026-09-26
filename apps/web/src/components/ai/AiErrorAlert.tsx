/**
 * The ONE place an AI failure becomes words — issue #434, epic #419.
 *
 * Every AI surface renders a failure through this component so an error code
 * reads the same everywhere and always says what to do next. It takes the
 * normalised {@link AiErrorInfo} (`services/aiErrors.ts`), which already
 * resolved the code out of `details.reason`, an SSE `error` frame or a run's
 * `errorCode` — so nothing here has to know which road the failure took.
 *
 * `AI_DISABLED` also asks the shell to re-read `GET /ai/config`: the switch
 * was flipped while this page was open, and a refreshed config is what makes
 * `RequireAiEnabled` and the navigation stop offering AI.
 */
import { useEffect } from 'react';
import { Alert, AlertTitle, Button } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import type { AiErrorInfo } from '../../services/aiErrors';
import { useAiConfig } from '../../hooks/useAiConfig';

/** Where a user fixes their own key. */
export const AI_KEYS_PATH = '/settings/ai';

export interface AiErrorCopy {
  title: string;
  body: string;
  severity: 'error' | 'warning' | 'info';
  action?: { label: string; to: string };
}

/**
 * Code → copy. Exported for surfaces that need the words without the alert
 * (a snackbar, a table cell).
 */
export function aiErrorCopy(error: AiErrorInfo): AiErrorCopy {
  switch (error.code) {
    case 'AI_KEY_REQUIRED':
      return {
        title: 'Add your API key',
        body: 'You need your own API key for this provider before you can use it.',
        severity: 'warning',
        action: { label: 'Add API key', to: AI_KEYS_PATH },
      };
    case 'AI_KEY_INVALID':
      return {
        title: 'Your key was rejected by the provider',
        body: 'The provider did not accept your API key. Replace it with a valid one.',
        severity: 'error',
        action: { label: 'Update API key', to: AI_KEYS_PATH },
      };
    case 'AI_MODEL_NOT_ENABLED':
      return {
        title: "This model isn't available to you",
        body: 'Your administrator has not enabled this model, or it has been retired. Pick another model.',
        severity: 'warning',
      };
    case 'AI_MODEL_NOT_REACHABLE':
      return {
        title: "This model isn't available to you",
        body: 'Your API key cannot reach this model. Pick another model, or use a key with access to it.',
        severity: 'warning',
        action: { label: 'Manage API keys', to: AI_KEYS_PATH },
      };
    case 'AI_RATE_LIMITED': {
      const seconds =
        error.retryAfterMs !== undefined ? Math.max(1, Math.ceil(error.retryAfterMs / 1000)) : null;
      return {
        title: seconds !== null ? `Provider rate limit — retry in ${seconds} s` : 'Provider rate limit — retry shortly',
        body: 'The provider is limiting how fast requests can be made with this key.',
        severity: 'warning',
      };
    }
    case 'AI_DISABLED':
      return {
        title: 'AI is disabled by your administrator',
        body: 'AI features have been switched off for this application.',
        severity: 'info',
      };
    case 'AI_PROVIDER_DISABLED':
      return {
        title: 'This provider is disabled',
        body: 'Your administrator has switched this provider off. Pick a model from another provider.',
        severity: 'warning',
      };
    case 'AI_CAPABILITY_UNSUPPORTED':
      return {
        title: "This model can't do that",
        body: 'The selected model does not support an option in this request. Turn the option off or pick another model.',
        severity: 'warning',
      };
    case 'AI_TOOL_DISABLED':
      return {
        title: "This tool isn't enabled",
        body: 'Your administrator has not switched this tool on for this application. Turn it off in the request and try again.',
        severity: 'warning',
      };
    case 'AI_CONTENT_FILTERED':
      return {
        title: 'Blocked by the content filter',
        body: "The provider's content filter rejected this request or its answer. Rephrase and try again.",
        severity: 'warning',
      };
    case 'AI_PROVIDER_UNAVAILABLE':
      return {
        title: 'The provider is unavailable',
        body: 'The AI provider could not be reached or is having problems. Try again in a moment.',
        severity: 'error',
      };
    case 'AI_STRUCTURED_OUTPUT_INVALID':
      return {
        title: "The answer didn't match the schema",
        body: 'The model returned output that does not satisfy the requested JSON Schema. Try again or simplify the schema.',
        severity: 'error',
      };
    case 'AI_STORAGE_UNAVAILABLE':
      // #437: an operation whose inputs or outputs are storage objects (an
      // image run, and the media modes after it) on a deployment with no
      // usable object storage. Only an administrator can fix it.
      return {
        title: "File storage isn't available",
        body: 'This application has no file storage set up to keep AI inputs and results in. Ask your administrator to configure storage.',
        severity: 'error',
      };
    case 'AI_INVALID_REQUEST':
      return {
        title: 'The request was invalid',
        body: error.message,
        severity: 'error',
      };
    default:
      return {
        title: 'Something went wrong',
        body: error.message,
        severity: 'error',
      };
  }
}

export interface AiErrorAlertProps {
  error: AiErrorInfo;
  onClose?: () => void;
}

export function AiErrorAlert({ error, onClose }: AiErrorAlertProps) {
  const { refresh } = useAiConfig();
  const copy = aiErrorCopy(error);
  const isDisabled = error.code === 'AI_DISABLED';

  useEffect(() => {
    if (isDisabled) void refresh();
    // Once per distinct failure, not on every render of the same one.
  }, [isDisabled, error, refresh]);

  // The server's own message is shown under the copy when it adds something.
  const detail = copy.body !== error.message && error.message ? error.message : null;

  return (
    <Alert
      severity={copy.severity}
      onClose={onClose}
      data-ai-error-code={error.code ?? 'unknown'}
      action={
        copy.action ? (
          <Button component={RouterLink} to={copy.action.to} color="inherit" size="small">
            {copy.action.label}
          </Button>
        ) : undefined
      }
      sx={{ wordBreak: 'break-word' }}
    >
      <AlertTitle>{copy.title}</AlertTitle>
      {copy.body}
      {detail && error.code !== null && (
        <span style={{ display: 'block', marginTop: 4, opacity: 0.8, fontSize: '0.85em' }}>{detail}</span>
      )}
    </Alert>
  );
}

export default AiErrorAlert;
