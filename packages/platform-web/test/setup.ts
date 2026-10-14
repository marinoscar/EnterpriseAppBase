// Shared setup for the package's tests (issue #704): Testing Library's DOM
// matchers, an unmount after every test, and the browser APIs jsdom lacks
// that the telemetry UI touches (a width-aware matchMedia, ResizeObserver,
// IntersectionObserver, scrollTo). The same stand-ins the reference app's
// `apps/web/src/__tests__/setup.ts` installs, so tests moved from it run
// unchanged.

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

import { installMatchMedia, resetViewportWidth } from './viewport.js';

installMatchMedia();

Object.defineProperty(window, 'scrollTo', { writable: true, value: vi.fn() });

class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
class IntersectionObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  root = null;
  rootMargin = '';
  thresholds = [];
}
Object.assign(globalThis, { ResizeObserver: ResizeObserverMock, IntersectionObserver: IntersectionObserverMock });

afterEach(() => {
  cleanup();
  resetViewportWidth();
});
