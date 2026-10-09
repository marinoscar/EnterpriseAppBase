import { useMemo, type ReactNode } from 'react';
import { PlatformHostProvider, type PlatformWebHost } from '@marinoscar/platform-web/core';
import { useAuth, usePermissions } from '@marinoscar/platform-web/identity/headless';

import { platformApi } from './api';

/** The host every packaged page reads: the transport, who is looking, what they may do. */
export function AppPlatformHost({ children }: { children: ReactNode }) {
  const { user, refreshUser } = useAuth();
  const { hasPermission } = usePermissions();
  const host = useMemo<PlatformWebHost>(
    () => ({
      api: platformApi,
      viewer: {
        userId: user?.id ?? null,
        email: user?.email ?? null,
        hasPermission,
        isFeatureEnabled: () => false,
        // The Danger Zone and the factory reset re-read the user after they succeed.
        refresh: refreshUser,
      },
    }),
    [user?.id, user?.email, hasPermission, refreshUser],
  );
  return <PlatformHostProvider host={host}>{children}</PlatformHostProvider>;
}
