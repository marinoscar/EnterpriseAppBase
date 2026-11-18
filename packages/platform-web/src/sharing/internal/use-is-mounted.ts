// "Is this component still mounted?" as a stable getter, to guard `setState`
// after an `await`. The slice's private copy (the doctor slice keeps its own);
// not exported.

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
