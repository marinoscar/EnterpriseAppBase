import { Text, useInput } from 'ink';
import type { ReactNode } from 'react';

import { Frame } from '../layout.js';

// =============================================================================
// The shared "not logged in" notice  (RETRO-G1.1, #1065)
// =============================================================================
//
// One guard, in the router, for every menu entry with `requiresLogin`, instead
// of one check pasted into each screen (the MemoriaHub #413 rationale). It is
// presentation only: every API call a screen makes is still authorised by the
// server.
// =============================================================================

export interface NotLoggedInProps {
  /** What the user was trying to open, for the message. */
  title: string;
  /** Opens the login screen. */
  onLogin: () => void;
  /** Goes back (pops the navigation stack). */
  onBack: () => void;
}

/** The notice shown in place of a login-required screen. */
export function NotLoggedIn({ title, onLogin, onBack }: NotLoggedInProps): ReactNode {
  useInput((input, key) => {
    if (input === 'l') onLogin();
    else if (input === 'q' || key.escape) onBack();
  });
  return (
    <Frame title={title} hints={['l login', 'q/esc back', 'ctrl-c exit']}>
      <Text>You are not logged in. This needs a login first.</Text>
      <Text dimColor>[l] login  [q/Esc] back</Text>
    </Frame>
  );
}
