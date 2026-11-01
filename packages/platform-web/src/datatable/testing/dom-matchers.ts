// The three Testing Library DOM matchers the conformance suite asserts with,
// declared on vitest's `Assertion` so the package compiles without
// `@testing-library/jest-dom`'s own augmentation (which a CommonJS type
// resolution attaches to a different `vitest` declaration file than the one
// this ESM package imports). The runtime side is the host's test setup, which
// registers jest-dom (`import '@testing-library/jest-dom/vitest'`), as the
// reference app and this package's own `test/setup.ts` do.

declare module 'vitest' {
  interface Assertion<T = any> {
    toBeInTheDocument(): void;
    toHaveAttribute(name: string, value?: unknown): void;
    toHaveTextContent(text?: string | RegExp, options?: { normalizeWhitespace: boolean }): void;
  }
}

export {};
