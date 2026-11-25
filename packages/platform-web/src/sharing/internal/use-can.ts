// The permission check a sharing component uses: the `can` prop when the app
// passes one, else the host viewer's `hasPermission`, else nothing is held.
// It only hides or disables controls; the API decides. Not exported.

import { useCallback } from 'react';

import { useOptionalPlatformHost } from '../../core/index.js';

export function useCan(can: ((permission: string) => boolean) | undefined): (permission: string) => boolean {
  const viewer = useOptionalPlatformHost()?.viewer;
  return useCallback(
    (permission: string) => (can ? can(permission) : (viewer?.hasPermission(permission) ?? false)),
    [can, viewer],
  );
}

export function useViewerId(explicit: string | null | undefined): string | null {
  const viewer = useOptionalPlatformHost()?.viewer;
  return explicit !== undefined ? explicit : (viewer?.userId ?? null);
}
