import { useMemo, type ReactNode } from 'react';
import { PlatformHostProvider, type PlatformWebHost } from '@marinoscar/platform-web/core';
import { useAuth, usePermissions } from '@marinoscar/platform-web/identity/headless';

import { platformApi } from './api';

/** The host every packaged page reads: the transport, who is looking, what they may do. */
export function AppPlatformHost({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { hasPermission } = usePermissions();
  const host = useMemo<PlatformWebHost>(
    () => ({
      api: platformApi,
      viewer: { userId: user?.id ?? null, email: user?.email ?? null, hasPermission, isFeatureEnabled: () => false },
    }),
    [user?.id, user?.email, hasPermission],
  );
  return <PlatformHostProvider host={host}>{children}</PlatformHostProvider>;
}
