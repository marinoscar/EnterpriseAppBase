import { useCallback, useEffect, useRef } from 'react';

/** `() => boolean`: whether the component is still mounted (guards setState after an await). */
export function useIsMounted(): () => boolean {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(() => mounted.current, []);
}
