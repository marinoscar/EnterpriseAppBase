/**
 * Reference example (PP-14.14): an extension package declares its OWN host port.
 *
 * `PlatformWebHost` has four fixed ports (`api`, `viewer`, `formatRelativeTime`,
 * `applyTheme`). A package an app installs (here an imaginary `@acme/transcripts`)
 * needs something only the app can supply: how to open a transcript in the app's
 * own router. It declares that as a typed port under a key it exports, and reads
 * it with `usePlatformPort`; the app supplies it in `host.extensions`.
 *
 *   // in the package (`@acme/transcripts`)
 *   export const TRANSCRIPTS_PORT = Symbol.for('@acme/transcripts/port');
 *   export interface TranscriptsPort { open(id: string): void }
 *
 *   // in the app (`platform/platformHost.tsx`, inside `useAppPlatformHost`)
 *   extensions: { [TRANSCRIPTS_PORT]: { open: (id) => navigate(`/transcripts/${id}`) } }
 *
 * A package keyed by `Symbol.for(...)` cannot collide with another package's
 * string key; use a namespaced string (`'acme.transcripts'`) when a symbol is
 * awkward to share. The reference app does not wire this port: the example ships
 * compiled and tested, like the other web examples
 * (`__tests__/examples/core/platform-port.test.tsx`).
 */
import { Button } from '@mui/material';
import type { ReactElement } from 'react';
import { usePlatformPort } from '@marinoscar/platform-web/core';

/** The key the package exports and the app supplies the port under. */
export const TRANSCRIPTS_PORT = Symbol.for('@acme/transcripts/port');

/** What the package needs from the app. */
export interface TranscriptsPort {
  /** Opens a transcript in the app's own router. */
  open(id: string): void;
}

/**
 * A button of the package. It FAILS AT THE FIRST RENDER, naming the key and the
 * fix, when the app did not supply the port, instead of rendering a button that
 * throws on click.
 */
export function OpenTranscriptButton({ id }: { id: string }): ReactElement {
  const port = usePlatformPort<TranscriptsPort>(TRANSCRIPTS_PORT);
  return (
    <Button variant="outlined" onClick={() => port.open(id)}>
      Open transcript
    </Button>
  );
}
