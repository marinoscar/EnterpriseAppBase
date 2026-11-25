import type { TuiScreenProps } from '@marinoscar/platform-cli/tui';
import { Box, Text, useInput } from 'ink';
import type { ReactNode } from 'react';

import { CLI_IDENTITY } from '../branding.js';

// =============================================================================
// EXAMPLE, NOT WIRED: an app screen added through registerTuiScreen (#715)
// =============================================================================
//
// The reference use of the TUI screen registry: an ordinary ink component
// that receives `onDone` and returns to the menu on Esc. Its registration
// (`about.tui.ts`) loads THIS module lazily (`load`), so ink stays out of
// every non-TUI invocation. Not in `app.ts`, so the shipped menu is the
// platform's; `about.tui.test.ts` registers it itself.
// =============================================================================

/** Shows the app's identity; Esc or q returns to the menu. */
export function AboutScreen({ onDone }: TuiScreenProps): ReactNode {
  useInput((input, key) => {
    if (key.escape || input === 'q') onDone();
  });

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>{CLI_IDENTITY.displayName}</Text>
      <Text>Source: https://github.com/{CLI_IDENTITY.repoSlug}</Text>
      <Text dimColor>esc back</Text>
    </Box>
  );
}
