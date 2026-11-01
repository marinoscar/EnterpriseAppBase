import type { TuiSectionProps } from '@marinoscar/platform-cli/tui';
import { Text } from 'ink';
import type { ReactNode } from 'react';

// =============================================================================
// EXAMPLE, NOT WIRED: a section of the node and deploy TUI screens (PP-14.22)
// =============================================================================
//
// The platform's `node` and `deploy` screens are closed components. A SECTION
// is an ink component the app registers for one of them; the screen renders it
// below its own list, in registration order:
//
//   registerTuiScreenSection('node', FleetNote)
//   createCli({ ..., tuiSections: [{ screen: 'deploy', id: 'release-hint', load: ... }] })
//
// A section is presentation: it gets the screen's name and nothing of its
// state, adds no action to the screen's list, and if it throws (or its `load`
// rejects) the screen shows a one-line notice in its place and keeps working.
// Give a `load` rather than a component when the section imports ink, so
// non-TUI invocations never load it.
// =============================================================================

/** One dim line under the worker-node list. */
export function FleetNote({ screen }: TuiSectionProps): ReactNode {
  return <Text dimColor>Coach workers: scale them with COACH_WORKERS (note shown on the {screen} screen).</Text>;
}
