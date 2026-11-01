// The current moment, re-read every `intervalMs` while mounted: the live
// "local time" read-outs of the picker and the field.

import { useEffect, useState } from 'react';

/** Now, refreshed every `intervalMs` (default 30 s). */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
