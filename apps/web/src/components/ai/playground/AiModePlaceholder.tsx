/**
 * Stand-in for a Playground mode whose panel has not been built yet —
 * issue #445.
 *
 * Transcribe (#438) and Speech (#439) are offered by the mode selector as
 * soon as a usable model declares their capability (the selector is purely
 * capability-driven), so the page needs something to show until their
 * panels land. Replace the entry in `AiPlaygroundPage`'s `renderModePanel`
 * with the real panel; nothing else refers to this component.
 */
import { Paper, Typography } from '@mui/material';
import type { AiPlaygroundMode } from './aiPlaygroundModes';

export interface AiModePlaceholderProps {
  mode: AiPlaygroundMode;
}

export function AiModePlaceholder({ mode }: AiModePlaceholderProps) {
  return (
    <Paper component="section" variant="outlined" aria-label={mode.label} sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
        {mode.label} is not available in the playground yet.
      </Typography>
    </Paper>
  );
}

export default AiModePlaceholder;
