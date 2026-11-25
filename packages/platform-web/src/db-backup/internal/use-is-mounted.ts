import { useCallback, useEffect, useRef } from 'react';

/**
 * A stable getter for "is this component still mounted?", to guard `setState`
 * in the tail of an async operation. A ref rather than state, and a getter
 * rather than the ref, so callers can list it in a `useCallback` dependency
 * array without invalidating on every render. Copied from the reference app's
 * `hooks/useIsMounted.ts` (a slice-private helper, not exported).
 *
 * @stability experimental
 */
export function useIsMounted(): () => boolean {
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  return useCallback(() => mounted.current, []);
}
