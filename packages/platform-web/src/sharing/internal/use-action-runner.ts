// The slice's write-hook core: count calls in flight and turn every rejection
// into a `SharingError`, so a component shows `error.message` and branches on
// `error.reason` without knowing the transport. Not exported.

import { useCallback, useRef, useState } from 'react';

import { toSharingError } from '../headless/errors.js';
import { useIsMounted } from './use-is-mounted.js';

export interface ActionRunner {
  pending: boolean;
  run<T>(call: () => Promise<T>, fallbackMessage: string): Promise<T>;
}

export function useActionRunner(): ActionRunner {
  const [inFlight, setInFlight] = useState(0);
  const isMounted = useIsMounted();
  const countRef = useRef(0);

  const run = useCallback(
    async <T,>(call: () => Promise<T>, fallbackMessage: string): Promise<T> => {
      countRef.current += 1;
      setInFlight(countRef.current);
      try {
        return await call();
      } catch (err) {
        throw toSharingError(err, fallbackMessage);
      } finally {
        countRef.current -= 1;
        if (isMounted()) setInFlight(countRef.current);
      }
    },
    [isMounted],
  );

  return { pending: inFlight > 0, run };
}
