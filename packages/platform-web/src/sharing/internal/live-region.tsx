// A visually hidden `aria-live` region: async results ("Link copied", "Shared
// with ana@example.com") are announced to a screen reader without moving
// focus (docs/specs/settings-ui.md, accessibility). Not exported.

import { Box } from '@mui/material';
import type { ReactElement } from 'react';

const visuallyHidden = {
  border: 0,
  clip: 'rect(0 0 0 0)',
  height: '1px',
  margin: '-1px',
  overflow: 'hidden',
  padding: 0,
  position: 'absolute',
  whiteSpace: 'nowrap',
  width: '1px',
} as const;

export function LiveRegion(props: { message: string; testId?: string }): ReactElement {
  return (
    <Box role="status" aria-live="polite" aria-atomic="true" sx={visuallyHidden} data-testid={props.testId}>
      {props.message}
    </Box>
  );
}
