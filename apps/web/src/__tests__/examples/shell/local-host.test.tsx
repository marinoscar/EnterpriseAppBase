/**
 * A host with no sign-in and no `/user-settings` API (a desktop shell) mounts
 * the shell under `LocalIdentityProvider` and a `ShellPreferencesProvider`.
 *
 * This is the reference app's working use of both seams: the identity is fixed
 * and local, the rail preference is kept in the host's own port, and the
 * `shell-local-host` conformance suite (registered in `conformance.test.ts`)
 * proves the packaged chrome never calls the API.
 */
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';

import { LocalIdentityProvider, useAuth, usePermissions } from '@marinoscar/platform-web/identity/headless';
import {
  ShellPreferencesProvider,
  useShellRailPreference,
} from '@marinoscar/platform-web/shell/headless';
import type { ShellPreferences, ShellPreferencesPort } from '@marinoscar/platform-web/shell/headless';

function Probe(): ReactElement {
  const { user } = useAuth();
  const { hasPermission } = usePermissions();
  const { railCollapsed } = useShellRailPreference();
  return (
    <p>
      {user?.id}|{String(hasPermission('notes:read'))}|{String(hasPermission('users:read'))}|{String(railCollapsed)}
    </p>
  );
}

describe('a local host (no sign-in, no user-settings API)', () => {
  it('serves a fixed local identity and keeps the rail preference in its own port', async () => {
    let stored: ShellPreferences = { railCollapsed: true };
    const port: ShellPreferencesPort = {
      read: () => stored,
      write: (patch) => {
        stored = { ...stored, ...patch };
      },
    };

    render(
      <LocalIdentityProvider userId="local" permissions={['notes:read']}>
        <ShellPreferencesProvider port={port}>
          <Probe />
        </ShellPreferencesProvider>
      </LocalIdentityProvider>,
    );

    await waitFor(() => expect(screen.getByText('local|true|false|true')).toBeInTheDocument());
  });
});
