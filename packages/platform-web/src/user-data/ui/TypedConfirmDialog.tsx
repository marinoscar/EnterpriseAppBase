// The typed-confirmation dialog every destructive action opens (issue #743).
//
// EvoPath's rules: never inline; confirming needs BOTH the acknowledgement
// checkbox and the exact phrase (case and spacing included); while the job
// runs the dialog cannot be closed (no Escape, no backdrop, no Cancel) and
// shows progress; on success it lists the non-zero counts and warns when
// storage objects were kept; on failure it shows the error and allows a
// retry. The API re-checks the phrase; the dialog only collects it.

import type { ReactElement, ReactNode } from 'react';
import { useEffect, useId, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material';

import type { DestructiveJobPhase } from '../headless/index.js';

/**
 * One line of the result list.
 *
 * @stability experimental
 */
export interface TypedConfirmResultRow {
  /** What was deleted. */
  label: string;
  /** How many. Zero rows are not shown. */
  count: number;
}

/**
 * Props of {@link TypedConfirmDialog}.
 *
 * @stability experimental
 */
export interface TypedConfirmDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** The dialog title. */
  title: string;
  /** What happens, above the controls. */
  description: ReactNode;
  /** The exact phrase to type. */
  phrase: string;
  /** The checkbox label. Default: "I understand this cannot be undone." */
  acknowledgement?: string;
  /** The confirm button label. */
  confirmLabel: string;
  /** Where the job is. */
  phase: DestructiveJobPhase;
  /** The non-zero counts to list on success. */
  resultRows?: readonly TypedConfirmResultRow[];
  /** Storage objects the provider refused (a warning when above zero). */
  storageObjectsFailed?: number;
  /** The failure to show. */
  error?: string | null;
  /** Extra controls between the description and the phrase (offboarding's options). */
  children?: ReactNode;
  /** Extra condition for the confirm button (offboarding's skip reason). Default true. */
  canConfirm?: boolean;
  /** Called with the typed phrase when confirmed. */
  onConfirm(): void;
  /** Called to close (never while running). */
  onClose(): void;
}

/**
 * A destructive action's confirmation, progress and result. See the file header.
 *
 * @param props - see {@link TypedConfirmDialogProps}.
 *
 * @stability experimental
 * @extensionPoint component
 * @example
 * ```tsx
 * <TypedConfirmDialog open title="Delete all my data" description="..." phrase="DELETE MY DATA"
 *   confirmLabel="Delete" phase={job.phase} onConfirm={job.run} onClose={close} />
 * ```
 */
export function TypedConfirmDialog(props: TypedConfirmDialogProps): ReactElement {
  const { open, phase } = props;
  const [acknowledged, setAcknowledged] = useState(false);
  const [typed, setTyped] = useState('');
  const titleId = useId();
  const running = phase === 'running';

  useEffect(() => {
    if (!open) {
      setAcknowledged(false);
      setTyped('');
    }
  }, [open]);

  const close = () => {
    if (!running) props.onClose();
  };
  const ready = acknowledged && typed === props.phrase && (props.canConfirm ?? true) && !running;
  const rows = (props.resultRows ?? []).filter((row) => row.count > 0);

  return (
    <Dialog open={open} onClose={close} aria-labelledby={titleId} fullWidth maxWidth="sm">
      <DialogTitle id={titleId}>{props.title}</DialogTitle>
      <DialogContent>
        {phase === 'succeeded' ? (
          <Box>
            <Alert severity="success" sx={{ mb: 2 }}>
              Done.
            </Alert>
            {rows.length > 0 ? (
              <List dense aria-label="What was deleted">
                {rows.map((row) => (
                  <ListItem key={row.label} disableGutters>
                    <ListItemText primary={row.label} secondary={String(row.count)} />
                  </ListItem>
                ))}
              </List>
            ) : (
              <Typography color="text.secondary">Nothing was left to delete.</Typography>
            )}
            {(props.storageObjectsFailed ?? 0) > 0 && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                {props.storageObjectsFailed} stored file(s) could not be deleted from object storage and were kept. Running this
                again retries them.
              </Alert>
            )}
          </Box>
        ) : (
          <Box>
            <Box sx={{ mb: 2 }}>{props.description}</Box>
            {props.children}
            <FormControlLabel
              control={<Checkbox checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} disabled={running} />}
              label={props.acknowledgement ?? 'I understand this cannot be undone.'}
            />
            <TextField
              label={`Type ${props.phrase} to confirm`}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              disabled={running}
              fullWidth
              margin="normal"
              autoComplete="off"
              slotProps={{ htmlInput: { 'aria-describedby': `${titleId}-phrase`, spellCheck: false } }}
            />
            <Typography id={`${titleId}-phrase`} variant="body2" color="text.secondary">
              Exactly as shown: <strong>{props.phrase}</strong>
            </Typography>
            {running && (
              <Box sx={{ mt: 2 }} role="status" aria-live="polite">
                <LinearProgress aria-label="Working" />
                <Typography variant="body2" sx={{ mt: 1 }}>
                  Working. This window stays open until it finishes.
                </Typography>
              </Box>
            )}
            {phase === 'failed' && props.error && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {props.error}
              </Alert>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {phase === 'succeeded' ? (
          <Button onClick={props.onClose} variant="contained">
            Close
          </Button>
        ) : (
          <>
            <Button onClick={close} disabled={running}>
              Cancel
            </Button>
            <Button color="error" variant="contained" disabled={!ready} onClick={props.onConfirm}>
              {phase === 'failed' ? 'Retry' : props.confirmLabel}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
