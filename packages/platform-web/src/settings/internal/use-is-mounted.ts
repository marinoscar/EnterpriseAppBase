// A mounted guard for every `setState` past an `await` (the house fetch-hook
// contract). Internal to the settings slice.

import { useCallback, useEffect, useRef } from 'react';

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
