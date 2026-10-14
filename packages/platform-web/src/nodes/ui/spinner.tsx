// The worker-node pages' loading state (issue #881): the app's spinner from the nodes
// adapters (the reference app hands in its `LoadingSpinner`), else a centred
// MUI `CircularProgress`. Slice-internal.

import type { ReactElement } from 'react';
import { Box, CircularProgress } from '@mui/material';

import { useNodesWebAdapters } from '../headless/index.js';

export function NodesSpinner(): ReactElement {
  const { Spinner } = useNodesWebAdapters();
  if (Spinner) return <Spinner />;
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 4 }}>
      <CircularProgress size={40} />
    </Box>
  );
}
