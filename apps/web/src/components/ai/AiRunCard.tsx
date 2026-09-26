/**
 * A background run's status card — issue #434, epic #419.
 *
 * Shows the prompt, the run's status as it is polled, and a Cancel button
 * while the run can still be stopped. A successful run's answer is appended to
 * the conversation by the page; this card only says so. A failed run renders
 * its `errorCode` through the shared {@link AiErrorAlert} mapping.
 */
import { Box, Button, Chip, CircularProgress, Paper, Typography } from '@mui/material';
import type { AiRun, AiRunStatus } from '../../services/ai';
import type { AiErrorInfo } from '../../services/aiErrors';
import { isAiRunTerminal } from '../../hooks/useAiRun';
import { AiErrorAlert } from './AiErrorAlert';

const STATUS: Record<AiRunStatus, { label: string; color: 'default' | 'info' | 'success' | 'error' | 'warning' }> = {
  pending: { label: 'Queued', color: 'default' },
  running: { label: 'Running', color: 'info' },
  succeeded: { label: 'Succeeded', color: 'success' },
  failed: { label: 'Failed', color: 'error' },
  cancelled: { label: 'Cancelled', color: 'warning' },
};

export interface AiRunCardProps {
  prompt: string;
  run: AiRun | null;
  error: AiErrorInfo | null;
  isStarting: boolean;
  isCancelling: boolean;
  onCancel: () => void;
  onDismiss: () => void;
}

export function AiRunCard({ prompt, run, error, isStarting, isCancelling, onCancel, onDismiss }: AiRunCardProps) {
  const status: AiRunStatus = run?.status ?? 'pending';
  const terminal = run ? isAiRunTerminal(run.status) : false;
  const settledOrBroken = terminal || (error !== null && !isStarting);
  const meta = STATUS[status];

  return (
    <Paper variant="outlined" sx={{ p: 1.5, minWidth: 0 }} aria-label="Background run" role="region">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="subtitle2" component="h2">
          Background run
        </Typography>
        {!error || run ? (
          <Chip size="small" label={isStarting ? 'Starting' : meta.label} color={meta.color} data-testid="run-status" />
        ) : null}
        {!settledOrBroken && <CircularProgress size={14} aria-label="Waiting for the run" />}
        <Box sx={{ flex: 1 }} />
        {!settledOrBroken && run && (
          <Button size="small" color="inherit" onClick={onCancel} disabled={isCancelling}>
            {isCancelling ? 'Cancelling…' : 'Cancel run'}
          </Button>
        )}
        {settledOrBroken && (
          <Button size="small" color="inherit" onClick={onDismiss}>
            Dismiss
          </Button>
        )}
      </Box>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ mt: 0.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
      >
        {prompt}
      </Typography>
      {status === 'succeeded' && (
        <Typography variant="body2" sx={{ mt: 1 }}>
          The answer was added to the conversation.
        </Typography>
      )}
      {status === 'failed' && run && (
        <Box sx={{ mt: 1 }}>
          <AiErrorAlert error={{ code: run.errorCode, message: 'The background run failed.' }} />
        </Box>
      )}
      {error && (
        <Box sx={{ mt: 1 }}>
          <AiErrorAlert error={error} />
        </Box>
      )}
    </Paper>
  );
}

export default AiRunCard;
