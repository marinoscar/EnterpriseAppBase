// A width-aware `window.matchMedia` for jsdom (issue #704), the same
// evaluation as the reference app's test setup: `(min-width:Npx)` and
// `(max-width:Npx)` conditions are answered against a module-level viewport
// width (default 1440px, desktop); anything else answers `false`. Changing
// the width notifies every list, so MUI's `useMediaQuery` re-renders (wrap
// the call in `act()`).

import { vi } from 'vitest';

const DEFAULT_VIEWPORT_WIDTH = 1440;
let viewportWidth = DEFAULT_VIEWPORT_WIDTH;

interface Entry {
  matches: boolean;
  listeners: Set<() => void>;
  recompute(): void;
}

const registry = new Set<Entry>();

function evaluate(query: string, width: number): boolean {
  const normalized = query.replace(/^@media\s*/, '').trim();
  const mins = [...normalized.matchAll(/\(min-width:\s*([\d.]+)px\)/g)].map((m) => parseFloat(m[1] ?? '0'));
  const maxs = [...normalized.matchAll(/\(max-width:\s*([\d.]+)px\)/g)].map((m) => parseFloat(m[1] ?? '0'));
  if (mins.length === 0 && maxs.length === 0) return false;
  return mins.every((min) => width >= min) && maxs.every((max) => width <= max);
}

/** Installs the mock (the setup file calls it once). */
export function installMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => {
      const entry: Entry = {
        matches: evaluate(query, viewportWidth),
        listeners: new Set(),
        recompute: () => {
          const next = evaluate(query, viewportWidth);
          if (next !== entry.matches) {
            entry.matches = next;
            entry.listeners.forEach((listener) => listener());
          }
        },
      };
      registry.add(entry);
      return {
        get matches() {
          return entry.matches;
        },
        media: query,
        onchange: null,
        addListener: (listener: () => void) => entry.listeners.add(listener),
        removeListener: (listener: () => void) => entry.listeners.delete(listener),
        addEventListener: (type: string, listener: () => void) => {
          if (type === 'change') entry.listeners.add(listener);
        },
        removeEventListener: (type: string, listener: () => void) => {
          if (type === 'change') entry.listeners.delete(listener);
        },
        dispatchEvent: () => false,
      };
    }),
  });
}

/** Drives the viewport width the mock answers against. */
export function setViewportWidth(px: number): void {
  viewportWidth = px;
  registry.forEach((entry) => entry.recompute());
}

/** Back to the default desktop width (1440px), and forget old lists. */
export function resetViewportWidth(): void {
  setViewportWidth(DEFAULT_VIEWPORT_WIDTH);
  registry.clear();
}
