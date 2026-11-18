// The telemetry pages' loading indicator (issue #704): the app's spinner when
// it hands one in (`TelemetryWebAdapters.Spinner`; the reference app passes
// its `LoadingSpinner`), else a centred MUI `CircularProgress` that matches
// it. Not exported.

import { Box, CircularProgress } from '@mui/material';
import type { ReactElement } from 'react';

import { useTelemetryWebAdapters } from '../../headless/adapters/TelemetryWebAdapters.js';

export function TelemetrySpinner(): ReactElement {
  const { Spinner } = useTelemetryWebAdapters();
  if (Spinner) return <Spinner />;
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
      <CircularProgress size={40} />
    </Box>
  );
}
