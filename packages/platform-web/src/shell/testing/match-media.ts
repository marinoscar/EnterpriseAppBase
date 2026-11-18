// A `window.matchMedia` for the shell's conformance suites: min/max-width
// queries are answered against a fixed width, so MUI's `useMediaQuery` picks
// the tier the suite asks for. Not exported from the entry.

/**
 * Installs a `window.matchMedia` that answers min/max-width queries against `width`.
 *
 * @param width - the simulated viewport width in px.
 * @returns a function that restores the previous `matchMedia`.
 *
 * @internal
 */
export function installMatchMedia(width: number): () => void {
  const original = Object.getOwnPropertyDescriptor(window, 'matchMedia');
  const evaluate = (query: string): boolean => {
    const mins = [...query.matchAll(/\(min-width:\s*([\d.]+)px\)/g)].map((m) => parseFloat(m[1] ?? '0'));
    const maxs = [...query.matchAll(/\(max-width:\s*([\d.]+)px\)/g)].map((m) => parseFloat(m[1] ?? '0'));
    if (mins.length === 0 && maxs.length === 0) return false;
    return mins.every((min) => width >= min) && maxs.every((max) => width <= max);
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: evaluate(query),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
  return () => {
    if (original) Object.defineProperty(window, 'matchMedia', original);
    else delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  };
}
